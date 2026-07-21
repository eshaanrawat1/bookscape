from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from ..data_repository import DataRepository
from ..reading_stats import compute_reading_stats
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
        snapshot_path = str(repo.read_obsidian_books_snapshot().get("vault_path") or "").strip()
        if snapshot_path:
            return Path(snapshot_path).expanduser()

    return DEFAULT_OBSIDIAN_VAULT.expanduser()


def load_obsidian_progress_entries(root: Path) -> tuple[dict[str, dict], dict]:
    """
    Returns progress entries from user_state.books.
    Vault scan is only used during sync — not here.
    """
    if root is None:
        raise ValueError("root is required")

    repo = DataRepository(root)
    user_state = repo.load_user_state()
    books = user_state.get("books", {})
    if not isinstance(books, dict):
        books = {}

    entries: dict[str, dict] = {}
    for uid, book_record in books.items():
        if not isinstance(book_record, dict):
            continue
        entries[str(uid)] = {
            "status": book_record.get("status", "not_started"),
            "total_pages": int(book_record.get("total_pages") or 0),
            "current_page": int(book_record.get("current_page") or 0),
            "start_date": book_record.get("start_date", ""),
            "finish_date": book_record.get("finish_date", ""),
            "notes": book_record.get("notes", ""),
        }

    vault_path = repo.read_obsidian_books_snapshot().get("vault_path", "")
    return entries, {"vault_path": str(vault_path), "scanned_files": 0, "parsed_books": len(entries)}


def run_obsidian_sync(root: Path, *, dry_run: bool = False) -> SyncResult:
    vault_path = _resolve_vault_path(root)
    if not vault_path.exists():
        raise FileNotFoundError(f"Obsidian vault not found at: {vault_path}")

    repo = DataRepository(root)
    user_dir = root / "user_data"
    user_dir.mkdir(parents=True, exist_ok=True)
    preview_path = user_dir / "obsidian_sync_preview.json"

    existing_snapshot = repo.read_obsidian_books_snapshot()
    existing_snapshot_books = existing_snapshot.get("books", {})
    if not isinstance(existing_snapshot_books, dict):
        existing_snapshot_books = {}

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
    all_synced_books_map: dict[str, dict] = {}

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
        all_synced_books_map[uid] = synced_row
        updated_progress_entries += 1

        if uid in existing_snapshot_books:
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

    repo.write_obsidian_books_snapshot({
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "vault_path": str(vault_path),
        "books": all_synced_books_map,
        "count": len(all_synced_books_map),
    })

    if not dry_run:
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