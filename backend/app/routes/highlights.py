from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services import highlights as store
from ..services.catalog import resolve_book

router = APIRouter()


class CreateHighlightIn(BaseModel):
    book_id: str
    text: str
    page: int = 0


# `None` means leave alone; an empty string is a real value (clearing a note).
class UpdateHighlightIn(BaseModel):
    text: str | None = None
    page: int | None = None
    note: str | None = None


def _all() -> dict:
    return {"highlights": store.list_all()}


@router.get("/highlights")
def get_highlights() -> dict:
    return _all()


@router.post("/highlights")
def create_highlight(payload: CreateHighlightIn) -> dict:
    if not resolve_book(payload.book_id):
        raise HTTPException(status_code=404, detail="book not found")
    try:
        store.create(payload.book_id, payload.text, payload.page)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return _all()


@router.patch("/highlights/{highlight_id}")
def update_highlight(highlight_id: int, payload: UpdateHighlightIn) -> dict:
    try:
        store.update(highlight_id, **payload.model_dump(exclude_none=True))
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return _all()


@router.delete("/highlights/{highlight_id}")
def delete_highlight(highlight_id: int) -> dict:
    try:
        store.delete(highlight_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return _all()
