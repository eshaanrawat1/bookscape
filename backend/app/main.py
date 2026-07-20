from __future__ import annotations

from datetime import date
from pathlib import Path
import os
import re
import subprocess
import sys

from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .catalog import (
    get_book as load_book,
    get_books_by_author,
    get_books_by_genre,
    get_book_with_similar as load_book_with_similar,
    get_global_library as load_global_library,
    has_data,
    resolve_book,
    search_books,
)
from .data_repository import DataRepository
from .reading_lists import ReadingListStore
from .obsidian import (
    load_obsidian_progress_entries,
    run_obsidian_sync,
)
from .reading_stats import ReadingDailyStatsStore, build_activity_payload, compute_reading_stats

app = FastAPI(title="Atlas API", version="0.1.0")
BACKEND_API_VERSION = 2
lists = ReadingListStore(Path(__file__).resolve().parents[2])
ROOT = Path(__file__).resolve().parents[2]
repo = DataRepository(ROOT)
daily_stats = ReadingDailyStatsStore(ROOT)

# Run migration on startup to populate user_state.books
repo.migrate_user_state()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "has_data": has_data(ROOT), "backend_api_version": BACKEND_API_VERSION}




def _load_vault_entries_or_skip(mode: str) -> tuple[dict[str, dict], dict] | tuple[None, dict]:
    try:
        entries, meta = load_obsidian_progress_entries(ROOT)
    except Exception as e:
        return None, {
            "date": "",
            "mode": mode,
            "skipped": True,
            "reason": f"vault_read_failed: {e}",
            "source": {"vault_path": "", "scanned_files": 0, "parsed_books": 0},
        }
    return entries, meta


@app.get("/book/{book_id}")
def get_book(book_id: str) -> dict:
    book = load_book_with_similar(ROOT, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="book not found")
    return book


@app.get("/search")
def search(q: str = Query(..., min_length=1), limit: int = Query(default=10, ge=1, le=50)) -> dict:
    return {"query": q, "results": search_books(ROOT, q, limit=limit)}



class CreateListIn(BaseModel):
    name: str


class AddBookIn(BaseModel):
    book_id: str

class RenameListIn(BaseModel):
    name: str


class ReadingProgressIn(BaseModel):
    status: str = "not_started"
    total_pages: int = 0
    current_page: int = 0
    start_date: str = ""
    finish_date: str = ""
    notes: str = ""


class FinishedBookIn(BaseModel):
    status: str = "done"
    current_page: int = 0
    total_pages: int = 0
    start_date: str = ""
    finish_date: str = ""
    notes: str = ""




def _hydrate_want_to_read() -> dict:
    user_state = repo.load_user_state()
    books_map = user_state.get("books", {})
    if not isinstance(books_map, dict):
        books_map = {}
    book_ids = [uid for uid, row in books_map.items() if isinstance(row, dict) and row.get("want_to_read")]
    books = []
    for book_id in book_ids:
        b = load_book(ROOT, book_id)
        if b:
            books.append(b)
    return {"book_ids": [b.get("id") for b in books], "books": books, "count": len(books)}


def _hydrate_lists(rows: list[dict]) -> list[dict]:
    out = []
    for row in rows:
        books = []
        for book_id in row.get("books", []):
            b = load_book(ROOT, book_id)
            if b:
                books.append(b)
        out.append({"name": row.get("name", ""), "book_ids": row.get("books", []), "books": books, "count": len(books)})
    return out


@app.get("/reading-lists")
def get_reading_lists() -> dict:
    return {"lists": _hydrate_lists(lists.list_all())}


@app.post("/reading-lists")
def create_reading_list(payload: CreateListIn) -> dict:
    try:
        lists.create_list(payload.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"lists": _hydrate_lists(lists.list_all())}


@app.delete("/reading-lists/{name}")
def delete_reading_list(name: str) -> dict:
    try:
        lists.delete_list(name)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"lists": _hydrate_lists(lists.list_all())}


@app.patch("/reading-lists/{name}")
def rename_reading_list(name: str, payload: RenameListIn) -> dict:
    try:
        lists.rename_list(name, payload.name)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"lists": _hydrate_lists(lists.list_all())}


