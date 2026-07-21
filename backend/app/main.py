from __future__ import annotations

import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .catalog import (
    get_book as load_book,
    get_book_with_similar as load_book_with_similar,
    get_books_by_author,
    get_books_by_genre,
    get_global_library as load_global_library,
    has_data,
    resolve_book,
    search_books,
)
from .data_repository import DataRepository
from .obsidian import load_obsidian_progress_entries, run_obsidian_sync
from .reading_lists import ReadingListStore
from .reading_stats import ReadingDailyStatsStore, build_activity_payload, compute_reading_stats


# App setup

ROOT = Path(__file__).resolve().parents[2]
BACKEND_API_VERSION = 2

app = FastAPI(title="Atlas API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

repo = DataRepository(ROOT)
lists = ReadingListStore(ROOT)
daily_stats = ReadingDailyStatsStore(ROOT)

repo.migrate_user_state()

router = APIRouter(prefix="/api")

class CreateListIn(BaseModel):
    name: str

class RenameListIn(BaseModel):
    name: str

class AddBookIn(BaseModel):
    book_id: str

class ReadingProgressIn(BaseModel):
    status: str = "not_started"
    current_page: int = 0
    total_pages: int = 0
    start_date: str = ""
    finish_date: str = ""
    notes: str = ""

class ScrapeBookIn(BaseModel):
    url: str


def _books_map() -> dict[str, dict]:
    """Return user_state.books, always a plain dict."""
    raw = repo.load_user_state().get("books", {})
    return raw if isinstance(raw, dict) else {}


def _book_entry(record: dict, book_id: str) -> dict:
    """Serialise a user_state book record into the standard progress entry shape."""
    return {
        "book_id": book_id,
        "status": str(record.get("status") or "not_started"),
        "current_page": int(record.get("current_page") or 0),
        "total_pages": int(record.get("total_pages") or 0),
        "start_date": str(record.get("start_date") or ""),
        "finish_date": str(record.get("finish_date") or ""),
        "notes": str(record.get("notes") or ""),
    }


def _empty_entry(book_id: str, status: str = "not_started") -> dict:
    return {"book_id": book_id, "status": status,
            "current_page": 0, "total_pages": 0,
            "start_date": "", "finish_date": "", "notes": ""}


def _hydrate_lists(rows: list[dict]) -> list[dict]:
    out = []
    for row in rows:
        books = [b for bid in row.get("books", []) if (b := load_book(ROOT, bid))]
        out.append({
            "name": row.get("name", ""),
            "book_ids": row.get("books", []),
            "books": books,
            "count": len(books),
        })
    return out


def _hydrate_want_to_read() -> dict:
    books = [b for uid, row in _books_map().items()
             if isinstance(row, dict) and row.get("want_to_read")
             if (b := load_book(ROOT, uid))]
    return {"book_ids": [b.get("id") for b in books], "books": books, "count": len(books)}


def _set_book_field(book_id: str, **fields) -> None:
    """Merge fields into user_state.books[book_id], preserving all other keys."""
    user_state = repo.load_user_state()
    books = user_state.setdefault("books", {})
    existing = books.get(book_id, {}) if isinstance(books.get(book_id), dict) else {}
    books[book_id] = {**existing, **fields}
    repo.save_user_state(user_state)


def _load_vault_entries_or_skip(mode: str) -> tuple[dict[str, dict], dict] | tuple[None, dict]:
    try:
        return load_obsidian_progress_entries(ROOT)
    except Exception as e:
        return None, {
            "date": "", "mode": mode, "skipped": True,
            "reason": f"vault_read_failed: {e}",
            "source": {"vault_path": "", "scanned_files": 0, "parsed_books": 0},
        }


def _parse_iso_date(value: object) -> date | None:
    raw = str(value or "").strip()
    try:
        return date.fromisoformat(raw[:10]) if raw else None
    except Exception:
        return None


def _stats_book_payload(book_id: str, row: dict) -> dict:
    catalog = load_book(ROOT, book_id) or {}
    genres = row.get("genres") or catalog.get("genres", [])
    if not isinstance(genres, list):
        genres = [genres]
    clean_genres = [str(g).strip() for g in genres if str(g).strip()]
    total_pages = int(row.get("total_pages") or catalog.get("page_count") or 0)
    return {
        "id": book_id,
        "title": str(row.get("title") or catalog.get("title") or "Untitled"),
        "author": str(row.get("author") or catalog.get("author") or ""),
        "cover": str(row.get("image_url") or catalog.get("image_url") or ""),
        "color": str(row.get("color") or catalog.get("color") or ""),
        "tint": "220 30% 45%",
        "genre": clean_genres[0] if clean_genres else str(row.get("genre") or catalog.get("genre") or ""),
        "genres": clean_genres,
        "totalPages": total_pages,
        "currentPage": total_pages,
        "startDate": str(row.get("start_date") or "").strip(),
        "finishDate": str(row.get("finish_date") or "").strip(),
        "rating": float(row.get("rating") or catalog.get("avg_rating") or 0),
        "reviewCount": int(catalog.get("review_count") or 0),
        "ratingCount": int(catalog.get("rating_count") or 0),
        "progress": 100,
        "status": "done",
        "blurb": str(row.get("description") or catalog.get("description") or ""),
        "_raw": {**row, **({"linked_catalog_book": catalog} if catalog else {})},
    }


def _run_sync_obsidian(*, dry_run: bool = False) -> dict:
    try:
        res = run_obsidian_sync(ROOT, dry_run=dry_run)
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


@app.get("/health")
@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "has_data": has_data(ROOT), "backend_api_version": BACKEND_API_VERSION}


