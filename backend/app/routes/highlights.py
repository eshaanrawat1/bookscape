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


# Every field optional: the highlights page patches the note on its own, and the
# page or text on their own, so a partial payload is the normal case rather than
# the exception. `None` means "leave it alone" — an empty string is a real value
# here, since clearing a note is something you can do.
class UpdateHighlightIn(BaseModel):
    text: str | None = None
    page: int | None = None
    note: str | None = None


def create_router(root: Path, highlights: HighlightStore) -> APIRouter:
    router = APIRouter()

    def _group(book_id: str) -> dict:
        """One book's highlights with the book itself, the mutation response shape.

        Returning only the touched book rather than the whole corpus the way the
        collection routes do: a library's highlights grow without bound, and the
        client only ever needs the group it just changed.
        """
        items = highlights.list_for_book(book_id)
        return {
            "book_id": book_id,
            "book": load_book(root, book_id),
            "count": len(items),
            "highlights": items,
        }

    @router.get("/highlights")
    def get_highlights() -> dict:
        # A book whose catalog row has gone is dropped rather than sent with a
        # null book: the page is a list of books, and a row it cannot draw a
        # cover or title for is not one.
        groups = [
            {"book_id": group["book_id"], "book": book, "count": len(group["highlights"]), "highlights": group["highlights"]}
            for group in highlights.list_all()
            if (book := load_book(root, group["book_id"]))
        ]
        return {"groups": groups, "count": sum(group["count"] for group in groups)}

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
            # Read the owner before the row goes, so the response can still name
            # the group the client has to refresh.
            book_id = highlights.book_id_for(highlight_id)
            highlights.delete(highlight_id)
        except KeyError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        return _group(book_id)

    return router
