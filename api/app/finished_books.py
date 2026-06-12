from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


def _utc_now() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


class FinishedBooksStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.path = root / "user_data" / "finished_books.json"

    def _default_payload(self) -> dict:
        return {
            "schema_version": 1,
            "books": {},
            "meta": {"updated_at": _utc_now()},
        }

    def _read_json(self, default: dict) -> dict:
        if not self.path.exists():
            return default
        try:
            with self.path.open("r", encoding="utf-8") as f:
                payload = json.load(f)
            return payload if isinstance(payload, dict) else default
        except Exception:
            return default

    def _write_json(self, payload: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)

    def load_all(self) -> dict:
        payload = self._read_json(self._default_payload())
        payload.setdefault("schema_version", 1)
        payload.setdefault("books", {})
        payload.setdefault("meta", {})
        payload["meta"].setdefault("updated_at", _utc_now())
        return payload

    def list_all(self) -> dict[str, dict]:
        payload = self.load_all()
        books = payload.get("books", {})
        if not isinstance(books, dict):
            return {}
        return {str(k): v for k, v in books.items() if k and isinstance(v, dict)}

    def get(self, book_id: str) -> dict | None:
        book_id = (book_id or "").strip()
        if not book_id:
            return None
        return self.list_all().get(book_id)

    def upsert(self, book_id: str, entry: dict) -> dict:
        book_id = (book_id or "").strip()
        if not book_id:
            raise ValueError("book_id is required")
        payload = self.load_all()
        books = payload.setdefault("books", {})
        current = books.get(book_id, {}) if isinstance(books, dict) else {}
        status = str(entry.get("status") or "done").strip().lower() or "done"
        row = {
            "book_id": book_id,
            "status": status,
            "current_page": max(0, int(entry.get("current_page") or 0)),
            "total_pages": max(0, int(entry.get("total_pages") or 0)),
            "start_date": str(entry.get("start_date") or "").strip(),
            "finish_date": str(entry.get("finish_date") or "").strip(),
            "notes": str(entry.get("notes") or "").strip(),
            "updated_at": _utc_now(),
        }
        if isinstance(current, dict):
            row = {**current, **row}
            row["book_id"] = book_id
            row["status"] = status
        books[book_id] = row
        payload["meta"]["updated_at"] = _utc_now()
        self._write_json(payload)
        return row