@app.post("/sync/obsidian")
def sync_obsidian_root(dry_run: bool = Query(default=False)) -> dict:
    return _run_sync_obsidian(dry_run=dry_run)


# Catalog

@router.get("/book/{book_id}")
def get_book(book_id: str) -> dict:
    book = load_book_with_similar(ROOT, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="book not found")
    return book


@router.get("/search")
def search(q: str = Query(..., min_length=1), limit: int = Query(default=10, ge=1, le=50)) -> dict:
    return {"query": q, "results": search_books(ROOT, q, limit=limit)}


@router.get("/global-library")
def get_global_library() -> dict:
    return {"genres": load_global_library(ROOT)}


@router.get("/author-books")
def get_author_books(author: str = Query(..., min_length=1)) -> dict:
    books = get_books_by_author(ROOT, author)
    return {"author": author, "books": books, "count": len(books)}


@router.get("/genre-books")
def get_genre_books(genre: str = Query(..., min_length=1), limit: int = Query(default=100, ge=1, le=200)) -> dict:
    books = get_books_by_genre(ROOT, genre, limit)
    return {"genre": genre, "books": books, "count": len(books)}


# My books

@router.get("/my-books")
def get_my_books() -> dict:
    books: list[dict] = []
    for book_id, row in _books_map().items():
        if not isinstance(row, dict):
            continue
        status = str(row.get("status") or "not_started").strip().lower()
        if status not in {"reading", "done"}:
            continue
        catalog = resolve_book(ROOT, book_id) or {}
        books.append({
            "id": str(book_id),
            "title": str(row.get("title") or catalog.get("title") or ""),
            "author": str(row.get("author") or catalog.get("author") or ""),
            "image_url": str(row.get("image_url") or catalog.get("image_url") or ""),
            "genres": row.get("genres") or catalog.get("genres", []),
            "rating": row.get("rating") or catalog.get("avg_rating") or 0,
            "description": str(row.get("description") or catalog.get("description") or ""),
            "color": str(row.get("color") or catalog.get("color") or ""),
            "reading_status": status,
            "reading_current_page": int(row.get("current_page") or 0),
            "reading_total_pages": int(row.get("total_pages") or 0),
            "reading_finish_date": row.get("finish_date", ""),
            "reading_start_date": row.get("start_date", ""),
            "linked_catalog_book": catalog or None,
            "notes": row.get("notes", ""),
            "liked": row.get("liked", False),
            "want_to_read": row.get("want_to_read", False),
            "lists": row.get("lists", []),
        })
    books.sort(
        key=lambda b: (str(b.get("reading_finish_date") or ""), str(b.get("reading_start_date") or ""), str(b.get("title") or "")),
        reverse=True,
    )
    return {"books": books, "count": len(books)}


# Reading progress

@router.get("/reading-progress")
def get_reading_progress() -> dict:
    return {"entries": {bid: _book_entry(row, bid) for bid, row in _books_map().items() if isinstance(row, dict)}}


@router.get("/reading-progress/{book_id}")
def get_reading_progress_entry(book_id: str) -> dict:
    record = _books_map().get(book_id)
    if not isinstance(record, dict):
        if not resolve_book(ROOT, book_id):
            raise HTTPException(status_code=404, detail="book not found")
        return {"book_id": book_id, "entry": _empty_entry(book_id)}
    return {"book_id": book_id, "entry": _book_entry(record, book_id)}


