from __future__ import annotations

from pathlib import Path
import json

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .reading_lists import LikedBooksStore, ReadingListStore, ReadingProgressStore
from .obsidian_sync import apply_sync_selection, ignore_future_suggestion, load_obsidian_progress_entries, run_obsidian_sync
from .reading_stats import ReadingDailyStatsStore, build_activity_payload, compute_reading_stats
from .store import AtlasStore

app = FastAPI(title="Atlas API", version="0.1.0")
store = AtlasStore()
lists = ReadingListStore(Path(__file__).resolve().parents[2])
liked = LikedBooksStore(Path(__file__).resolve().parents[2])
progress = ReadingProgressStore(Path(__file__).resolve().parents[2])
ROOT = Path(__file__).resolve().parents[2]
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
    return {"ok": True, "has_data": store.has_data()}


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


@app.get("/points")
def points(zoom: str = Query(default="near"), max_points: int = Query(default=12000, ge=500, le=100000)) -> dict:
    level = zoom if zoom in {"far", "mid", "near"} else "near"
    points_out = store.points_for_zoom(level, max_points=max_points)
    return {"zoom": level, "points": points_out, "count": len(points_out), "total_count": len(store.points)}


@app.get("/book/{book_id}")
def get_book(book_id: str) -> dict:
    book = store.get_book(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="book not found")
    return book


@app.get("/search")
def search(q: str = Query(..., min_length=1), limit: int = Query(default=10, ge=1, le=50)) -> dict:
    return {"query": q, "results": store.search(q, limit=limit)}

@app.get("/search/suggest")
def search_suggest(q: str = Query(..., min_length=1), limit: int = Query(default=8, ge=1, le=20)) -> dict:
    return {"query": q, "suggestions": store.suggest_titles(q, limit=limit)}


@app.get("/recommendations")
def recommendations(book_id: str = Query(...), limit: int = Query(default=5, ge=1, le=20)) -> dict:
    return {"book_id": book_id, "results": store.recommend(book_id, limit=limit)}


@app.get("/cluster/random")
def random_cluster() -> dict:
    point = store.random_cluster_point()
    if not point:
        raise HTTPException(status_code=404, detail="no points")
    return {"point": point}


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


def _hydrate_liked(book_ids: list[str]) -> dict:
    books = []
    for book_id in book_ids:
        b = store.get_book(book_id)
        if b:
            books.append(b)
    return {"book_ids": [b.get("id") for b in books], "books": books, "count": len(books)}


def _hydrate_lists(rows: list[dict]) -> list[dict]:
    out = []
    for row in rows:
        books = []
        for book_id in row.get("books", []):
            b = store.get_book(book_id)
            if b:
                books.append(b)
        out.append({"name": row.get("name", ""), "book_ids": row.get("books", []), "books": books, "count": len(books)})
    return out


def _book_exists_for_progress(book_id: str) -> bool:
    if store.get_book(book_id):
        return True
    all_books_path = ROOT / "user_data" / "all_books.json"
    if all_books_path.exists():
        try:
            with all_books_path.open("r", encoding="utf-8") as f:
                payload = json.load(f) or {}
            books_map = payload.get("books", {})
            if isinstance(books_map, dict) and book_id in books_map:
                return True
        except Exception:
            return False
    obsidian_books_path = ROOT / "user_data" / "obsidian_books.json"
    if obsidian_books_path.exists():
        try:
            with obsidian_books_path.open("r", encoding="utf-8") as f:
                payload = json.load(f) or {}
            books_map = payload.get("books", {})
            if isinstance(books_map, dict) and book_id in books_map:
                return True
        except Exception:
            return False
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
    if not store.get_book(payload.book_id):
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
    if not store.get_book(payload.book_id):
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


@app.get("/reading-progress")
def get_reading_progress() -> dict:
    return {"entries": progress.list_all()}


@app.get("/my-books")
def get_my_books() -> dict:
    user_dir = Path(__file__).resolve().parents[2] / "user_data"
    all_books_path = user_dir / "all_books.json"
    obsidian_books_path = user_dir / "obsidian_books.json"
    progress_entries = progress.list_all()
    books: list[dict] = []
    books_map: dict = {}

    # Primary source: full Obsidian sync snapshot ("My Books").
    if all_books_path.exists():
        try:
            with all_books_path.open("r", encoding="utf-8") as f:
                payload = json.load(f) or {}
            raw_books = payload.get("books", {})
            if isinstance(raw_books, dict):
                books_map = raw_books
        except Exception:
            books_map = {}

    # Fallback for pre-snapshot installs.
    if not books_map and obsidian_books_path.exists():
        try:
            with obsidian_books_path.open("r", encoding="utf-8") as f:
                payload = json.load(f) or {}
            raw_books = payload.get("books", {})
            if isinstance(raw_books, dict):
                books_map = raw_books
        except Exception:
            books_map = {}

    for book_id, row in books_map.items():
        if not isinstance(row, dict):
            continue
        prog = progress_entries.get(str(book_id), {}) or {}
        books.append({
            **row,
            "reading_status": str(prog.get("status") or row.get("status") or "not_started"),
            "reading_current_page": int(prog.get("current_page") or row.get("current_page") or row.get("total_pages") or 0),
            "reading_total_pages": int(prog.get("total_pages") or row.get("total_pages") or 0),
            "reading_finish_date": (prog.get("finish_date") or row.get("finish_date") or ""),
            "reading_start_date": (prog.get("start_date") or row.get("start_date") or ""),
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

    if not dry_run:
        store.reload()
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

    store.reload()
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
