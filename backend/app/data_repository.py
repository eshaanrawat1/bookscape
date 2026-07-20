from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


def _utc_now() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


class DataRepository:
    USER_STATE_VERSION = 1
    OBSIDIAN_DATA_VERSION = 2
    BOOKS_CATALOG_VERSION = 1

    def __init__(self, root: Path) -> None:
        self.root = root
        self.user_dir = root / "user_data"
        self.user_dir.mkdir(parents=True, exist_ok=True)
        self.user_state_path = self.user_dir / "user_state.json"
        self.obsidian_data_path = self.user_dir / "all_books.json"
        self.books_catalog_path = root / "data" / "books.json"

    def default_user_state(self) -> dict:
        return {
            "schema_version": self.USER_STATE_VERSION,
            # Legacy top-level list — kept as shim until Phase 4
            "liked_book_ids": [],
            "reading_lists": [],
            "books": {},
            "meta": {"updated_at": _utc_now()},
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
        payload.setdefault("reading_lists", [])
        payload.setdefault("books", {})
        payload.setdefault("meta", {})
        payload["meta"].setdefault("updated_at", _utc_now())
        return payload

    def save_user_state(self, payload: dict) -> dict:
        payload = payload or {}
        payload["schema_version"] = self.USER_STATE_VERSION
        payload.setdefault("liked_book_ids", [])
        payload.setdefault("reading_lists", [])
        payload.setdefault("books", {})
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
                    # books_count is the canonical metric post-migration
                    "books_count": len(user_state.get("books", {})),
                    # Legacy counts — reflect old top-level lists, not per-book fields
                    "liked_count": len(user_state.get("liked_book_ids", [])),
                    "list_count": len(user_state.get("reading_lists", [])),
                },
            }
        }

    def migrate_user_state(self) -> dict:
        """
        One-time migration into unified user_state.books keyed by uid.

        Priority (highest to lowest) for progress fields:
          finished_books.json > reading_progress > obsidian snapshot

        Notes come only from finished_books — reading_progress never stored them.
        Personal fields (liked, want_to_read, lists) come from the legacy top-level keys.

        Idempotent: safe to run multiple times. Any uid already in user_state.books
        is left untouched so re-runs don't overwrite manually edited records.
        """
        user_state = self.load_user_state()

        # Skip books already migrated so re-runs are safe
        already_migrated: set[str] = set(user_state.get("books", {}).keys())

        # --- Source 1: reading_progress (no notes field) ---
        reading_progress: dict[str, dict] = user_state.get("reading_progress", {})
        if not isinstance(reading_progress, dict):
            reading_progress = {}

        # --- Source 2: finished_books.json (has notes) ---
        finished_books: dict[str, dict] = {}
        finished_books_path = self.user_dir / "finished_books.json"
        if finished_books_path.exists():
            try:
                with finished_books_path.open("r", encoding="utf-8") as f:
                    finished_payload = json.load(f)
                if isinstance(finished_payload, dict):
                    raw = finished_payload.get("books", {})
                    if isinstance(raw, dict):
                        finished_books = {str(k): v for k, v in raw.items() if isinstance(v, dict)}
            except Exception:
                pass

        # --- Source 3: obsidian snapshot (display metadata) ---
        obsidian_books: dict[str, dict] = {}
        snapshot = self.read_obsidian_books_snapshot()
        raw_obs = snapshot.get("books", {})
        if isinstance(raw_obs, dict):
            obsidian_books = {str(k): v for k, v in raw_obs.items() if isinstance(v, dict)}

        # --- Personal state from legacy top-level keys ---
        liked_ids = set(user_state.get("liked_book_ids", []))

        book_to_lists: dict[str, list[str]] = {}
        for lst in user_state.get("reading_lists", []):
            if not isinstance(lst, dict):
                continue
            list_name = lst.get("name", "")
            for book_id in lst.get("books", []):
                if book_id:
                    book_to_lists.setdefault(str(book_id), []).append(list_name)

        # --- Merge ---
        migrated_books: dict[str, dict] = {}
        all_uids = set(obsidian_books) | set(reading_progress) | set(finished_books)

        for uid in all_uids:
            if uid in already_migrated:
                continue

            obs = obsidian_books.get(uid, {})
            prog = reading_progress.get(uid, {})
            fin = finished_books.get(uid, {})

            # Base: obsidian display metadata
            record: dict = {
                "title":       obs.get("title", ""),
                "author":      obs.get("author", ""),
                "image_url":   obs.get("image_url") or obs.get("cover", ""),
                "genres":      obs.get("genres", []),
                "rating":      obs.get("rating") or obs.get("book_rating") or 0,
                "description": obs.get("description", ""),
                # Personal
                "notes":       "",
                "liked":       uid in liked_ids,
                "want_to_read": False,
                "lists":       book_to_lists.get(uid, []),
                # Progress — start from obsidian, then overlay in priority order
                "status":       obs.get("status", "not_started"),
                "current_page": int(obs.get("current_page") or obs.get("reading_current_page") or 0),
                "total_pages":  int(obs.get("total_pages") or obs.get("reading_total_pages") or 0),
                "start_date":   obs.get("start_date") or "",
                "finish_date":  obs.get("finish_date") or "",
            }

            # Overlay reading_progress (no notes — it never had them)
            if prog:
                record["status"]       = prog.get("status", record["status"])
                record["current_page"] = int(prog.get("current_page") or record["current_page"])
                record["total_pages"]  = int(prog.get("total_pages") or record["total_pages"])
                record["start_date"]   = prog.get("start_date") or record["start_date"]
                record["finish_date"]  = prog.get("finish_date") or record["finish_date"]

            # Overlay finished_books (highest priority — also the only source of notes)
            if fin:
                record["status"]       = fin.get("status", record["status"])
                record["current_page"] = int(fin.get("current_page") or record["current_page"])
                record["total_pages"]  = int(fin.get("total_pages") or record["total_pages"])
                record["start_date"]   = fin.get("start_date") or record["start_date"]
                record["finish_date"]  = fin.get("finish_date") or record["finish_date"]
                record["notes"]        = fin.get("notes") or ""  # only set from finished_books

            migrated_books[uid] = record

        user_state.setdefault("books", {}).update(migrated_books)
        self.save_user_state(user_state)

        return {
            "migrated_count": len(migrated_books),
            "skipped_already_migrated": len(already_migrated),
            "sources": {
                "obsidian_books": len(obsidian_books),
                "reading_progress": len(reading_progress),
                "finished_books": len(finished_books),
            },
        }