@router.put("/reading-progress/{book_id}")
def upsert_reading_progress(book_id: str, payload: ReadingProgressIn) -> dict:
    if not resolve_book(ROOT, book_id) and book_id not in _books_map():
        raise HTTPException(status_code=404, detail="book not found")
    status = (payload.status or "").strip().lower()
    if status not in {"not_started", "reading", "done"}:
        raise HTTPException(status_code=400, detail="invalid status")
    total_pages = max(0, int(payload.total_pages or 0))
    current_page = min(max(0, int(payload.current_page or 0)), total_pages or 999_999)
    _set_book_field(
        book_id,
        status=status,
        total_pages=total_pages,
        current_page=current_page,
        start_date=(payload.start_date or "").strip(),
        finish_date=(payload.finish_date or "").strip(),
        notes=payload.notes or "",
    )
    return {"book_id": book_id, "entry": _book_entry(_books_map()[book_id], book_id)}


# ---------------------------------------------------------------------------
# Finished books (legacy alias — same store, status hardcoded to "done")
# ---------------------------------------------------------------------------

@router.get("/finished-books/{book_id}")
def get_finished_book(book_id: str) -> dict:
    record = _books_map().get(book_id)
    if not isinstance(record, dict):
        if not resolve_book(ROOT, book_id):
            raise HTTPException(status_code=404, detail="book not found")
        return {"book_id": book_id, "entry": _empty_entry(book_id, status="done")}
    if str(record.get("status") or "").strip().lower() != "done":
        raise HTTPException(status_code=404, detail="book not found or not finished")
    return {"book_id": book_id, "entry": _book_entry(record, book_id)}


@router.put("/finished-books/{book_id}")
def upsert_finished_book(book_id: str, payload: ReadingProgressIn) -> dict:
    if not resolve_book(ROOT, book_id):
        raise HTTPException(status_code=404, detail="book not found")
    existing = _books_map().get(book_id) or {}
    _set_book_field(
        book_id,
        status="done",
        current_page=int(payload.current_page or existing.get("current_page") or 0),
        total_pages=int(payload.total_pages or existing.get("total_pages") or 0),
        start_date=(payload.start_date or existing.get("start_date") or "").strip(),
        finish_date=(payload.finish_date or existing.get("finish_date") or "").strip(),
        notes=payload.notes or existing.get("notes", ""),
    )
    return {"book_id": book_id, "entry": _book_entry(_books_map()[book_id], book_id)}


# Want to read

@router.get("/want-to-read-books")
def get_want_to_read_books() -> dict:
    return _hydrate_want_to_read()


@router.post("/want-to-read-books")
def add_want_to_read_book(payload: AddBookIn) -> dict:
    if not load_book(ROOT, payload.book_id):
        raise HTTPException(status_code=404, detail="book not found")
    _set_book_field(payload.book_id, want_to_read=True)
    return _hydrate_want_to_read()


@router.delete("/want-to-read-books/{book_id}")
def remove_want_to_read_book(book_id: str) -> dict:
    _set_book_field(book_id, want_to_read=False)
    return _hydrate_want_to_read()


# Reading lists / collections

@router.get("/reading-lists")
def get_reading_lists() -> dict:
    return {"lists": _hydrate_lists(lists.list_all())}


@router.post("/reading-lists")
def create_reading_list(payload: CreateListIn) -> dict:
    try:
        lists.create_list(payload.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"lists": _hydrate_lists(lists.list_all())}


@router.patch("/reading-lists/{name}")
def rename_reading_list(name: str, payload: RenameListIn) -> dict:
    try:
        lists.rename_list(name, payload.name)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"lists": _hydrate_lists(lists.list_all())}


@router.delete("/reading-lists/{name}")
def delete_reading_list(name: str) -> dict:
    try:
        lists.delete_list(name)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"lists": _hydrate_lists(lists.list_all())}


@router.post("/reading-lists/{name}/books")
def add_book_to_list(name: str, payload: AddBookIn) -> dict:
    if not load_book(ROOT, payload.book_id):
        raise HTTPException(status_code=404, detail="book not found")
    try:
        lists.add_book(name, payload.book_id)
    except (KeyError, ValueError) as e:
        raise HTTPException(status_code=404 if isinstance(e, KeyError) else 400, detail=str(e)) from e
    return {"lists": _hydrate_lists(lists.list_all())}


