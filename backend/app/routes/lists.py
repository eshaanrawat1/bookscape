from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pathlib import Path
from pydantic import BaseModel

from ..repository import DataRepository
from ..services.catalog import resolve_book as load_book
from ..services.reading import ReadingListStore


class CreateListIn(BaseModel):
    name: str


class RenameListIn(BaseModel):
    name: str


class AddBookIn(BaseModel):
    book_id: str


def create_router(root: Path, repo: DataRepository, lists: ReadingListStore) -> APIRouter:
    router = APIRouter()

    def _hydrate_lists(rows: list[dict]) -> list[dict]:
        out = []
        for row in rows:
            books = [b for bid in row.get("books", []) if (b := load_book(root, bid))]
            out.append({
                "name": row.get("name", ""),
                "book_ids": row.get("books", []),
                "books": books,
                "count": len(books),
            })
        return out

    def _hydrate_want_to_read() -> dict:
        books = [
            b for uid, row in repo.list_book_states().items()
            if row.get("want_to_read")
            if (b := load_book(root, uid))
        ]
        return {"book_ids": [b.get("id") for b in books], "books": books, "count": len(books)}

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
        if not load_book(root, payload.book_id):
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

    @router.get("/want-to-read-books")
    def get_want_to_read_books() -> dict:
        return _hydrate_want_to_read()

    @router.post("/want-to-read-books")
    def add_want_to_read_book(payload: AddBookIn) -> dict:
        if not load_book(root, payload.book_id):
            raise HTTPException(status_code=404, detail="book not found")
        repo.upsert_book_state(payload.book_id, want_to_read=True)
        return _hydrate_want_to_read()

    @router.delete("/want-to-read-books/{book_id}")
    def remove_want_to_read_book(book_id: str) -> dict:
        repo.upsert_book_state(book_id, want_to_read=False)
        return _hydrate_want_to_read()

    return router
