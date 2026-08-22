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
        return {"query": q, "results": search_books(root, q, limit=limit)}

    @router.get("/global-library")
    def get_global_library_route() -> dict:
        return {"genres": get_global_library(root)}

    @router.get("/author-books")
    def get_author_books(author: str = Query(..., min_length=1)) -> dict:
        books = get_books_by_author(root, author)
        return {"author": author, "books": books, "count": len(books)}

    @router.get("/series-books")
    def get_series_books(series: str = Query(..., min_length=1)) -> dict:
        books = get_books_by_series(root, series)
        return {"series": series, "books": books, "count": len(books)}

    @router.get("/series-progress")
    def get_series_progress_route() -> dict:
        series = get_series_progress(root)
        return {"series": series, "count": len(series)}

    @router.get("/genre-books")
    def get_genre_books(genre: str = Query(..., min_length=1), limit: int = Query(default=100, ge=1, le=200)) -> dict:
        books = get_books_by_genre(root, genre, limit)
        return {"genre": genre, "books": books, "count": len(books)}

    return router
