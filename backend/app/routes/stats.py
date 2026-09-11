from __future__ import annotations

from datetime import date, timedelta
from fastapi import APIRouter, Query
from pathlib import Path

from ..repository import DataRepository
from ..services.catalog import reading_overlay, resolve_book as load_book
from ..utils import parse_iso_date


def _pages(book: dict) -> int:
    return int(book.get("reading_total_pages") or 0)


def _span(book: dict) -> tuple[date, date] | None:
    """The book's first-page-to-last-page window, or None if it isn't dated."""
    start = parse_iso_date(book.get("reading_start_date"))
    finish = parse_iso_date(book.get("reading_finish_date"))
    if not start or not finish or finish < start:
        return None
    return start, finish


def _days_reading(books_list: list[dict]) -> int:
    """Calendar days with a book open, counted once.

    A union rather than a sum of per-book spans: two books read side by side
    over the same fortnight is a fortnight of reading, not a month of it.
    """
    days: set[date] = set()
    for book in books_list:
        span = _span(book)
        if not span:
            continue
        day, finish = span
        while day <= finish:
            days.add(day)
            day += timedelta(days=1)
    return len(days)


def _months(books_list: list[dict]) -> list[int]:
    """Books finished per calendar month, January first.

    Always twelve entries — the chart draws a full year, so an empty month is a
    zero-height bar rather than a missing column.
    """
    counts = [0] * 12
    for book in books_list:
        if finish := parse_iso_date(book.get("reading_finish_date")):
            counts[finish.month - 1] += 1
    return counts


def create_router(root: Path, repo: DataRepository) -> APIRouter:
    router = APIRouter()

    def _stats_book_payload(book_id: str, row: dict) -> dict:
        catalog = load_book(root, book_id) or {}
        return {
            **catalog,
            **reading_overlay(row, catalog.get("page_count")),
            "id": book_id,
            "linked_catalog_book": catalog or None,
        }

    @router.get("/stats")
    def get_stats(year: int | None = Query(default=None, ge=1900, le=3000)) -> dict:
        books = repo.list_book_states()

        available_years = {
            fd.year
            for row in books.values()
            if (fd := parse_iso_date(row.get("finish_date")))
        }

        selected = {
            bid: row
            for bid, row in books.items()
            if str(row.get("status") or "").strip().lower() == "done"
            and (fd := parse_iso_date(row.get("finish_date")))
            and (year is None or fd.year == year)
        }

        books_list: list[dict] = []
        genres: set[str] = set()
        for book_id, row in selected.items():
            book = _stats_book_payload(book_id, row)
            books_list.append(book)
            genres.update(book.get("genres", []))

        # Oldest first, so the covers read left to right the way the year did.
        books_list.sort(key=lambda b: (str(b.get("reading_finish_date") or ""), str(b.get("title") or "")))

        return {
            "year": year,
            "available_years": sorted(available_years, reverse=True),
            "books_read": len(books_list),
            "pages_read": sum(_pages(b) for b in books_list),
            "genres_covered": len(genres),
            "genre_list": sorted(genres),
            "days_reading": _days_reading(books_list),
            "months": _months(books_list),
            "books": books_list,
        }

    return router
