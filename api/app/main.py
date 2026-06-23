from __future__ import annotations

from datetime import date
from pathlib import Path
import re
import subprocess
import sys

from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .catalog import (
    get_book as load_book,
    get_books_by_author,
    get_book_payload as load_book_payload,
    get_global_library as load_global_library,
    has_data,
    recommend_books,
    search_books,
    suggest_titles,
)
from .data_repository import DataRepository
from .finished_books import FinishedBooksStore
from .reading_lists import LikedBooksStore, ReadingListStore, ReadingProgressStore, WantToReadStore
from .obsidian_sync import (
    add_snapshot_book_to_dataset,
    apply_sync_selection,
    ignore_future_suggestion,
    load_obsidian_progress_entries,
    merge_snapshot_book_with_dataset,
    run_obsidian_sync,
    unlink_snapshot_book_from_dataset,
)
from .reading_stats import ReadingDailyStatsStore, build_activity_payload, compute_reading_stats

app = FastAPI(title="Atlas API", version="0.1.0")
lists = ReadingListStore(Path(__file__).resolve().parents[2])
liked = LikedBooksStore(Path(__file__).resolve().parents[2])
want_to_read = WantToReadStore(Path(__file__).resolve().parents[2])
progress = ReadingProgressStore(Path(__file__).resolve().parents[2])
finished_books = FinishedBooksStore(Path(__file__).resolve().parents[2])
ROOT = Path(__file__).resolve().parents[2]
repo = DataRepository(ROOT)
daily_stats = ReadingDailyStatsStore(ROOT)

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
    return {"ok": True, "has_data": has_data(ROOT)}


@app.get("/data-health")
def data_health() -> dict:
    return repo.data_health()


def _load_vault_entries_or_skip(mode: str) -> tuple[dict[str, dict], dict] | tuple[None, dict]:
    try:
        entries, meta = load_obsidian_progress_entries()
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
    book = load_book_payload(ROOT, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="book not found")
    return book


@app.get("/search")
def search(q: str = Query(..., min_length=1), limit: int = Query(default=10, ge=1, le=50)) -> dict:
    return {"query": q, "results": search_books(ROOT, q, limit=limit)}

@app.get("/search/suggest")
def search_suggest(q: str = Query(..., min_length=1), limit: int = Query(default=8, ge=1, le=20)) -> dict:
    return {"query": q, "suggestions": suggest_titles(ROOT, q, limit=limit)}


@app.get("/recommendations")
def recommendations(book_id: str = Query(...), limit: int = Query(default=5, ge=1, le=20)) -> dict:
    return {"book_id": book_id, "results": recommend_books(ROOT, book_id, limit=limit)}


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


class SyncSelectionIn(BaseModel):
    book_ids: list[str] = []


class SyncIgnoreIn(BaseModel):
    title: str = ""
    author: str = ""


class MergeSnapshotBookIn(BaseModel):
    dataset_book_id: str = ""


class FinishedBookIn(BaseModel):
    status: str = "done"
    current_page: int = 0
    total_pages: int = 0
    start_date: str = ""
    finish_date: str = ""
    notes: str = ""


def _hydrate_liked(book_ids: list[str]) -> dict:
    books = []
    for book_id in book_ids:
        b = load_book(ROOT, book_id)
        if b:
            books.append(b)
    return {"book_ids": [b.get("id") for b in books], "books": books, "count": len(books)}


def _hydrate_want_to_read(book_ids: list[str]) -> dict:
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


def _book_exists_for_progress(book_id: str) -> bool:
    if load_book(ROOT, book_id):
        return True
    obsidian = repo.read_obsidian_books_snapshot()
    books_map = obsidian.get("books", {})
    if isinstance(books_map, dict) and book_id in books_map:
        return True
    return False


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


@app.get("/liked-books")
def get_liked_books() -> dict:
    return _hydrate_liked(liked.list_all())


