from __future__ import annotations

import sqlite3
from pathlib import Path

from ..db import transaction


class ReadingListStore:
    def __init__(self, root: Path) -> None:
        self.root = root

    @staticmethod
    def _normalize(name: str) -> str:
        return " ".join((name or "").strip().split())

    def _get_list(self, name: str) -> dict:
        with transaction(self.root) as conn:
            row = conn.execute(
                "SELECT id, name FROM collections WHERE name = ? COLLATE NOCASE", (name,)
            ).fetchone()
            if not row:
                raise KeyError("List not found")
            books = [
                r["uid"]
                for r in conn.execute(
                    "SELECT uid FROM collection_books WHERE collection_id = ? ORDER BY added_at",
                    (row["id"],),
                ).fetchall()
            ]
        return {"name": row["name"], "books": books}

    def list_all(self) -> list[dict]:
        with transaction(self.root) as conn:
            collections = conn.execute("SELECT id, name FROM collections ORDER BY created_at").fetchall()
            book_rows = conn.execute(
                "SELECT collection_id, uid FROM collection_books ORDER BY collection_id, added_at"
            ).fetchall()
        books_by_collection: dict[int, list[str]] = {}
        for row in book_rows:
            books_by_collection.setdefault(row["collection_id"], []).append(row["uid"])
        return [{"name": c["name"], "books": books_by_collection.get(c["id"], [])} for c in collections]

    def create_list(self, name: str) -> dict:
        clean = self._normalize(name)
        if not clean:
            raise ValueError("List name is required")
        try:
            with transaction(self.root) as conn:
                conn.execute("INSERT INTO collections (name) VALUES (?)", (clean,))
        except sqlite3.IntegrityError as e:
            raise ValueError("List already exists") from e
        return {"name": clean, "books": []}

    def delete_list(self, name: str) -> None:
        clean = self._normalize(name)
        with transaction(self.root) as conn:
            cur = conn.execute("DELETE FROM collections WHERE name = ? COLLATE NOCASE", (clean,))
            deleted = cur.rowcount
        if deleted == 0:
            raise KeyError("List not found")

    def rename_list(self, name: str, new_name: str) -> dict:
        clean = self._normalize(name)
        clean_new = self._normalize(new_name)
        if not clean_new:
            raise ValueError("List name is required")
        try:
            with transaction(self.root) as conn:
                cur = conn.execute(
                    "UPDATE collections SET name = ? WHERE name = ? COLLATE NOCASE",
                    (clean_new, clean),
                )
                updated = cur.rowcount
        except sqlite3.IntegrityError as e:
            raise ValueError("List already exists") from e
        if updated == 0:
            raise KeyError("List not found")
        return self._get_list(clean_new)

    def add_book(self, name: str, book_id: str) -> dict:
        clean = self._normalize(name)
        if not book_id:
            raise ValueError("book_id is required")
        with transaction(self.root) as conn:
            row = conn.execute("SELECT id FROM collections WHERE name = ? COLLATE NOCASE", (clean,)).fetchone()
            if not row:
                raise KeyError("List not found")
            conn.execute(
                "INSERT INTO collection_books (collection_id, uid) VALUES (?, ?) "
                "ON CONFLICT(collection_id, uid) DO NOTHING",
                (row["id"], book_id),
            )
        return self._get_list(clean)

    def remove_book(self, name: str, book_id: str) -> dict:
        clean = self._normalize(name)
        with transaction(self.root) as conn:
            row = conn.execute("SELECT id FROM collections WHERE name = ? COLLATE NOCASE", (clean,)).fetchone()
            if not row:
                raise KeyError("List not found")
            conn.execute(
                "DELETE FROM collection_books WHERE collection_id = ? AND uid = ?",
                (row["id"], book_id),
            )
        return self._get_list(clean)
