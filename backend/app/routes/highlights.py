from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pathlib import Path
from pydantic import BaseModel

from ..services.catalog import resolve_book as load_book
from ..services.highlights import HighlightStore


class CreateHighlightIn(BaseModel):
    book_id: str
    text: str
    page: int = 0


# `None` means leave alone; an empty string is a real value (clearing a note).
class UpdateHighlightIn(BaseModel):
    text: str | None = None
    page: int | None = None
    note: str | None = None


def create_router(root: Path, highlights: HighlightStore) -> APIRouter:
    router = APIRouter()

    def _group(book_id: str) -> dict:
        """One book's highlights with the book, the mutation response shape."""
        items = highlights.list_for_book(book_id)
        return {
            "book_id": book_id,
            "book": load_book(root, book_id),
            "count": len(items),
            "highlights": items,
        }

    @router.get("/highlights")
    def get_highlights() -> dict:
        # Drop books whose catalog row has gone, rather than sending a null book.
        groups = [
            {"book_id": group["book_id"], "book": book, "count": len(group["highlights"]), "highlights": group["highlights"]}
            for group in highlights.list_all()
            if (book := load_book(root, group["book_id"]))
        ]
        return {"groups": groups}

    @router.post("/highlights")
    def create_highlight(payload: CreateHighlightIn) -> dict:
        if not load_book(root, payload.book_id):
            raise HTTPException(status_code=404, detail="book not found")
        try:
            highlights.create(payload.book_id, payload.text, payload.page)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        return _group(payload.book_id)

    @router.patch("/highlights/{highlight_id}")
    def update_highlight(highlight_id: int, payload: UpdateHighlightIn) -> dict:
        fields = payload.model_dump(exclude_none=True)
        try:
            book_id = highlights.book_id_for(highlight_id)
            highlights.update(highlight_id, **fields)
        except KeyError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        return _group(book_id)

    @router.delete("/highlights/{highlight_id}")
    def delete_highlight(highlight_id: int) -> dict:
        try:
            # Read before the delete so the response can still name the group.
            book_id = highlights.book_id_for(highlight_id)
            highlights.delete(highlight_id)
        except KeyError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        return _group(book_id)

    return router
