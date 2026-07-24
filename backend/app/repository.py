from __future__ import annotations

from pathlib import Path

from .utils import read_json, write_json


class DataRepository:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.data_dir = root / "backend" / "data"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.user_state_path = self.data_dir / "user_state.json"
        self.books_catalog_path = self.data_dir / "books.json"

    def default_user_state(self) -> dict:
        return {
            "obsidian_vault_path": "",
            "reading_lists": [],
            "books": {},
        }

    def load_user_state(self) -> dict:
        if not self.user_state_path.exists():
            payload = self.default_user_state()
            write_json(self.user_state_path, payload)
            return payload
        payload = read_json(self.user_state_path, self.default_user_state())
        if not isinstance(payload, dict):
            return self.default_user_state()
        payload.setdefault("obsidian_vault_path", "")
        payload.setdefault("reading_lists", [])
        payload.setdefault("books", {})
        return payload

    def save_user_state(self, payload: dict) -> dict:
        payload = payload or {}
        payload.setdefault("obsidian_vault_path", "")
        payload.setdefault("reading_lists", [])
        payload.setdefault("books", {})
        write_json(self.user_state_path, payload)
        return payload