@router.delete("/reading-lists/{name}/books/{book_id}")
def remove_book_from_list(name: str, book_id: str) -> dict:
    try:
        lists.remove_book(name, book_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"lists": _hydrate_lists(lists.list_all())}


# Stats

@router.get("/reading-stats")
def get_reading_stats() -> dict:
    entries = {
        bid: {
            "status": row.get("status", "not_started"),
            "total_pages": int(row.get("total_pages") or 0),
            "current_page": int(row.get("current_page") or 0),
            "start_date": row.get("start_date", ""),
            "finish_date": row.get("finish_date", ""),
        }
        for bid, row in _books_map().items()
        if isinstance(row, dict)
    }
    return {"periods": compute_reading_stats(entries), "activity": build_activity_payload(daily_stats.list_daily())}


@router.get("/stats")
def get_stats(
    year: int | None = Query(default=None, ge=1900, le=3000),
    month: int | None = Query(default=None, ge=1, le=12),
) -> dict:
    books = _books_map()

    available_years = {
        fd.year
        for row in books.values()
        if isinstance(row, dict) and (fd := _parse_iso_date(row.get("finish_date")))
    }

    selected = {
        bid: row
        for bid, row in books.items()
        if isinstance(row, dict)
        and str(row.get("status") or "").strip().lower() == "done"
        and (fd := _parse_iso_date(row.get("finish_date")))
        and (year is None or fd.year == year)
        and (month is None or fd.month == month)
    }

    books_list: list[dict] = []
    genres: set[str] = set()
    for book_id, row in selected.items():
        fd = _parse_iso_date(row.get("finish_date"))
        book = _stats_book_payload(book_id, row)
        books_list.append({**book, "finishDateObj": fd.isoformat() if fd else ""})
        genres.update(book.get("genres", []))

    books_list.sort(key=lambda b: (str(b.get("finishDate") or ""), str(b.get("title") or "")), reverse=True)

    def _days_spent(b: dict) -> int:
        s, f = _parse_iso_date(b.get("startDate")), _parse_iso_date(b.get("finishDate"))
        return max(1, (f - s).days + 1) if s and f and f >= s else 0

    densest = max(books_list, key=lambda b: int(b.get("totalPages") or 0), default=None)
    longest = max(books_list, key=_days_spent, default=None)

    if year is not None and month is not None:
        period_label = date(year, month, 1).strftime("%B %Y")
    elif year is not None:
        period_label = str(year)
    elif month is not None:
        period_label = date(2000, month, 1).strftime("%B")
    else:
        period_label = "All time"

    return {
        "year": year,
        "month": month,
        "period_label": period_label,
        "available_years": sorted(available_years, reverse=True),
        "books_read": len(books_list),
        "pages_read": sum(int(b.get("totalPages") or 0) for b in books_list),
        "genres_covered": len(genres),
        "genre_list": sorted(genres),
        "densest_book": densest,
        "most_time_spent": longest,
        "most_time_spent_days": _days_spent(longest) if longest else 0,
    }

# Obsidian 

@router.post("/sync/obsidian")
def sync_obsidian(dry_run: bool = Query(default=False)) -> dict:
    return _run_sync_obsidian(dry_run=dry_run)


# Scraper

@router.post("/scrape-book")
def scrape_book(payload: ScrapeBookIn) -> dict:
    url = payload.url.strip()
    uid_match = re.search(r"/book/show/(\d+)", url)
    if not uid_match:
        raise HTTPException(status_code=400, detail="Invalid Goodreads URL format")
    book_id = uid_match.group(1)
    scraper_timeout = int(os.getenv("SCRAPER_TIMEOUT_SECONDS", "180"))
    try:
        res = subprocess.run(
            [sys.executable, str(ROOT / "data" / "scraper.py"), "--import-one", url],
            cwd=ROOT / "data", capture_output=True, text=True, timeout=scraper_timeout,
        )
        if res.returncode != 0:
            raise HTTPException(status_code=500, detail=f"Scraper error: {res.stderr or res.stdout or 'unknown'}")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail=f"Scraper timed out after {scraper_timeout}s")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to run scraper: {e}") from e

    book = load_book_with_similar(ROOT, book_id)
    if not book:
        warnings = [ln.strip() for ln in res.stdout.splitlines() if any(tok in ln for tok in ("⚠️", "🚨", "error"))]
        detail = "Scraper completed but book not found in dataset."
        if warnings:
            detail += f" Details: {' | '.join(warnings)}"
        raise HTTPException(status_code=404, detail=detail)
    return {"ok": True, "book": book}

app.include_router(router)