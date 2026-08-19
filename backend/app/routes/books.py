from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pathlib import Path
from pydantic import BaseModel

from ..repository import DataRepository
from ..services.catalog import reading_overlay, resolve_book

# A book the user has picked up, in any sense — the set /my-books is built from.
# 'not_started' is the absence of a shelf, not a shelf of its own, so it is the
# one status excluded: those books live in the catalog and are reachable through
# Library and search. 'dnf' has to be in here even though it gets no shelf of its
# own, because this list is the whole client-side `books` array — leaving it out
# would make abandoning a book look like deleting it.
TRACKED_STATUSES = {"reading", "done", "dnf"}
VALID_STATUSES = {"not_started", *TRACKED_STATUSES}


class ReadingProgressIn(BaseModel):
    status: str = "not_started"
    current_page: int = 0
    total_pages: int = 0
    start_date: str = ""
    finish_date: str = ""
    notes: str = ""


def create_router(root: Path, repo: DataRepository) -> APIRouter:
    router = APIRouter()

    def _book_entry(record: dict, book_id: str) -> dict:
        """Serialise a user_book_state row into the standard progress entry shape."""
        return {
            "book_id": book_id,
            "status": str(record.get("status") or "not_started"),
            "current_page": int(record.get("current_page") or 0),
            "total_pages": int(record.get("total_pages") or 0),
            "start_date": str(record.get("start_date") or ""),
            "finish_date": str(record.get("finish_date") or ""),
            "notes": str(record.get("notes") or ""),
        }

    def _empty_entry(book_id: str, total_pages: int = 0) -> dict:
        return {
            "book_id": book_id,
            "status": "not_started",
            "current_page": 0,
            "total_pages": total_pages,
            "start_date": "",
            "finish_date": "",
            "notes": "",
        }

    def _catalog_page_count(catalog: dict | None) -> int:
        return max(0, int((catalog or {}).get("page_count") or 0))

    @router.get("/my-books")
    def get_my_books() -> dict:
        books: list[dict] = []
        for book_id, row in repo.list_book_states().items():
            status = str(row.get("status") or "not_started").strip().lower()
            if status not in TRACKED_STATUSES:
                continue
            catalog = resolve_book(root, book_id) or {}
            # The catalog half and the reading half of a book are assembled the
            # same way here as on every other endpoint, so a book carries the
            # same fields whichever page asked for it. This route used to
            # hand-pick a subset, which is why a book opened from a shelf had
            # no rating or page count until linked_catalog_book was consulted.
            books.append({
                **catalog,
                **reading_overlay({**row, "status": status}, catalog.get("page_count")),
                "id": str(book_id),
                "linked_catalog_book": catalog or None,
                "notes": row.get("notes", ""),
            })
        books.sort(
            key=lambda b: (str(b.get("reading_finish_date") or ""), str(b.get("reading_start_date") or ""), str(b.get("title") or "")),
            reverse=True,
        )
        return {"books": books, "count": len(books)}

    @router.get("/reading-progress/{book_id}")
    def get_reading_progress_entry(book_id: str) -> dict:
        # A book nobody has tracked yet still has a length: the scraped
        # page_count on its catalog row. Seeding the entry with it is what makes
        # the tracking panel open on "0 of 412" rather than "0 of 0", and it has
        # to happen here rather than in the client because the payload a card
        # was built from does not always carry the catalog page count.
        catalog = resolve_book(root, book_id)
        record = repo.get_book_state(book_id)
        if record is None:
            if not catalog:
                raise HTTPException(status_code=404, detail="book not found")
            return {"book_id": book_id, "entry": _empty_entry(book_id, total_pages=_catalog_page_count(catalog))}
        entry = _book_entry(record, book_id)
        if not entry["total_pages"]:
            entry["total_pages"] = _catalog_page_count(catalog)
        return {"book_id": book_id, "entry": entry}

    @router.put("/reading-progress/{book_id}")
    def upsert_reading_progress(book_id: str, payload: ReadingProgressIn) -> dict:
        if not resolve_book(root, book_id) and repo.get_book_state(book_id) is None:
            raise HTTPException(status_code=404, detail="book not found")
        status = (payload.status or "").strip().lower()
        if status not in VALID_STATUSES:
            raise HTTPException(status_code=400, detail="invalid status")
        total_pages = max(0, int(payload.total_pages or 0))
        current_page = min(max(0, int(payload.current_page or 0)), total_pages or 999_999)
        entry = repo.upsert_book_state(
            book_id,
            status=status,
            total_pages=total_pages,
            current_page=current_page,
            start_date=(payload.start_date or "").strip(),
            finish_date=(payload.finish_date or "").strip(),
            notes=payload.notes or "",
        )
        return {"book_id": book_id, "entry": _book_entry(entry, book_id)}

    return router
