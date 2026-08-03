from __future__ import annotations

from datetime import date
from fastapi import APIRouter, Query
from pathlib import Path

from ..repository import DataRepository
from ..services import heatmap
from ..services.catalog import resolve_book as load_book
from ..utils import parse_iso_date, parse_iso_date_string


def _pages(book: dict) -> int:
    return int(book.get("totalPages") or 0)


# The carousel's cards, in priority order. `rank` sorts candidates best-first and
# `eligible` drops books the card cannot honestly describe (a book with no page
# count is not the shortest one, it is unmeasured). `value`/`unit` are split so
# the card can typeset the number large and the unit small.
#
# Order is load-bearing: picking is de-duplicated, so an earlier card claims its
# winner outright and a later one falls through to its next-best book. Densest
# and longest lead because they are the two the page has always shown.
def _featured_specs(days_spent) -> list[dict]:
    def pace(book: dict) -> float:
        days = days_spent(book)
        return _pages(book) / days if days else 0.0

    return [
        {
            "key": "densest",
            "label": "Densest book",
            "unit": "pages",
            "eligible": lambda b: _pages(b) > 0,
            "rank": _pages,
            "value": lambda b: _pages(b),
        },
        {
            "key": "longest",
            "label": "Most time spent",
            "unit": "days from first page to last",
            "eligible": lambda b: days_spent(b) > 0,
            "rank": days_spent,
            "value": days_spent,
        },
        {
            "key": "fastest",
            "label": "Fastest read",
            "unit": "days",
            "eligible": lambda b: days_spent(b) > 0,
            "rank": lambda b: -days_spent(b),
            "value": days_spent,
        },
        {
            "key": "pace",
            "label": "Best pace",
            "unit": "pages a day",
            "eligible": lambda b: pace(b) > 0,
            "rank": pace,
            "value": lambda b: round(pace(b)),
        },
        # Goodreads' numbers, not the reader's own — the labels say "crowd" and
        # "deepest cut" rather than "highest rated" so the page never implies
        # these are personal ratings.
        {
            "key": "acclaimed",
            "label": "Crowd favourite",
            "unit": "average rating",
            "eligible": lambda b: float(b.get("rating") or 0) > 0,
            "rank": lambda b: float(b.get("rating") or 0),
            "value": lambda b: round(float(b.get("rating") or 0), 2),
        },
        {
            "key": "obscure",
            "label": "Deepest cut",
            "unit": "ratings on Goodreads",
            "eligible": lambda b: int(b.get("ratingCount") or 0) > 0,
            "rank": lambda b: -int(b.get("ratingCount") or 0),
            "value": lambda b: int(b.get("ratingCount") or 0),
        },
    ]


def _featured_books(books_list: list[dict], days_spent) -> list[dict]:
    """Pick one book per superlative, never repeating a book across cards.

    Filtering to a single month can leave two or three books, at which point one
    of them legitimately wins nearly every category. Showing the same cover six
    times reads as a bug, so each card takes the best book not already claimed
    and is dropped entirely once no eligible book is left.
    """
    claimed: set[str] = set()
    cards: list[dict] = []
    for spec in _featured_specs(days_spent):
        pool = [
            b for b in books_list
            if str(b.get("id")) not in claimed and spec["eligible"](b)
        ]
        if not pool:
            continue
        winner = max(pool, key=spec["rank"])
        claimed.add(str(winner.get("id")))
        cards.append({
            "key": spec["key"],
            "label": spec["label"],
            "value": spec["value"](winner),
            "unit": spec["unit"],
            "book": winner,
        })
    return cards


