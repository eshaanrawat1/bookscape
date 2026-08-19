from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from ...db import transaction
from ...repository import DataRepository
from ...utils import clamp_my_rating
from ..catalog import resolve_book
from .naming import safe_filename
from .vault import resolve_vault_path

EXPORTABLE_STATUSES = {"reading", "done", "dnf"}


class FilenameCollisionError(Exception):
    def __init__(self, filename: str, uids: list[str]):
        self.filename = filename
        self.uids = uids
        super().__init__(f"Filename collision: '{filename}' claimed by {uids}")


@dataclass
class PushResult:
    vault_path: str
    written: int
    deleted: int
    skipped_collisions: list[dict] = field(default_factory=list)
    dry_run: bool = False


def _bare_or_valued(key: str, value: str) -> str:
    return f"{key}:" if not value else f"{key}: {value}"


def render_frontmatter(book: dict, state: dict) -> str:
    genres = book.get("genres") or []
    lines = [
        "---",
        f"status: {state.get('status', 'not_started')}",
        f"uid: {book.get('uid', '')}",
        f'author: "[[{book.get("author", "")}]]"',
        f"total_pages: {int(state.get('total_pages') or 0)}",
        f"current_page: {int(state.get('current_page') or 0)}",
        _bare_or_valued("start_date", state.get("start_date") or ""),
        _bare_or_valued("completed_date", state.get("finish_date") or ""),
        f"image: {book.get('image_url') or ''}",
        # Two ratings, and the names have to keep them apart: `rating_value` is
        # the catalog's crowd average, `my_rating` is yours.
        f"my_rating: {clamp_my_rating(state.get('my_rating'))}",
        f"rating_value: {book.get('avg_rating') or 0}",
        f"rating_count: {int(book.get('rating_count') or 0)}",
        f"review_count: {int(book.get('review_count') or 0)}",
        f"genres: {', '.join(str(g) for g in genres)}",
        "---",
    ]
    return "\n".join(lines)


def render_markdown(book: dict, state: dict) -> str:
    description = str(book.get("description") or "").strip()
    notes = str(state.get("notes") or "").strip()
    return f"{render_frontmatter(book, state)}\n\n## Description\n\n{description}\n\n## Notes\n\n{notes}\n"


def _find_collision(root: Path, filename: str, exclude_uid: str) -> str | None:
    with transaction(root) as conn:
        row = conn.execute(
            "SELECT uid FROM user_book_state WHERE obsidian_filename = ? AND uid != ? LIMIT 1",
            (filename, exclude_uid),
        ).fetchone()
    return row["uid"] if row else None


def _atomic_write(path: Path, content: str) -> None:
    tmp_path = path.with_name(path.name + ".tmp")
    tmp_path.write_text(content, encoding="utf-8")
    os.replace(tmp_path, path)


def push_one(root: Path, uid: str, *, dry_run: bool = False) -> dict:
    """Push a single book's current Bookscape state out to its vault note.
    Always regenerates the whole file (including `## Notes`) from current SQL
    state — never reads an existing file first. Notes round-trip like every
    other field: Pull writes file -> SQL, Push writes SQL -> file; whichever
    direction ran most recently wins, same as status/progress/dates."""
    repo = DataRepository(root)
    state = repo.get_book_state(uid)
    if not state or state.get("status") not in EXPORTABLE_STATUSES:
        raise ValueError(f"{uid} is not currently reading/done")

    book = resolve_book(root, uid)
    if not book:
        raise ValueError(f"{uid} not found in catalog")

    vault_path = resolve_vault_path(root)
    if not vault_path.exists():
        raise FileNotFoundError(f"Obsidian vault not found at: {vault_path}")

    filename = state.get("obsidian_filename") or safe_filename(book.get("title", ""))

    collision_uid = _find_collision(root, filename, uid)
    if collision_uid:
        raise FilenameCollisionError(filename, [uid, collision_uid])

    if not dry_run:
        _atomic_write(vault_path / filename, render_markdown(book, state))
        repo.upsert_book_state(uid, obsidian_filename=filename)

    return {"uid": uid, "filename": filename, "dry_run": dry_run}


def run_obsidian_push(root: Path, *, dry_run: bool = False) -> PushResult:
    """Vault-level Push: export every reading/done book, full-regenerate.
    Filename collisions are skipped (not fatal) so one colliding pair never blocks
    the rest of the library — reported back for manual resolution in Obsidian."""
    vault_path = resolve_vault_path(root)
    if not vault_path.exists():
        raise FileNotFoundError(f"Obsidian vault not found at: {vault_path}")

    repo = DataRepository(root)
    states = repo.list_book_states()
    export_uids = [uid for uid, s in states.items() if s.get("status") in EXPORTABLE_STATUSES]

    targets: dict[str, str] = {}
    for uid in export_uids:
        state = states[uid]
        if state.get("obsidian_filename"):
            targets[uid] = state["obsidian_filename"]
            continue
        book = resolve_book(root, uid)
        if book and book.get("title"):
            targets[uid] = safe_filename(book["title"])

    by_filename: dict[str, list[str]] = {}
    for uid, filename in targets.items():
        by_filename.setdefault(filename, []).append(uid)

    skipped_collisions = []
    collided_uids: set[str] = set()
    for filename, uids in by_filename.items():
        if len(uids) > 1:
            skipped_collisions.append({"filename": filename, "uids": uids})
            collided_uids.update(uids)

    written = 0
    for uid in export_uids:
        if uid in collided_uids or uid not in targets:
            continue
        try:
            push_one(root, uid, dry_run=dry_run)
            written += 1
        except FilenameCollisionError as e:
            skipped_collisions.append({"filename": e.filename, "uids": e.uids})

    # Stale-file cleanup: a stored filename whose uid has genuinely left the
    # export set (status moved off reading/done) gets its file removed. Collided
    # uids are still valid reading/done books — just skipped for writing this
    # round — so they must never be treated as stale/deleted here.
    export_uid_set = set(export_uids)
    deleted = 0
    for uid, state in states.items():
        filename = state.get("obsidian_filename")
        if not filename or uid in export_uid_set:
            continue
        deleted += 1
        if not dry_run:
            stale_path = vault_path / filename
            if stale_path.exists():
                stale_path.unlink()
            repo.upsert_book_state(uid, obsidian_filename=None)

    return PushResult(
        vault_path=str(vault_path),
        written=written,
        deleted=deleted,
        skipped_collisions=skipped_collisions,
        dry_run=dry_run,
    )
