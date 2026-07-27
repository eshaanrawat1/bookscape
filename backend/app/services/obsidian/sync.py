from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from ...repository import DataRepository
from ..catalog import resolve_book, upsert_book
from .naming import safe_filename
from .parser import parse_book
from .vault import resolve_vault_path


class EmptyVaultScanError(Exception):
    """Raised when a vault-level Pull scans zero .md files — this usually means
    the vault folder is on an unmounted drive or not-yet-downloaded iCloud path,
    not that the vault is genuinely empty. Never treat this as a normal result."""


@dataclass
class PullResult:
    vault_path: str
    scanned_files: int
    imported: int
    skipped: list[dict] = field(default_factory=list)
    dry_run: bool = False


def _apply_parsed_book(root: Path, book: dict, *, dry_run: bool) -> str:
    """Upsert catalog + reading state for a parsed book dict.
    Returns a rejection reason string, or '' if applied (or would be, for a dry run)."""
    status = str(book.get("status") or "").strip().lower()
    if status not in {"reading", "done"}:
        return f"status '{status or 'unknown'}' is not reading/done"

    uid = str(book.get("uid") or "").strip()
    if not uid:
        return "missing uid"

    if dry_run:
        return ""

    upsert_book(root, {
        "uid": uid,
        "title": book.get("title", ""),
        "author": book.get("author", ""),
        "image_url": book.get("image_url", ""),
        "avg_rating": book.get("rating", 0),
        "rating_count": book.get("rating_count", 0),
        "review_count": book.get("review_count", 0),
        "description": book.get("description", ""),
        "genres": book.get("genres", []),
    })
    # Note: this is the only place liked/want_to_read are absent by design —
    # they never appear in the Obsidian markdown format, so Pull never touches them.
    DataRepository(root).upsert_book_state(
        uid,
        status=status,
        current_page=book.get("current_page", 0),
        total_pages=book.get("total_pages", 0),
        start_date=book.get("start_date", ""),
        finish_date=book.get("finish_date", ""),
    )
    return ""


def pull_one(root: Path, *, uid: str | None = None, filename: str | None = None, dry_run: bool = False) -> dict:
    """Pull a single book's note from the vault into Bookscape."""
    vault_path = resolve_vault_path(root)
    if not vault_path.exists():
        raise FileNotFoundError(f"Obsidian vault not found at: {vault_path}")

    target_filename = filename
    if not target_filename and uid:
        state = DataRepository(root).get_book_state(uid)
        target_filename = state.get("obsidian_filename") if state else None
        if not target_filename:
            book = resolve_book(root, uid)
            if book and book.get("title"):
                target_filename = safe_filename(book["title"])

    if not target_filename:
        raise FileNotFoundError("Could not resolve a vault file for this book")

    md_path = vault_path / target_filename
    if not md_path.exists():
        raise FileNotFoundError(f"No vault file found at: {md_path}")

    book = parse_book(md_path)
    if not book or not book.get("uid"):
        raise ValueError(f"Could not parse a valid book from {md_path.name}")

    rejected = _apply_parsed_book(root, book, dry_run=dry_run)
    if rejected:
        raise ValueError(f"{md_path.name}: {rejected}")

    return {"uid": book["uid"], "filename": md_path.name, "dry_run": dry_run}


def run_obsidian_pull(root: Path, *, dry_run: bool = False) -> PullResult:
    """Vault-level Pull: scan every .md file, importing any reading/done book found.
    Never deletes Bookscape state based on a file being absent — that invariant is
    intentional (protects against unmounted drives / partial vault availability) and
    must not be "optimized away" by adding a delete-on-absence step here."""
    vault_path = resolve_vault_path(root)
    if not vault_path.exists():
        raise FileNotFoundError(f"Obsidian vault not found at: {vault_path}")

    md_files = list(vault_path.rglob("*.md"))
    if not md_files:
        raise EmptyVaultScanError(str(vault_path))

    imported = 0
    skipped: list[dict] = []
    for md_path in md_files:
        book = parse_book(md_path)
        if not book:
            continue  # no uid in frontmatter -> not a book note, not an error

        rejected = _apply_parsed_book(root, book, dry_run=dry_run)
        if rejected:
            skipped.append({"filename": md_path.name, "reason": rejected})
        else:
            imported += 1

    return PullResult(
        vault_path=str(vault_path),
        scanned_files=len(md_files),
        imported=imported,
        skipped=skipped,
        dry_run=dry_run,
    )
