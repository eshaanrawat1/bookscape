from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pathlib import Path

from ..services.catalog import (
    get_book_with_similar,
    get_books_by_author,
    get_books_by_genre,
    get_books_by_series,
    get_global_library,
    get_series_progress,
    get_suggested_books,
    search_books,
)


def create_router(root: Path) -> APIRouter:
    router = APIRouter()

    @router.get("/book/{book_id}")
    def get_book(book_id: str) -> dict:
        book = get_book_with_similar(root, book_id)
        if not book:
            raise HTTPException(status_code=404, detail="book not found")
        return book

    @router.get("/search")
    def search(q: str = Query(..., min_length=1), limit: int = Query(default=10, ge=1, le=50)) -> dict:
        return {"results": search_books(root, q, limit=limit)}

    @router.get("/global-library")
    def get_global_library_route() -> dict:
        return {"genres": get_global_library(root)}

    @router.get("/author-books")
    def get_author_books(author: str = Query(..., min_length=1)) -> dict:
        return {"books": get_books_by_author(root, author)}

    @router.get("/series-books")
    def get_series_books(series: str = Query(..., min_length=1)) -> dict:
        return {"books": get_books_by_series(root, series)}

    @router.get("/series-progress")
    def get_series_progress_route() -> dict:
        return {"series": get_series_progress(root)}

    @router.get("/suggested-books")
    def get_suggested_books_route() -> dict:
        return {"books": get_suggested_books(root)}

    @router.get("/genre-books")
    def get_genre_books(genre: str = Query(..., min_length=1), limit: int = Query(default=100, ge=1, le=200)) -> dict:
        return {"books": get_books_by_genre(root, genre, limit)}

    return router