@app.post("/reading-lists/{name}/books")
def add_book_to_list(name: str, payload: AddBookIn) -> dict:
    if not load_book(ROOT, payload.book_id):
        raise HTTPException(status_code=404, detail="book not found")
    try:
        lists.add_book(name, payload.book_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"lists": _hydrate_lists(lists.list_all())}


@app.delete("/reading-lists/{name}/books/{book_id}")
def remove_book_from_list(name: str, book_id: str) -> dict:
    try:
        lists.remove_book(name, book_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"lists": _hydrate_lists(lists.list_all())}




@app.get("/want-to-read-books")
def get_want_to_read_books() -> dict:
    return _hydrate_want_to_read()


@app.post("/want-to-read-books")
def add_want_to_read_book(payload: AddBookIn) -> dict:
    if not load_book(ROOT, payload.book_id):
        raise HTTPException(status_code=404, detail="book not found")
    user_state = repo.load_user_state()
    books = user_state.setdefault("books", {})
    existing = books.get(payload.book_id, {}) if isinstance(books.get(payload.book_id), dict) else {}
    books[payload.book_id] = {**existing, "want_to_read": True}
    repo.save_user_state(user_state)
    return _hydrate_want_to_read()


@app.delete("/want-to-read-books/{book_id}")
def remove_want_to_read_book(book_id: str) -> dict:
    user_state = repo.load_user_state()
    books = user_state.setdefault("books", {})
    existing = books.get(book_id, {}) if isinstance(books.get(book_id), dict) else {}
    books[book_id] = {**existing, "want_to_read": False}
    repo.save_user_state(user_state)
    return _hydrate_want_to_read()


@app.get("/reading-progress")
def get_reading_progress() -> dict:
    user_state = repo.load_user_state()
    books = user_state.get("books", {})
    if not isinstance(books, dict):
        books = {}
    
    entries = {}
    for book_id, book_record in books.items():
        if not isinstance(book_record, dict):
            continue
        entries[str(book_id)] = {
            "status": book_record.get("status", "not_started"),
            "total_pages": int(book_record.get("total_pages") or 0),
            "current_page": int(book_record.get("current_page") or 0),
            "start_date": book_record.get("start_date", ""),
            "finish_date": book_record.get("finish_date", ""),
            "notes": book_record.get("notes", ""),
        }
    return {"entries": entries}


@app.get("/global-library")
def get_global_library() -> dict:
    return {"genres": load_global_library(ROOT)}


@app.get("/author-books")
def get_author_books(author: str = Query(..., min_length=1)) -> dict:
    books = get_books_by_author(ROOT, author)
    return {"author": author, "books": books, "count": len(books)}


@app.get("/genre-books")
@app.get("/api/genre-books")
def get_genre_books(genre: str = Query(..., min_length=1), limit: int = Query(default=100, ge=1, le=200)) -> dict:
    books = get_books_by_genre(ROOT, genre, limit)
    return {"genre": genre, "books": books, "count": len(books)}


@app.get("/finished-books/{book_id}")
def get_finished_book(book_id: str) -> dict:
    user_state = repo.load_user_state()
    books = user_state.get("books", {})
    if not isinstance(books, dict):
        books = {}
    
    book_record = books.get(book_id)
    if not isinstance(book_record, dict):
        if not resolve_book(ROOT, book_id):
            raise HTTPException(status_code=404, detail="book not found")
        # Book exists in catalog but not in user_state - return empty record
        return {
            "book_id": book_id,
            "entry": {
                "book_id": book_id,
                "status": "done",
                "current_page": 0,
                "total_pages": 0,
                "start_date": "",
                "finish_date": "",
                "notes": "",
            },
        }
    
    status = str(book_record.get("status") or "not_started").strip().lower()
    if status != "done":
        raise HTTPException(status_code=404, detail="book not found or not finished")
    
    return {
        "book_id": book_id,
        "entry": {
            "book_id": book_id,
            "status": status,
            "current_page": int(book_record.get("current_page") or 0),
            "total_pages": int(book_record.get("total_pages") or 0),
            "start_date": str(book_record.get("start_date") or ""),
            "finish_date": str(book_record.get("finish_date") or ""),
            "notes": str(book_record.get("notes") or ""),
        },
    }


