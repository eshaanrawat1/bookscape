from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pathlib import Path
from pydantic import BaseModel

from ..repository import DataRepository
from ..services.catalog import list_books, resolve_book, search_book_ids
from ..utils import clamp_my_rating

VALID_STATUSES = {"not_started", "want", "reading", "done", "dnf"}


class BookStateIn(BaseModel):
    status: str = "not_started"
    current_page: int = 0
    total_pages: int = 0
    start_date: str = ""
    finish_date: str = ""
    my_rating: float = 0
    notes: str = ""


def create_router(root: Path, repo: DataRepository) -> APIRouter:
    router = APIRouter()

    @router.get("/books")
    def get_books() -> dict:
        return {"books": list_books(root)}

    @router.get("/search")
    def search(q: str = Query(..., min_length=1), limit: int = Query(default=10, ge=1, le=50)) -> dict:
        return {"ids": search_book_ids(root, q, limit=limit)}

    @router.put("/books/{book_id}/state")
    def put_book_state(book_id: str, payload: BookStateIn) -> dict:
        if not resolve_book(root, book_id):
            raise HTTPException(status_code=404, detail="book not found")
        status = (payload.status or "").strip().lower()
        if status not in VALID_STATUSES:
            raise HTTPException(status_code=400, detail="invalid status")
        total_pages = max(0, int(payload.total_pages or 0))
        repo.upsert_book_state(
            book_id,
            status=status,
            total_pages=total_pages,
            current_page=min(max(0, int(payload.current_page or 0)), total_pages or 999_999),
            start_date=(payload.start_date or "").strip(),
            finish_date=(payload.finish_date or "").strip(),
            my_rating=clamp_my_rating(payload.my_rating),
            notes=payload.notes or "",
        )
        return {"book": resolve_book(root, book_id)}

    return router