def create_router(root: Path, repo: DataRepository) -> APIRouter:
    router = APIRouter()

    def _stats_book_payload(book_id: str, row: dict) -> dict:
        catalog = load_book(root, book_id) or {}
        genres = catalog.get("genres", [])
        if not isinstance(genres, list):
            genres = [genres]
        clean_genres = [str(g).strip() for g in genres if str(g).strip()]
        total_pages = int(row.get("total_pages") or catalog.get("page_count") or 0)
        return {
            "id": book_id,
            "title": str(catalog.get("title") or "Untitled"),
            "author": str(catalog.get("author") or ""),
            "cover": str(catalog.get("image_url") or ""),
            "color": str(catalog.get("color") or ""),
            "tint": "220 30% 45%",
            "genre": clean_genres[0] if clean_genres else "",
            "genres": clean_genres,
            "totalPages": total_pages,
            "currentPage": total_pages,
            "startDate": str(row.get("start_date") or "").strip(),
            "finishDate": str(row.get("finish_date") or "").strip(),
            "rating": float(catalog.get("avg_rating") or 0),
            "reviewCount": int(catalog.get("review_count") or 0),
            "ratingCount": int(catalog.get("rating_count") or 0),
            "progress": 100,
            "status": "done",
            "blurb": str(catalog.get("description") or ""),
            "_raw": {**row, **({"linked_catalog_book": catalog} if catalog else {})},
        }

    @router.get("/stats")
    def get_stats(
        year: int | None = Query(default=None, ge=1900, le=3000),
        month: int | None = Query(default=None, ge=1, le=12),
    ) -> dict:
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
            and (month is None or fd.month == month)
        }

        books_list: list[dict] = []
        genres: set[str] = set()
        for book_id, row in selected.items():
            fd = parse_iso_date(row.get("finish_date"))
            book = _stats_book_payload(book_id, row)
            books_list.append({**book, "finishDateObj": fd.isoformat() if fd else ""})
            genres.update(book.get("genres", []))

        books_list.sort(key=lambda b: (str(b.get("finishDate") or ""), str(b.get("title") or "")), reverse=True)

        def _days_spent(b: dict) -> int:
            s, f = parse_iso_date(b.get("startDate")), parse_iso_date(b.get("finishDate"))
            return max(1, (f - s).days + 1) if s and f and f >= s else 0

        densest = max(books_list, key=lambda b: int(b.get("totalPages") or 0), default=None)
        longest = max(books_list, key=_days_spent, default=None)

        featured = _featured_books(books_list, _days_spent)

        if year is not None and month is not None:
            period_label = date(year, month, 1).strftime("%B %Y")
        elif year is not None:
            period_label = str(year)
        elif month is not None:
            period_label = date(2000, month, 1).strftime("%B")
        else:
            period_label = "All time"

        return {
            "year": year,
            "month": month,
            "period_label": period_label,
            "available_years": sorted(available_years, reverse=True),
            "books_read": len(books_list),
            "pages_read": sum(int(b.get("totalPages") or 0) for b in books_list),
            "genres_covered": len(genres),
            "genre_list": sorted(genres),
            "densest_book": densest,
            "most_time_spent": longest,
            "most_time_spent_days": _days_spent(longest) if longest else 0,
            "featured": featured,
        }

    @router.get("/stats/heatmap")
    def get_heatmap(
        year: int | None = Query(default=None, ge=1900, le=3000),
        end: str = Query(default="", description="Last day of the window, YYYY-MM-DD"),
        days: int = Query(default=heatmap.DEFAULT_DAYS, ge=7, le=1100),
    ) -> dict:
        """Per-day page totals for the calendar heatmap.

        `year` gives a Jan–Dec grid and is what the stats page uses, so the
        heatmap follows the same year filter as the summary above it. Without
        it the window is the `days` ending at `end` — a trailing year by
        default, which is the more natural shape for a sidebar or a widget.

        `end` defaults to the machine's local today, matching how progress is
        credited on write: the API is a local process, so its date is the user's.
        """
        today = date.today()
        if year is not None:
            start, last = heatmap.year_window(year)
        else:
            last = parse_iso_date(parse_iso_date_string(end)) or today
            start, last = heatmap.window(last, days)
        rows = repo.reading_days(start.isoformat(), last.isoformat())
        return {**heatmap.build(rows, start=start, end=last, today=today), "year": year}

    return router
