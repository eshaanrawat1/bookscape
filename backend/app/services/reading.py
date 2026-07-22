from __future__ import annotations

from datetime import date
from pathlib import Path

from ..repository import DataRepository
from ..utils import parse_iso_date, to_int


class ReadingListStore:
    def __init__(self, root: Path) -> None:
        self.repo = DataRepository(root)

    @staticmethod
    def _normalize(name: str) -> str:
        return " ".join((name or "").strip().split())

    def list_all(self) -> list[dict]:
        payload = self.repo.load_user_state()
        return payload.get("reading_lists", [])

    def create_list(self, name: str) -> dict:
        clean = self._normalize(name)
        if not clean:
            raise ValueError("List name is required")
        payload = self.repo.load_user_state()
        lists = payload.setdefault("reading_lists", [])
        if any(x.get("name", "").lower() == clean.lower() for x in lists):
            raise ValueError("List already exists")
        row = {"name": clean, "books": []}
        lists.append(row)
        self.repo.save_user_state(payload)
        return row

    def delete_list(self, name: str) -> None:
        clean = self._normalize(name)
        payload = self.repo.load_user_state()
        lists = payload.setdefault("reading_lists", [])
        next_lists = [x for x in lists if x.get("name", "").lower() != clean.lower()]
        if len(next_lists) == len(lists):
            raise KeyError("List not found")
        payload["reading_lists"] = next_lists
        self.repo.save_user_state(payload)

    def rename_list(self, name: str, new_name: str) -> dict:
        clean = self._normalize(name)
        clean_new = self._normalize(new_name)
        if not clean_new:
            raise ValueError("List name is required")
        payload = self.repo.load_user_state()
        lists = payload.setdefault("reading_lists", [])
        if any(x.get("name", "").lower() == clean_new.lower() and x.get("name", "").lower() != clean.lower() for x in lists):
            raise ValueError("List already exists")
        for row in lists:
            if row.get("name", "").lower() == clean.lower():
                row["name"] = clean_new
                self.repo.save_user_state(payload)
                return row
        raise KeyError("List not found")

    def add_book(self, name: str, book_id: str) -> dict:
        clean = self._normalize(name)
        if not book_id:
            raise ValueError("book_id is required")
        payload = self.repo.load_user_state()
        lists = payload.setdefault("reading_lists", [])
        for row in lists:
            if row.get("name", "").lower() != clean.lower():
                continue
            books = row.setdefault("books", [])
            if book_id not in books:
                books.append(book_id)
                self.repo.save_user_state(payload)
            return row
        raise KeyError("List not found")

    def remove_book(self, name: str, book_id: str) -> dict:
        clean = self._normalize(name)
        payload = self.repo.load_user_state()
        lists = payload.setdefault("reading_lists", [])
        for row in lists:
            if row.get("name", "").lower() != clean.lower():
                continue
            books = row.setdefault("books", [])
            row["books"] = [x for x in books if x != book_id]
            self.repo.save_user_state(payload)
            return row
        raise KeyError("List not found")


def compute_reading_stats(entries: dict[str, dict], today: date | None = None) -> dict:
    now = today or date.today()

    rows = []
    for row in entries.values():
        finish = parse_iso_date(row.get("finish_date"))
        status = str(row.get("status") or "").strip().lower()
        if status != "done" or not finish:
            continue

        pages = to_int(row.get("total_pages"))
        rows.append({"finish_date": finish, "pages": pages})

    def for_period(period: str) -> tuple[list[dict], int]:
        if period == "daily":
            return [r for r in rows if r["finish_date"] == now], 1

        if period == "monthly":
            picked = [r for r in rows if r["finish_date"].year == now.year and r["finish_date"].month == now.month]
            return picked, now.day

        if period == "yearly":
            picked = [r for r in rows if r["finish_date"].year == now.year]
            return picked, now.timetuple().tm_yday

        if not rows:
            return [], 1

        earliest = min(r["finish_date"] for r in rows)
        return rows, max(1, (now - earliest).days + 1)

    out = {}
    for period in ("daily", "monthly", "yearly", "all"):
        picked, days_passed = for_period(period)
        out[period] = {
            "totalBooksRead": len(picked),
            "totalPagesRead": sum(r["pages"] for r in picked),
            "daysRead": len({r["finish_date"] for r in picked}),
            "daysPassed": days_passed,
        }
    return out
