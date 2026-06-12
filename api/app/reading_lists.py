from __future__ import annotations

from pathlib import Path

from .data_repository import DataRepository


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


class LikedBooksStore:
    def __init__(self, root: Path) -> None:
        self.repo = DataRepository(root)

    def list_all(self) -> list[str]:
        payload = self.repo.load_user_state()
        out = payload.get("liked_book_ids", [])
        if not isinstance(out, list):
            return []
        return [str(x) for x in out if x]

    def add(self, book_id: str) -> None:
        if not book_id:
            raise ValueError("book_id is required")
        payload = self.repo.load_user_state()
        ids = payload.setdefault("liked_book_ids", [])
        if book_id not in ids:
            ids.append(book_id)
            self.repo.save_user_state(payload)

    def remove(self, book_id: str) -> None:
        payload = self.repo.load_user_state()
        ids = payload.setdefault("liked_book_ids", [])
        payload["liked_book_ids"] = [x for x in ids if x != book_id]
        self.repo.save_user_state(payload)


class WantToReadStore:
    def __init__(self, root: Path) -> None:
        self.repo = DataRepository(root)

    def list_all(self) -> list[str]:
        payload = self.repo.load_user_state()
        out = payload.get("want_to_read_book_ids", [])
        if not isinstance(out, list):
            return []
        return [str(x) for x in out if x]

    def add(self, book_id: str) -> None:
        if not book_id:
            raise ValueError("book_id is required")
        payload = self.repo.load_user_state()
        ids = payload.setdefault("want_to_read_book_ids", [])
        if book_id not in ids:
            ids.append(book_id)
            self.repo.save_user_state(payload)

    def remove(self, book_id: str) -> None:
        payload = self.repo.load_user_state()
        ids = payload.setdefault("want_to_read_book_ids", [])
        payload["want_to_read_book_ids"] = [x for x in ids if x != book_id]
        self.repo.save_user_state(payload)


class ReadingProgressStore:
    def __init__(self, root: Path) -> None:
        self.repo = DataRepository(root)

    def list_all(self) -> dict:
        payload = self.repo.load_user_state()
        entries = payload.get("reading_progress", {})
        if not isinstance(entries, dict):
            return {}
        return {str(k): v for k, v in entries.items() if k}

    def upsert(self, book_id: str, entry: dict) -> dict:
        if not book_id:
            raise ValueError("book_id is required")
        payload = self.repo.load_user_state()
        entries = payload.setdefault("reading_progress", {})
        entries[book_id] = entry
        self.repo.save_user_state(payload)
        return entry