@app.put("/finished-books/{book_id}")
def upsert_finished_book(book_id: str, payload: FinishedBookIn) -> dict:
    if not resolve_book(ROOT, book_id):
        raise HTTPException(status_code=404, detail="book not found")
    
    user_state = repo.load_user_state()
    books = user_state.setdefault("books", {})
    if not isinstance(books, dict):
        books = {}
    
    # Get existing book record to preserve other fields
    existing_book = books.get(book_id, {}) if isinstance(books.get(book_id), dict) else {}
    
    # Update notes field (this endpoint's actual purpose now)
    books[book_id] = {
        **existing_book,
        "status": "done",
        "current_page": int(payload.current_page or existing_book.get("current_page") or 0),
        "total_pages": int(payload.total_pages or existing_book.get("total_pages") or 0),
        "start_date": (payload.start_date or existing_book.get("start_date") or "").strip(),
        "finish_date": (payload.finish_date or existing_book.get("finish_date") or "").strip(),
        "notes": payload.notes or existing_book.get("notes", ""),
    }
    
    repo.save_user_state(user_state)
    
    return {"book_id": book_id, "entry": books[book_id]}


@app.get("/my-books")
def get_my_books() -> dict:
    user_state = repo.load_user_state()
    books_map = user_state.get("books", {})
    if not isinstance(books_map, dict):
        books_map = {}
    
    books: list[dict] = []

    for book_id, row in books_map.items():
        if not isinstance(row, dict):
            continue
        status = str(row.get("status") or "not_started").strip().lower()
        if status not in {"reading", "done"}:
            continue
        
        resolved_book = resolve_book(ROOT, book_id) or {}
        linked_catalog_book = resolved_book if isinstance(resolved_book, dict) and resolved_book else None
        
        # Overlay catalog fields at response time
        effective_title = str(row.get("title") or (linked_catalog_book or {}).get("title") or "")
        effective_author = str(row.get("author") or (linked_catalog_book or {}).get("author") or "")
        effective_image_url = str(row.get("image_url") or (linked_catalog_book or {}).get("image_url") or "")
        effective_genres = row.get("genres") or (linked_catalog_book or {}).get("genres", [])
        effective_rating = row.get("rating") or (linked_catalog_book or {}).get("avg_rating") or 0
        effective_description = str(row.get("description") or (linked_catalog_book or {}).get("description") or "")
        effective_color = str(row.get("color") or (linked_catalog_book or {}).get("color") or "")
        
        current_page = int(row.get("current_page") or 0)
        total_pages = int(row.get("total_pages") or 0)
        
        books.append({
            "id": str(book_id),
            "title": effective_title,
            "author": effective_author,
            "image_url": effective_image_url,
            "genres": effective_genres,
            "rating": effective_rating,
            "description": effective_description,
            "color": effective_color,
            "reading_status": status,
            "reading_current_page": current_page,
            "reading_total_pages": total_pages,
            "reading_finish_date": row.get("finish_date", ""),
            "reading_start_date": row.get("start_date", ""),
            "linked_catalog_book": linked_catalog_book,
            "notes": row.get("notes", ""),
            "liked": row.get("liked", False),
            "want_to_read": row.get("want_to_read", False),
            "lists": row.get("lists", []),
        })

    books.sort(
        key=lambda b: (
            str(b.get("reading_finish_date") or ""),
            str(b.get("reading_start_date") or ""),
            str(b.get("title") or ""),
        ),
        reverse=True,
    )
    return {"books": books, "count": len(books)}


