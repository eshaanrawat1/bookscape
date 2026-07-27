from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from ...repository import DataRepository
from ..reading import compute_reading_stats
from .parser import parse_book

DEFAULT_OBSIDIAN_VAULT = Path("~/Obsidian/Books")


@dataclass
class SyncResult:
    scanned_files: int
    parsed_books: int
    created_books: int
    updated_books: int
    updated_progress_entries: int
    vault_path: str
    preview_path: str
    dry_run: bool
    periods: dict


def _resolve_vault_path(root: Path | None = None) -> Path:
    env_value = os.getenv("OBSIDIAN_VAULT_PATH", "").strip()
    if env_value:
        return Path(env_value).expanduser()

    if root is not None:
        repo = DataRepository(root)
        user_state = repo.load_user_state()
        vault_path = str(user_state.get("obsidian_vault_path") or "").strip()
        if vault_path:
            return Path(vault_path).expanduser()

    return DEFAULT_OBSIDIAN_VAULT.expanduser()


def run_obsidian_sync(root: Path, *, dry_run: bool = False) -> SyncResult:
    vault_path = _resolve_vault_path(root)
    if not vault_path.exists():
        raise FileNotFoundError(f"Obsidian vault not found at: {vault_path}")

    repo = DataRepository(root)
    data_dir = root / "backend" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    preview_path = data_dir / "obsidian_sync_preview.json"

    user_state = repo.load_user_state()
    books = user_state.setdefault("books", {})
    if not isinstance(books, dict):
        books = {}
        user_state["books"] = books

    scanned_files = 0
    parsed_books = 0
    created_books = 0
    updated_books = 0
    updated_progress_entries = 0

    for md in vault_path.rglob("*.md"):
        scanned_files += 1
        book = parse_book(md)
        if not book:
            continue

        parsed_books += 1
        uid = book["uid"]  # uid is the canonical key — parser.py guarantees this exists

        existing_book = books.get(uid) if isinstance(books.get(uid), dict) else {}

        synced_row = {
            **book,
            # Personal fields — preserved across syncs, never overwritten
            "notes":        existing_book.get("notes", ""),
            "liked":        existing_book.get("liked", False),
            "want_to_read": existing_book.get("want_to_read", False),
            "lists":        existing_book.get("lists", []),
        }

        books[uid] = synced_row
        updated_progress_entries += 1

        if uid in existing_book:
            updated_books += 1
        else:
            created_books += 1

    preview_payload = {
        "dry_run": dry_run,
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "vault_path": str(vault_path),
        "summary": {
            "scanned_files": scanned_files,
            "parsed_books": parsed_books,
            "created_books": created_books,
            "updated_books": updated_books,
            "updated_progress_entries": updated_progress_entries,
        },
    }
    with preview_path.open("w", encoding="utf-8") as f:
        json.dump(preview_payload, f, indent=2)

    if not dry_run:
        user_state["obsidian_vault_path"] = str(vault_path)
        user_state["books"] = books
        repo.save_user_state(user_state)

    # Compute stats from the full books map (not just synced books)
    progress_entries = {
        uid: {
            "status":       r.get("status", "not_started"),
            "total_pages":  int(r.get("total_pages") or 0),
            "current_page": int(r.get("current_page") or 0),
            "start_date":   r.get("start_date", ""),
            "finish_date":  r.get("finish_date", ""),
        }
        for uid, r in books.items()
        if isinstance(r, dict)
    }

    return SyncResult(
        scanned_files=scanned_files,
        parsed_books=parsed_books,
        created_books=created_books,
        updated_books=updated_books,
        updated_progress_entries=updated_progress_entries,
        vault_path=str(vault_path),
        preview_path=str(preview_path),
        dry_run=dry_run,
        periods=compute_reading_stats(progress_entries),
    )
