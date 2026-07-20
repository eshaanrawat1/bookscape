from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterator

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
    removed_bracket_author_entries: int
    vault_path: str
    preview_path: str
    dry_run: bool
    proposed_books: list[dict]
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


def _scan_vault(vault_path: Path) -> Iterator[tuple[dict, int]]:
    """Yields (book, scanned_count) for every parseable .md file."""
    scanned_count = 0
    for md in vault_path.rglob("*.md"):
        scanned_count += 1
        book = parse_book(md)
        if book:
            yield book, scanned_count


def load_obsidian_progress_entries(root: Path | None = None) -> tuple[dict[str, dict], dict]:
    vault_path = _resolve_vault_path(root)
    if not vault_path.exists():
        raise FileNotFoundError(f"Obsidian vault not found at: {vault_path}")

    entries: dict[str, dict] = {}
    scanned_files = 0
    parsed_books = 0

    for book, scanned_count in _scan_vault(vault_path):
        scanned_files = scanned_count
        parsed_books += 1
        entries[book["id"]] = {
            "status": book["status"],
            "total_pages": int(book["total_pages"] or 0),
            "current_page": int(book["current_page"] or 0),
            "start_date": book["start_date"],
            "finish_date": book["finish_date"],
            "notes": "",
        }

    return entries, {"vault_path": str(vault_path), "scanned_files": scanned_files, "parsed_books": parsed_books}


def run_obsidian_sync(root: Path, *, dry_run: bool = True) -> SyncResult:
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
    progress_entries = user_state.setdefault("reading_progress", {})

    scanned_files = 0
    parsed_books = 0
    created_books = 0
    updated_books = 0
    updated_progress_entries = 0
    all_synced_books_map: dict[str, dict] = {}

    for book, scanned_count in _scan_vault(vault_path):
        scanned_files = scanned_count
        parsed_books += 1
        book_id = book["id"]

        progress_row = {
            "status": book["status"],
            "total_pages": int(book["total_pages"] or 0),
            "current_page": int(book["current_page"] or 0),
            "start_date": book["start_date"],
            "finish_date": book["finish_date"],
            "notes": "",
        }
        progress_entries[book_id] = progress_row
        updated_progress_entries += 1

        synced_row = {**book}
        all_synced_books_map[book_id] = synced_row

        if book_id in existing_snapshot_books:
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

    all_books_payload = {
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "vault_path": str(vault_path),
        "books": all_synced_books_map,
        "count": len(all_synced_books_map),
    }
    repo.write_obsidian_books_snapshot(all_books_payload)

    if not dry_run:
        repo.save_user_state(user_state)

    return SyncResult(
        scanned_files=scanned_files,
        parsed_books=parsed_books,
        created_books=created_books,
        updated_books=updated_books,
        updated_progress_entries=updated_progress_entries,
        removed_bracket_author_entries=0,
        vault_path=str(vault_path),
        preview_path=str(preview_path),
        dry_run=dry_run,
        proposed_books=[],
        periods=compute_reading_stats(progress_entries),
    )