@app.put("/reading-progress/{book_id}")
def upsert_reading_progress(book_id: str, payload: ReadingProgressIn) -> dict:
    # Check if book exists in catalog or user_state
    if not resolve_book(ROOT, book_id):
        user_state = repo.load_user_state()
        books = user_state.get("books", {})
        if not isinstance(books, dict) or book_id not in books:
            raise HTTPException(status_code=404, detail="book not found")
    
    status = (payload.status or "").strip().lower()
    if status not in {"not_started", "reading", "done"}:
        raise HTTPException(status_code=400, detail="invalid status")
    total_pages = max(0, int(payload.total_pages or 0))
    current_page = max(0, int(payload.current_page or 0))
    if total_pages > 0:
        current_page = min(current_page, total_pages)

    user_state = repo.load_user_state()
    books = user_state.setdefault("books", {})
    if not isinstance(books, dict):
        books = {}
    
    # Get existing book record to preserve personal fields
    existing_book = books.get(book_id, {}) if isinstance(books.get(book_id), dict) else {}
    
    # Update progress fields only
    books[book_id] = {
        **existing_book,
        "status": status,
        "total_pages": total_pages,
        "current_page": current_page,
        "start_date": (payload.start_date or "").strip(),
        "finish_date": (payload.finish_date or "").strip(),
        "notes": payload.notes or existing_book.get("notes", ""),
    }
    
    repo.save_user_state(user_state)
    
    # Build entries response from user_state.books
    entries = {}
    for bid, book_record in books.items():
        if isinstance(book_record, dict):
            entries[bid] = {
                "status": book_record.get("status", "not_started"),
                "total_pages": int(book_record.get("total_pages") or 0),
                "current_page": int(book_record.get("current_page") or 0),
                "start_date": book_record.get("start_date", ""),
                "finish_date": book_record.get("finish_date", ""),
                "notes": book_record.get("notes", ""),
            }
    
    return {"book_id": book_id, "entry": books[book_id], "entries": entries}


@app.get("/reading-progress/{book_id}")
def get_reading_progress_entry(book_id: str) -> dict:
    user_state = repo.load_user_state()
    books = user_state.get("books", {})
    if not isinstance(books, dict):
        books = {}
    
    book_record = books.get(book_id)
    if not isinstance(book_record, dict):
        # Check if book exists in catalog
        if not resolve_book(ROOT, book_id):
            raise HTTPException(status_code=404, detail="book not found")
        # Book exists in catalog but not in user_state - return empty record
        return {
            "book_id": book_id,
            "entry": {
                "book_id": book_id,
                "status": "not_started",
                "current_page": 0,
                "total_pages": 0,
                "start_date": "",
                "finish_date": "",
                "notes": "",
            },
        }
    
    return {
        "book_id": book_id,
        "entry": {
            "book_id": book_id,
            "status": str(book_record.get("status") or "not_started"),
            "current_page": int(book_record.get("current_page") or 0),
            "total_pages": int(book_record.get("total_pages") or 0),
            "start_date": str(book_record.get("start_date") or ""),
            "finish_date": str(book_record.get("finish_date") or ""),
            "notes": str(book_record.get("notes") or ""),
        },
    }


@app.get("/reading-stats")
def get_reading_stats() -> dict:
    user_state = repo.load_user_state()
    books = user_state.get("books", {})
    if not isinstance(books, dict):
        books = {}
    
    entries = {}
    for book_id, book_record in books.items():
        if not isinstance(book_record, dict):
            continue
        entries[str(book_id)] = {
            "status": book_record.get("status", "not_started"),
            "total_pages": int(book_record.get("total_pages") or 0),
            "current_page": int(book_record.get("current_page") or 0),
            "start_date": book_record.get("start_date", ""),
            "finish_date": book_record.get("finish_date", ""),
        }
    return {
        "periods": compute_reading_stats(entries),
        "activity": build_activity_payload(daily_stats.list_daily()),
    }


def _parse_iso_date(value: object) -> date | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except Exception:
        return None


