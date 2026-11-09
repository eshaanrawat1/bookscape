from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services import collections as store
from ..services.catalog import resolve_book

router = APIRouter()


class CreateCollectionIn(BaseModel):
    name: str


# `None` means "leave it alone": an empty icon is a real value, the default dot.
class UpdateCollectionIn(BaseModel):
    name: str | None = None
    icon: str | None = None


class AddBookIn(BaseModel):
    book_id: str


def _all() -> dict:
    return {"collections": store.list_all()}


@router.get("/collections")
def get_collections() -> dict:
    return _all()


@router.post("/collections")
def create_collection(payload: CreateCollectionIn) -> dict:
    try:
        created = store.create(payload.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"id": created, **_all()}


@router.patch("/collections/{collection_id}")
def update_collection(collection_id: int, payload: UpdateCollectionIn) -> dict:
    try:
        store.update(collection_id, name=payload.name, icon=payload.icon)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return _all()


@router.delete("/collections/{collection_id}")
def delete_collection(collection_id: int) -> dict:
    try:
        store.delete(collection_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return _all()


@router.post("/collections/{collection_id}/books")
def add_book(collection_id: int, payload: AddBookIn) -> dict:
    if not resolve_book(payload.book_id):
        raise HTTPException(status_code=404, detail="book not found")
    try:
        store.add_book(collection_id, payload.book_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return _all()


@router.delete("/collections/{collection_id}/books/{book_id}")
def remove_book(collection_id: int, book_id: str) -> dict:
    try:
        store.remove_book(collection_id, book_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return _all()
