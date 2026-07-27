from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pathlib import Path
from pydantic import BaseModel

from ..repository import DataRepository
from ..services.catalog import resolve_book


class ReadingProgressIn(BaseModel):
    status: str = "not_started"
    current_page: int = 0
    total_pages: int = 0
    start_date: str = ""
    finish_date: str = ""
    notes: str = ""


def create_router(root: Path, repo: DataRepository) -> APIRouter:
    router = APIRouter()

    def _book_entry(record: dict, book_id: str) -> dict:
        """Serialise a user_book_state row into the standard progress entry shape."""
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
        return {
            "book_id": book_id,
            "status": status,
            "current_page": 0,
            "total_pages": 0,
            "start_date": "",
            "finish_date": "",
            "notes": "",
        }

    @router.get("/my-books")
    def get_my_books() -> dict:
        books: list[dict] = []
        for book_id, row in repo.list_book_states().items():
            status = str(row.get("status") or "not_started").strip().lower()
            if status not in {"reading", "done"}:
                continue
            catalog = resolve_book(root, book_id) or {}
            books.append({
                "id": str(book_id),
                "title": str(catalog.get("title") or ""),
                "author": str(catalog.get("author") or ""),
                "image_url": str(catalog.get("image_url") or ""),
                "genres": catalog.get("genres", []),
                "rating": catalog.get("avg_rating") or 0,
                "description": str(catalog.get("description") or ""),
                "color": str(catalog.get("color") or ""),
                "reading_status": status,
                "reading_current_page": int(row.get("current_page") or 0),
                "reading_total_pages": int(row.get("total_pages") or 0),
                "reading_finish_date": row.get("finish_date", ""),
                "reading_start_date": row.get("start_date", ""),
                "linked_catalog_book": catalog or None,
                "notes": row.get("notes", ""),
                "liked": row.get("liked", False),
                "want_to_read": row.get("want_to_read", False),
            })
        books.sort(
            key=lambda b: (str(b.get("reading_finish_date") or ""), str(b.get("reading_start_date") or ""), str(b.get("title") or "")),
            reverse=True,
        )
        return {"books": books, "count": len(books)}

    @router.get("/reading-progress/{book_id}")
    def get_reading_progress_entry(book_id: str) -> dict:
        record = repo.get_book_state(book_id)
        if record is None:
            if not resolve_book(root, book_id):
                raise HTTPException(status_code=404, detail="book not found")
            return {"book_id": book_id, "entry": _empty_entry(book_id)}
        return {"book_id": book_id, "entry": _book_entry(record, book_id)}

    @router.put("/reading-progress/{book_id}")
    def upsert_reading_progress(book_id: str, payload: ReadingProgressIn) -> dict:
        if not resolve_book(root, book_id) and repo.get_book_state(book_id) is None:
            raise HTTPException(status_code=404, detail="book not found")
        status = (payload.status or "").strip().lower()
        if status not in {"not_started", "reading", "done"}:
            raise HTTPException(status_code=400, detail="invalid status")
        total_pages = max(0, int(payload.total_pages or 0))
        current_page = min(max(0, int(payload.current_page or 0)), total_pages or 999_999)
        entry = repo.upsert_book_state(
            book_id,
            status=status,
            total_pages=total_pages,
            current_page=current_page,
            start_date=(payload.start_date or "").strip(),
            finish_date=(payload.finish_date or "").strip(),
            notes=payload.notes or "",
        )
        return {"book_id": book_id, "entry": _book_entry(entry, book_id)}

    return router