@app.post("/liked-books")
def add_liked_book(payload: AddBookIn) -> dict:
    if not load_book(ROOT, payload.book_id):
        raise HTTPException(status_code=404, detail="book not found")
    try:
        liked.add(payload.book_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return _hydrate_liked(liked.list_all())


@app.delete("/liked-books/{book_id}")
def remove_liked_book(book_id: str) -> dict:
    liked.remove(book_id)
    return _hydrate_liked(liked.list_all())


@app.get("/want-to-read-books")
def get_want_to_read_books() -> dict:
    return _hydrate_want_to_read(want_to_read.list_all())


@app.post("/want-to-read-books")
def add_want_to_read_book(payload: AddBookIn) -> dict:
    if not load_book(ROOT, payload.book_id):
        raise HTTPException(status_code=404, detail="book not found")
    try:
        want_to_read.add(payload.book_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return _hydrate_want_to_read(want_to_read.list_all())


@app.delete("/want-to-read-books/{book_id}")
def remove_want_to_read_book(book_id: str) -> dict:
    want_to_read.remove(book_id)
    return _hydrate_want_to_read(want_to_read.list_all())


@app.get("/reading-progress")
def get_reading_progress() -> dict:
    return {"entries": progress.list_all()}


@app.get("/global-library")
def get_global_library() -> dict:
    return {"genres": load_global_library(ROOT)}


@app.get("/author-books")
def get_author_books(author: str = Query(..., min_length=1)) -> dict:
    books = get_books_by_author(ROOT, author)
    return {"author": author, "books": books, "count": len(books)}


@app.get("/finished-books/{book_id}")
def get_finished_book(book_id: str) -> dict:
    entry = finished_books.get(book_id)
    if entry:
        return {"book_id": book_id, "entry": entry}

    progress_entry = progress.list_all().get(book_id, {})
    fallback = {
        "book_id": book_id,
        "entry": {
            "book_id": book_id,
            "status": "done",
            "current_page": int(progress_entry.get("current_page") or 0),
            "total_pages": int(progress_entry.get("total_pages") or 0),
            "start_date": str(progress_entry.get("start_date") or ""),
            "finish_date": str(progress_entry.get("finish_date") or ""),
            "notes": str(progress_entry.get("notes") or ""),
        },
    }
    return fallback


@app.put("/finished-books/{book_id}")
def upsert_finished_book(book_id: str, payload: FinishedBookIn) -> dict:
    if not load_book(ROOT, book_id):
        raise HTTPException(status_code=404, detail="book not found")
    row = finished_books.upsert(book_id, payload.model_dump())
    return {"book_id": book_id, "entry": row}


@app.get("/my-books")
def get_my_books() -> dict:
    progress_entries = progress.list_all()
    saved_want_to_read = set(want_to_read.list_all())
    books: list[dict] = []
    books_map: dict = {}

    obsidian_payload = repo.read_obsidian_books_snapshot()
    raw_books = obsidian_payload.get("books", {})
    if isinstance(raw_books, dict):
        books_map = raw_books

    for book_id, row in books_map.items():
        if not isinstance(row, dict):
            continue
        catalog_uid = str(row.get("catalog_uid") or "").strip()
        linked_catalog_book = load_book(ROOT, catalog_uid) if catalog_uid else None
        effective_color = str(row.get("color") or (linked_catalog_book or {}).get("color") or "")
        prog = progress_entries.get(str(book_id), {}) or {}
        books.append({
            **row,
            "catalog_uid": catalog_uid,
            "color": effective_color,
            "reading_status": str(prog.get("status") or row.get("status") or "not_started"),
            "reading_current_page": int(prog.get("current_page") or row.get("current_page") or row.get("total_pages") or 0),
            "reading_total_pages": int(prog.get("total_pages") or row.get("total_pages") or 0),
            "reading_finish_date": (prog.get("finish_date") or row.get("finish_date") or ""),
            "reading_start_date": (prog.get("start_date") or row.get("start_date") or ""),
            "saved_to_want_to_read": str(book_id) in saved_want_to_read,
            "linked_catalog_book": linked_catalog_book,
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
    if not _book_exists_for_progress(book_id):
        raise HTTPException(status_code=404, detail="book not found")
    status = (payload.status or "").strip().lower()
    if status not in {"not_started", "reading", "done"}:
        raise HTTPException(status_code=400, detail="invalid status")
    total_pages = max(0, int(payload.total_pages or 0))
    current_page = max(0, int(payload.current_page or 0))
    if total_pages > 0:
        current_page = min(current_page, total_pages)

    row = {
        "status": status,
        "total_pages": total_pages,
        "current_page": current_page,
        "start_date": (payload.start_date or "").strip(),
        "finish_date": (payload.finish_date or "").strip(),
        "notes": payload.notes or "",
    }
    progress.upsert(book_id, row)
    return {"book_id": book_id, "entry": row, "entries": progress.list_all()}


@app.get("/reading-stats")
def get_reading_stats() -> dict:
    entries = progress.list_all()
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
    obsidian_row = row if isinstance(row, dict) else {}
    catalog_uid = str(
        obsidian_row.get("catalog_uid")
        or obsidian_row.get("dataset_book_id")
        or ""
    ).strip()
    catalog = load_book(ROOT, catalog_uid) if catalog_uid else None
    if not isinstance(catalog, dict):
        catalog = {}

    genres = obsidian_row.get("genres") or catalog.get("genres", [])
    if not isinstance(genres, list):
        genres = [genres]
    clean_genres = [str(genre).strip() for genre in genres if str(genre).strip()]

    total_pages = int(
        obsidian_row.get("reading_total_pages")
        or obsidian_row.get("total_pages")
        or catalog.get("page_count")
        or 0
    )
    start_date = str(obsidian_row.get("start_date") or obsidian_row.get("reading_start_date") or "").strip()
    finish_date = str(obsidian_row.get("finish_date") or obsidian_row.get("reading_finish_date") or "").strip()
    title = str(obsidian_row.get("title") or catalog.get("title") or "Untitled")
    author = str(obsidian_row.get("author") or catalog.get("author") or "")
    cover = str(obsidian_row.get("image_url") or obsidian_row.get("cover") or catalog.get("image_url") or "")
    rating = obsidian_row.get("book_rating") or catalog.get("avg_rating") or 0
    rating_count = obsidian_row.get("book_rating_count") or catalog.get("rating_count") or 0
    review_count = obsidian_row.get("book_review_count") or catalog.get("review_count") or 0
    return {
        "id": book_id,
        "catalog_uid": catalog_uid,
        "catalogUid": catalog_uid,
        "title": title,
        "author": author,
        "cover": cover,
        "color": str(obsidian_row.get("color") or catalog.get("color") or ""),
        "tint": "220 30% 45%",
        "genre": clean_genres[0] if clean_genres else str(obsidian_row.get("genre") or catalog.get("genre") or ""),
        "genres": clean_genres,
        "pages": total_pages,
        "totalPages": total_pages,
        "currentPage": total_pages,
        "startDate": start_date,
        "finishDate": finish_date,
        "rating": float(rating or 0),
        "reviewCount": int(review_count or 0),
        "ratingCount": int(rating_count or 0),
        "progress": 100,
        "status": "done",
        "format": [],
        "blurb": str(obsidian_row.get("description") or catalog.get("description") or ""),
        "_raw": {**obsidian_row, **({"linked_catalog_book": catalog} if catalog else {})},
    }


def _build_stats_summary(year: int | None = None, month: int | None = None) -> dict:
    finished_rows = finished_books.list_all()
    progress_rows = progress.list_all()
    obsidian_payload = repo.read_obsidian_books_snapshot()
    obsidian_rows = obsidian_payload.get("books", {})
    if not isinstance(obsidian_rows, dict):
        obsidian_rows = {}

    available_years: set[int] = set()
    for row in obsidian_rows.values():
        if not isinstance(row, dict):
            continue
        finish_date = _parse_iso_date(row.get("finish_date") or row.get("reading_finish_date"))
        if finish_date:
            available_years.add(finish_date.year)
    for row in progress_rows.values():
        if not isinstance(row, dict):
            continue
        finish_date = _parse_iso_date(row.get("finish_date"))
        if finish_date:
            available_years.add(finish_date.year)

    selected: dict[str, dict] = {}
    all_book_ids = set(obsidian_rows.keys()) | set(finished_rows.keys()) | set(progress_rows.keys())
    for book_id in all_book_ids:
        obsidian_row = obsidian_rows.get(book_id, {}) if isinstance(obsidian_rows.get(book_id), dict) else {}
        finished_row = finished_rows.get(book_id, {}) if isinstance(finished_rows.get(book_id), dict) else {}
        progress_row = progress_rows.get(book_id, {}) if isinstance(progress_rows.get(book_id), dict) else {}
        row = {**obsidian_row, **finished_row, **progress_row}
        if str(row.get("status") or "done").strip().lower() != "done":
            continue
        finish_date = _parse_iso_date(row.get("finish_date") or row.get("reading_finish_date"))
        if not finish_date:
            continue
        if year is not None and finish_date.year != year:
            continue
        if month is not None and finish_date.month != month:
            continue
        selected[str(book_id)] = row

    books: list[dict] = []
    genres: set[str] = set()
    for book_id, row in selected.items():
        finish_date = _parse_iso_date(row.get("finish_date") or row.get("reading_finish_date"))
        book = _stats_book_payload(book_id, row)
        books.append({
            **book,
            "finishDateObj": finish_date.isoformat() if finish_date else "",
        })
        for genre in book.get("genres", []):
            genres.add(genre)

    books.sort(key=lambda item: (str(item.get("finishDate") or ""), str(item.get("title") or "")), reverse=True)
    densest_book = max(books, key=lambda item: int(item.get("pages") or 0), default=None)

    def _time_spent_days(item: dict) -> int:
        start = _parse_iso_date(item.get("startDate"))
        finish = _parse_iso_date(item.get("finishDate"))
        if not start or not finish or finish < start:
            return 0
        return max(1, (finish - start).days + 1)

    most_time_spent = max(books, key=_time_spent_days, default=None)
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
        "books_read": len(books),
        "pages_read": sum(int(book.get("pages") or 0) for book in books),
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


@app.post("/sync/obsidian")
def sync_obsidian(dry_run: bool = Query(default=True)) -> dict:
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
        "removed_bracket_author_entries": res.removed_bracket_author_entries,
        "proposed_books": [{"id": b.get("id"), "title": b.get("title"), "author": b.get("author")} for b in res.proposed_books],
        "periods": res.periods,
        "activity": build_activity_payload(daily_stats.list_daily()),
    }


@app.post("/sync/obsidian/apply")
def apply_obsidian_sync_selection(payload: SyncSelectionIn) -> dict:
    try:
        out = apply_sync_selection(Path(__file__).resolve().parents[2], payload.book_ids)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"apply failed: {e}") from e

    return {
        "ok": True,
        "applied_count": out.get("applied_count", 0),
        "applied_book_ids": out.get("applied_book_ids", []),
        "periods": compute_reading_stats(progress.list_all()),
        "activity": build_activity_payload(daily_stats.list_daily()),
    }


@app.post("/sync/obsidian/ignore")
def ignore_obsidian_suggestion(payload: SyncIgnoreIn) -> dict:
    title = (payload.title or "").strip()
    author = (payload.author or "").strip()
    if not title and not author:
        raise HTTPException(status_code=400, detail="title or author is required")
    out = ignore_future_suggestion(Path(__file__).resolve().parents[2], title=title, author=author)
    return {"ok": True, **out}


@app.post("/my-books/{book_id}/add-to-dataset")
def add_my_book_to_dataset(book_id: str) -> dict:
    try:
        out = add_snapshot_book_to_dataset(Path(__file__).resolve().parents[2], book_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"dataset add failed: {e}") from e
    return {"ok": True, **out}


@app.get("/my-books/{book_id}/add-to-dataset")
def add_my_book_to_dataset_get_compat(book_id: str) -> dict:
    # Compatibility path for proxy stacks that downgrade redirected POST -> GET.
    try:
        out = add_snapshot_book_to_dataset(Path(__file__).resolve().parents[2], book_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"dataset add failed: {e}") from e
    return {"ok": True, **out, "method_compat": "GET"}


@app.post("/my-books/{book_id}/merge")
def merge_my_book(book_id: str, payload: MergeSnapshotBookIn) -> dict:
    dataset_book_id = (payload.dataset_book_id or "").strip()
    if not dataset_book_id:
        raise HTTPException(status_code=400, detail="dataset_book_id is required")
    if not load_book(ROOT, dataset_book_id):
        raise HTTPException(status_code=404, detail="dataset book not found")
    try:
        out = merge_snapshot_book_with_dataset(Path(__file__).resolve().parents[2], book_id, dataset_book_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"merge failed: {e}") from e
    return {"ok": True, **out}


@app.post("/my-books/{book_id}/unlink")
def unlink_my_book(book_id: str) -> dict:
    try:
        out = unlink_snapshot_book_from_dataset(Path(__file__).resolve().parents[2], book_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"unlink failed: {e}") from e
    return {"ok": True, **out}


# ---------------------------------------------------------------------------
# /api/* router — mirrors all routes the frontend calls so that both the Vite
# dev proxy (/api → FastAPI at /api/...) and production reverse proxies work
# without any URL rewriting on either side.
# ---------------------------------------------------------------------------

api_router = APIRouter(prefix="/api")


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


@api_router.get("/liked-books")
def api_get_liked_books() -> dict:
    return get_liked_books()


@api_router.post("/liked-books")
def api_add_liked_book(payload: AddBookIn) -> dict:
    return add_liked_book(payload)


@api_router.delete("/liked-books/{book_id}")
def api_remove_liked_book(book_id: str) -> dict:
    return remove_liked_book(book_id)


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


@api_router.get("/search/suggest")
def api_search_suggest(q: str = Query(..., min_length=1), limit: int = Query(default=8, ge=1, le=20)) -> dict:
    return search_suggest(q=q, limit=limit)


@api_router.get("/book/{book_id}")
def api_get_book(book_id: str) -> dict:
    return get_book(book_id)


@api_router.get("/recommendations")
def api_recommendations(book_id: str = Query(...), limit: int = Query(default=5, ge=1, le=20)) -> dict:
    return recommendations(book_id=book_id, limit=limit)


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
        
    book = load_book_payload(ROOT, book_id)
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