def _stats_book_payload(book_id: str, row: dict) -> dict:
    book_row = row if isinstance(row, dict) else {}
    catalog = load_book(ROOT, book_id)
    if not isinstance(catalog, dict):
        catalog = {}

    genres = book_row.get("genres") or catalog.get("genres", [])
    if not isinstance(genres, list):
        genres = [genres]
    clean_genres = [str(genre).strip() for genre in genres if str(genre).strip()]

    total_pages = int(book_row.get("total_pages") or catalog.get("page_count") or 0)
    start_date = str(book_row.get("start_date") or "").strip()
    finish_date = str(book_row.get("finish_date") or "").strip()
    title = str(book_row.get("title") or catalog.get("title") or "Untitled")
    author = str(book_row.get("author") or catalog.get("author") or "")
    cover = str(book_row.get("image_url") or catalog.get("image_url") or "")
    rating = book_row.get("rating") or catalog.get("avg_rating") or 0
    rating_count = catalog.get("rating_count") or 0
    review_count = catalog.get("review_count") or 0
    return {
        "id": book_id,
        "title": title,
        "author": author,
        "cover": cover,
        "color": str(book_row.get("color") or catalog.get("color") or ""),
        "tint": "220 30% 45%",
        "genre": clean_genres[0] if clean_genres else str(book_row.get("genre") or catalog.get("genre") or ""),
        "genres": clean_genres,
        "totalPages": total_pages,
        "currentPage": total_pages,
        "startDate": start_date,
        "finishDate": finish_date,
        "rating": float(rating or 0),
        "reviewCount": int(review_count or 0),
        "ratingCount": int(rating_count or 0),
        "progress": 100,
        "status": "done",
        "blurb": str(book_row.get("description") or catalog.get("description") or ""),
        "_raw": {**book_row, **({"linked_catalog_book": catalog} if catalog else {})},
    }


def _build_stats_summary(year: int | None = None, month: int | None = None) -> dict:
    user_state = repo.load_user_state()
    books = user_state.get("books", {})
    if not isinstance(books, dict):
        books = {}

    available_years: set[int] = set()
    for row in books.values():
        if not isinstance(row, dict):
            continue
        finish_date = _parse_iso_date(row.get("finish_date"))
        if finish_date:
            available_years.add(finish_date.year)

    selected: dict[str, dict] = {}
    for book_id, row in books.items():
        if not isinstance(row, dict):
            continue
        if str(row.get("status") or "done").strip().lower() != "done":
            continue
        finish_date = _parse_iso_date(row.get("finish_date"))
        if not finish_date:
            continue
        if year is not None and finish_date.year != year:
            continue
        if month is not None and finish_date.month != month:
            continue
        selected[str(book_id)] = row

    books_list: list[dict] = []
    genres: set[str] = set()
    for book_id, row in selected.items():
        finish_date = _parse_iso_date(row.get("finish_date"))
        book = _stats_book_payload(book_id, row)
        books_list.append({
            **book,
            "finishDateObj": finish_date.isoformat() if finish_date else "",
        })
        for genre in book.get("genres", []):
            genres.add(genre)

    books_list.sort(key=lambda item: (str(item.get("finishDate") or ""), str(item.get("title") or "")), reverse=True)
    densest_book = max(books_list, key=lambda item: int(item.get("totalPages") or 0), default=None)

    def _time_spent_days(item: dict) -> int:
        start = _parse_iso_date(item.get("startDate"))
        finish = _parse_iso_date(item.get("finishDate"))
        if not start or not finish or finish < start:
            return 0
        return max(1, (finish - start).days + 1)

    most_time_spent = max(books_list, key=_time_spent_days, default=None)
    most_time_spent_days = _time_spent_days(most_time_spent) if most_time_spent else 0
    year_label = str(year) if year is not None else "All time"
    if year is not None and month is not None:
        period_label = f"{date(year, month, 1).strftime('%B %Y')}"
    elif year is not None:
        period_label = year_label
    elif month is not None:
        period_label = date(2000, month, 1).strftime('%B')
    else:
        period_label = "All time"

    return {
        "year": year,
        "month": month,
        "period_label": period_label,
        "available_years": sorted(available_years, reverse=True),
        "books_read": len(books_list),
        "pages_read": sum(int(book.get("totalPages") or 0) for book in books_list),
        "genres_covered": len(genres),
        "genre_list": sorted(genres),
        "densest_book": densest_book,
        "most_time_spent": most_time_spent,
        "most_time_spent_days": most_time_spent_days,
    }


