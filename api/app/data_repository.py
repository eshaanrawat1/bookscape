from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


def _utc_now() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


class DataRepository:
    USER_STATE_VERSION = 1
    OBSIDIAN_DATA_VERSION = 1
    BOOKS_CATALOG_VERSION = 1

    def __init__(self, root: Path) -> None:
        self.root = root
        self.user_dir = root / "user_data"
        self.user_dir.mkdir(parents=True, exist_ok=True)
        self.user_state_path = self.user_dir / "user_state.json"
        # Canonical source for "my obsidian data" is the full sync snapshot.
        self.obsidian_data_path = self.user_dir / "all_books.json"
        self.books_catalog_path = root / "data" / "books.json"

    def default_user_state(self) -> dict:
        return {
            "schema_version": self.USER_STATE_VERSION,
            "liked_book_ids": [],
            "want_to_read_book_ids": [],
            "reading_lists": [],
            "reading_progress": {},
            "meta": {
                "updated_at": _utc_now(),
            },
        }

    def _read_json(self, path: Path, default: dict) -> dict:
        if not path.exists():
            return default
        try:
            with path.open("r", encoding="utf-8") as f:
                payload = json.load(f)
            if not isinstance(payload, dict):
                return default
            return payload
        except Exception:
            return default

    def _write_json(self, path: Path, payload: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)

    def load_user_state(self) -> dict:
        if not self.user_state_path.exists():
            payload = self.default_user_state()
            self._write_json(self.user_state_path, payload)
            return payload
        payload = self._read_json(self.user_state_path, self.default_user_state())
        payload.setdefault("schema_version", self.USER_STATE_VERSION)
        payload.setdefault("liked_book_ids", [])
        payload.setdefault("want_to_read_book_ids", [])
        payload.setdefault("reading_lists", [])
        payload.setdefault("reading_progress", {})
        payload.setdefault("meta", {})
        payload["meta"].setdefault("updated_at", _utc_now())
        return payload

    def save_user_state(self, payload: dict) -> dict:
        payload = payload or {}
        payload["schema_version"] = self.USER_STATE_VERSION
        payload.setdefault("liked_book_ids", [])
        payload.setdefault("want_to_read_book_ids", [])
        payload.setdefault("reading_lists", [])
        payload.setdefault("reading_progress", {})
        payload.setdefault("meta", {})
        payload["meta"]["updated_at"] = _utc_now()
        self._write_json(self.user_state_path, payload)
        return payload

    def read_obsidian_books_snapshot(self) -> dict:
        payload = self._read_json(
            self.obsidian_data_path,
            {"schema_version": self.OBSIDIAN_DATA_VERSION, "generated_at": "", "vault_path": "", "books": {}, "count": 0},
        )
        payload.setdefault("schema_version", self.OBSIDIAN_DATA_VERSION)
        payload.setdefault("books", {})
        payload.setdefault("count", len(payload["books"]) if isinstance(payload["books"], dict) else 0)
        return payload

    def write_obsidian_books_snapshot(self, payload: dict) -> dict:
        payload = payload or {}
        payload["schema_version"] = self.OBSIDIAN_DATA_VERSION
        payload.setdefault("generated_at", _utc_now())
        payload.setdefault("vault_path", "")
        payload.setdefault("books", {})
        payload["count"] = len(payload["books"]) if isinstance(payload.get("books"), dict) else 0
        self._write_json(self.obsidian_data_path, payload)
        return payload

    def data_health(self) -> dict:
        user_state = self.load_user_state()
        obsidian_data = self.read_obsidian_books_snapshot()
        return {
            "datasets": {
                "obsidian_books": {
                    "path": str(self.obsidian_data_path),
                    "schema_version": int(obsidian_data.get("schema_version") or self.OBSIDIAN_DATA_VERSION),
                    "exists": self.obsidian_data_path.exists(),
                    "count": int(obsidian_data.get("count") or 0),
                },
                "books_catalog": {
                    "path": str(self.books_catalog_path),
                    "schema_version": self.BOOKS_CATALOG_VERSION,
                    "exists": self.books_catalog_path.exists(),
                },
                "user_state": {
                    "path": str(self.user_state_path),
                    "schema_version": int(user_state.get("schema_version") or self.USER_STATE_VERSION),
                    "exists": self.user_state_path.exists(),
                    "liked_count": len(user_state.get("liked_book_ids", [])),
                    "want_to_read_count": len(user_state.get("want_to_read_book_ids", [])),
                    "list_count": len(user_state.get("reading_lists", [])),
                    "progress_count": len(user_state.get("reading_progress", {})),
                },
            }
        }
