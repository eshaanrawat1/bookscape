from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..services.catalog import Status, list_books, resolve_book, search_book_ids, upsert_book_state
from ..utils import clamp_my_rating

router = APIRouter()


class BookStateIn(BaseModel):
    status: Status = "not_started"
    current_page: int = 0
    total_pages: int = 0
    start_date: str = ""
    finish_date: str = ""
    my_rating: float = 0
    notes: str = ""


@router.get("/books")
def get_books() -> dict:
    return {"books": list_books()}


@router.get("/search")
def search(q: str = Query(..., min_length=1), limit: int = Query(default=10, ge=1, le=50)) -> dict:
    return {"ids": search_book_ids(q, limit=limit)}


@router.put("/books/{book_id}/state")
def put_book_state(book_id: str, payload: BookStateIn) -> dict:
    if not resolve_book(book_id):
        raise HTTPException(status_code=404, detail="book not found")
    total_pages = max(0, payload.total_pages)
    upsert_book_state(
        book_id,
        **{
            **payload.model_dump(),
            "total_pages": total_pages,
            "current_page": min(max(0, payload.current_page), total_pages or 999_999),
            "my_rating": clamp_my_rating(payload.my_rating),
        },
    )
    return {"book": resolve_book(book_id)}
