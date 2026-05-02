from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .reading_lists import LikedBooksStore, ReadingListStore, ReadingProgressStore
from .store import AtlasStore

app = FastAPI(title="Atlas API", version="0.1.0")
store = AtlasStore()
lists = ReadingListStore(Path(__file__).resolve().parents[2])
liked = LikedBooksStore(Path(__file__).resolve().parents[2])
progress = ReadingProgressStore(Path(__file__).resolve().parents[2])

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "has_data": store.has_data()}


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


@app.put("/reading-progress/{book_id}")
def upsert_reading_progress(book_id: str, payload: ReadingProgressIn) -> dict:
    if not store.get_book(book_id):
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
