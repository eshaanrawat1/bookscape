from __future__ import annotations

import re
import sqlite3
from pathlib import Path

from ..db import transaction


class CollectionStore:
    def __init__(self, root: Path) -> None:
        self.root = root

    @staticmethod
    def _normalize(name: str) -> str:
        return " ".join((name or "").strip().split())

    @staticmethod
    def _normalize_icon(icon: str) -> str:
        """A lucide icon name, or '' for the default dot.

        The name is only ever looked up in a map on the frontend, never rendered
        as markup, so this guards the column's shape rather than the render.
        """
        clean = (icon or "").strip()
        if not clean:
            return ""
        if len(clean) > 64 or not re.fullmatch(r"[A-Za-z0-9-]+", clean):
            raise ValueError("Invalid icon name")
        return clean

    def list_all(self) -> list[dict]:
        with transaction(self.root) as conn:
            collections = conn.execute(
                "SELECT id, name, icon FROM collections ORDER BY created_at"
            ).fetchall()
            book_rows = conn.execute(
                "SELECT collection_id, uid FROM collection_books ORDER BY collection_id, added_at"
            ).fetchall()
        book_ids: dict[int, list[str]] = {}
        for row in book_rows:
            book_ids.setdefault(row["collection_id"], []).append(row["uid"])
        return [
            {"id": c["id"], "name": c["name"], "icon": c["icon"], "book_ids": book_ids.get(c["id"], [])}
            for c in collections
        ]

    def create(self, name: str) -> int:
        clean = self._normalize(name)
        if not clean:
            raise ValueError("Collection name is required")
        try:
            with transaction(self.root) as conn:
                return int(conn.execute("INSERT INTO collections (name) VALUES (?)", (clean,)).lastrowid)
        except sqlite3.IntegrityError as e:
            raise ValueError("Collection already exists") from e

    def delete(self, collection_id: int) -> None:
        with transaction(self.root) as conn:
            deleted = conn.execute("DELETE FROM collections WHERE id = ?", (collection_id,)).rowcount
        if deleted == 0:
            raise KeyError("Collection not found")

    def update(self, collection_id: int, *, name: str | None = None, icon: str | None = None) -> None:
        """Rename and/or set the icon. Only the arguments given are touched."""
        updates: dict[str, str] = {}
        if name is not None:
            updates["name"] = self._normalize(name)
            if not updates["name"]:
                raise ValueError("Collection name is required")
        if icon is not None:
            updates["icon"] = self._normalize_icon(icon)
        if not updates:
            raise ValueError("Nothing to update")

        assignments = ", ".join(f"{column} = ?" for column in updates)
        try:
            with transaction(self.root) as conn:
                updated = conn.execute(
                    f"UPDATE collections SET {assignments} WHERE id = ?",
                    [*updates.values(), collection_id],
                ).rowcount
        except sqlite3.IntegrityError as e:
            raise ValueError("Collection already exists") from e
        if updated == 0:
            raise KeyError("Collection not found")

    def _require(self, conn, collection_id: int) -> None:
        if not conn.execute("SELECT 1 FROM collections WHERE id = ?", (collection_id,)).fetchone():
            raise KeyError("Collection not found")

    def add_book(self, collection_id: int, book_id: str) -> None:
        with transaction(self.root) as conn:
            self._require(conn, collection_id)
            conn.execute(
                "INSERT INTO collection_books (collection_id, uid) VALUES (?, ?) "
                "ON CONFLICT(collection_id, uid) DO NOTHING",
                (collection_id, book_id),
            )

    def remove_book(self, collection_id: int, book_id: str) -> None:
        with transaction(self.root) as conn:
            self._require(conn, collection_id)
            conn.execute(
                "DELETE FROM collection_books WHERE collection_id = ? AND uid = ?",
                (collection_id, book_id),
            )