@app.post("/reading-stats/snapshot/run")
def run_reading_snapshot(force: bool = Query(default=False)) -> dict:
    loaded = _load_vault_entries_or_skip("manual_snapshot")
    if loaded[0] is None:
        return {"ok": False, "snapshot": loaded[1]}
    entries, source = loaded
    result = daily_stats.run_snapshot(entries, force=force, mode="manual")
    return {
        "ok": True,
        "snapshot": {
            "date": result.date,
            "mode": result.mode,
            "pages_read": result.pages_read,
            "books_completed": result.books_completed,
            "books_touched": result.books_touched,
            "skipped": result.skipped,
            "reason": result.reason,
            "last_run_at": result.last_run_at,
            "source": source,
        },
    }


@app.post("/reading-stats/snapshot/login-backup")
def run_login_backup_snapshot() -> dict:
    loaded = _load_vault_entries_or_skip("login_backup")
    if loaded[0] is None:
        return {"ok": False, "snapshot": loaded[1]}
    entries, source = loaded
    return {"ok": True, "snapshot": {**daily_stats.run_login_backup(entries), "source": source}}


@app.post("/reading-stats/snapshot/nightly-finalize")
def run_nightly_finalize_snapshot(force: bool = Query(default=False)) -> dict:
    loaded = _load_vault_entries_or_skip("nightly_finalize")
    if loaded[0] is None:
        return {"ok": False, "snapshot": loaded[1]}
    entries, source = loaded
    return {"ok": True, "snapshot": {**daily_stats.run_nightly_finalize(entries, force=force), "source": source}}


def _run_sync_obsidian(*, dry_run: bool = False) -> dict:
    try:
        res = run_obsidian_sync(Path(__file__).resolve().parents[2], dry_run=dry_run)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"sync failed: {e}") from e

    return {
        "ok": True,
        "dry_run": res.dry_run,
        "vault_path": res.vault_path,
        "preview_path": res.preview_path,
        "scanned_files": res.scanned_files,
        "parsed_books": res.parsed_books,
        "created_books": res.created_books,
        "updated_books": res.updated_books,
        "updated_progress_entries": res.updated_progress_entries,
        "periods": res.periods,
        "activity": build_activity_payload(daily_stats.list_daily()),
    }


@app.post("/sync/obsidian")
def sync_obsidian(dry_run: bool = Query(default=False)) -> dict:
    return _run_sync_obsidian(dry_run=dry_run)


# ---------------------------------------------------------------------------
# /api/* router — mirrors all routes the frontend calls so that both the Vite
# dev proxy (/api → FastAPI at /api/...) and production reverse proxies work
# without any URL rewriting on either side.
# ---------------------------------------------------------------------------

api_router = APIRouter(prefix="/api")


@api_router.post("/sync/obsidian")
def api_sync_obsidian(dry_run: bool = Query(default=False)) -> dict:
    return _run_sync_obsidian(dry_run=dry_run)


@api_router.get("/my-books")
def api_get_my_books() -> dict:
    return get_my_books()


@api_router.get("/reading-lists")
def api_get_reading_lists() -> dict:
    return get_reading_lists()


@api_router.post("/reading-lists")
def api_create_reading_list(payload: CreateListIn) -> dict:
    return create_reading_list(payload)


@api_router.delete("/reading-lists/{name}")
def api_delete_reading_list(name: str) -> dict:
    return delete_reading_list(name)


@api_router.patch("/reading-lists/{name}")
def api_rename_reading_list(name: str, payload: RenameListIn) -> dict:
    return rename_reading_list(name, payload)


@api_router.post("/reading-lists/{name}/books")
def api_add_book_to_list(name: str, payload: AddBookIn) -> dict:
    return add_book_to_list(name, payload)


@api_router.delete("/reading-lists/{name}/books/{book_id}")
def api_remove_book_from_list(name: str, book_id: str) -> dict:
    return remove_book_from_list(name, book_id)




@api_router.get("/want-to-read-books")
def api_get_want_to_read_books() -> dict:
    return get_want_to_read_books()


@api_router.post("/want-to-read-books")
def api_add_want_to_read_book(payload: AddBookIn) -> dict:
    return add_want_to_read_book(payload)


@api_router.delete("/want-to-read-books/{book_id}")
def api_remove_want_to_read_book(book_id: str) -> dict:
    return remove_want_to_read_book(book_id)


@api_router.get("/reading-progress")
def api_get_reading_progress() -> dict:
    return get_reading_progress()


@api_router.get("/reading-progress/{book_id}")
def api_get_reading_progress_entry(book_id: str) -> dict:
    return get_reading_progress_entry(book_id)


@api_router.get("/global-library")
def api_get_global_library() -> dict:
    return get_global_library()


@api_router.get("/author-books")
def api_get_author_books(author: str = Query(..., min_length=1)) -> dict:
    return get_author_books(author=author)


@api_router.get("/finished-books/{book_id}")
def api_get_finished_book(book_id: str) -> dict:
    return get_finished_book(book_id)


@api_router.put("/finished-books/{book_id}")
def api_upsert_finished_book(book_id: str, payload: FinishedBookIn) -> dict:
    return upsert_finished_book(book_id, payload)


@api_router.put("/reading-progress/{book_id}")
def api_upsert_reading_progress(book_id: str, payload: ReadingProgressIn) -> dict:
    return upsert_reading_progress(book_id, payload)


@api_router.get("/reading-stats")
def api_get_reading_stats() -> dict:
    return get_reading_stats()


@api_router.get("/search")
def api_search(q: str = Query(..., min_length=1), limit: int = Query(default=10, ge=1, le=50)) -> dict:
    return search(q=q, limit=limit)


@api_router.get("/book/{book_id}")
def api_get_book(book_id: str) -> dict:
    return get_book(book_id)


@api_router.get("/stats")
def api_get_stats(year: int | None = Query(default=None, ge=1900, le=3000), month: int | None = Query(default=None, ge=1, le=12)) -> dict:
    return _build_stats_summary(year=year, month=month)


@app.get("/stats")
def get_stats(year: int | None = Query(default=None, ge=1900, le=3000), month: int | None = Query(default=None, ge=1, le=12)) -> dict:
    return _build_stats_summary(year=year, month=month)


class ScrapeBookIn(BaseModel):
    url: str


def scrape_book(payload: ScrapeBookIn) -> dict:
    url = payload.url.strip()
    uid_match = re.search(r"/book/show/(\d+)", url)
    if not uid_match:
        raise HTTPException(status_code=400, detail="Invalid Goodreads URL format")
    
    book_id = uid_match.group(1)
    
    scraper_path = ROOT / "data" / "scraper.py"
    scraper_timeout = int(os.getenv("SCRAPER_TIMEOUT_SECONDS", "180"))
    cmd = [
        sys.executable,
        str(scraper_path),
        "--import-one",
        url
    ]
    
    try:
        res = subprocess.run(cmd, cwd=ROOT / "data", capture_output=True, text=True, timeout=scraper_timeout)
        if res.returncode != 0:
            err_msg = res.stderr or res.stdout or "Scraper execution failed"
            raise HTTPException(status_code=500, detail=f"Scraper error: {err_msg}")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail=f"Scraper timed out after {scraper_timeout}s")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to run scraper: {str(e)}")
        
    book = load_book_with_similar(ROOT, book_id)
    if not book:
        log_details = ""
        if res.stdout:
            warnings = [line.strip() for line in res.stdout.split("\n") if "⚠️" in line or "🚨" in line or "error" in line.lower()]
            if warnings:
                log_details = f" Details: {' | '.join(warnings)}"
        raise HTTPException(status_code=404, detail=f"Scraper completed but book not found in dataset.{log_details}")
        
    return {"ok": True, "book": book}


@app.post("/scrape-book")
def root_scrape_book(payload: ScrapeBookIn) -> dict:
    return scrape_book(payload)


@api_router.post("/scrape-book")
def api_scrape_book(payload: ScrapeBookIn) -> dict:
    return scrape_book(payload)


app.include_router(api_router)