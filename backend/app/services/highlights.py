"""Snippets copied out of books. Validation lives here; routes only translate exceptions."""

from __future__ import annotations

from ..db import transaction

# Stops a runaway paste; the highlights page renders this in full.
MAX_TEXT_LENGTH = 5000
MAX_NOTE_LENGTH = 5000

# 0 means "no page recorded"; the ceiling only catches typos.
MAX_PAGE = 100_000


def _clean_text(text: str) -> str:
    clean = text.strip()
    if not clean:
        raise ValueError("Highlight text is required")
    return clean[:MAX_TEXT_LENGTH]


def _clean_note(note: str) -> str:
    return note.strip()[:MAX_NOTE_LENGTH]


def _clean_page(page: int) -> int:
    return min(MAX_PAGE, max(0, page))


def list_all() -> list[dict]:
    """Every highlight, newest first."""
    with transaction() as conn:
        rows = conn.execute(
            "SELECT id, uid AS book_id, text, page, note, created_at FROM highlights "
            "ORDER BY created_at DESC, id DESC"
        ).fetchall()
    return [dict(row) for row in rows]


def create(uid: str, text: str, page: int = 0) -> None:
    clean_text = _clean_text(text)
    with transaction() as conn:
        conn.execute(
            "INSERT INTO highlights (uid, text, page) VALUES (?, ?, ?)",
            (uid, clean_text, _clean_page(page)),
        )


def update(highlight_id: int, **fields) -> None:
    """Patch one highlight. Only the keys present are touched."""
    updates: dict[str, object] = {}
    if "text" in fields:
        updates["text"] = _clean_text(fields["text"])
    if "page" in fields:
        updates["page"] = _clean_page(fields["page"])
    if "note" in fields:
        updates["note"] = _clean_note(fields["note"])
    if not updates:
        raise ValueError("Nothing to update")

    assignments = ", ".join(f"{column} = ?" for column in updates)
    assignments += ", updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"
    with transaction() as conn:
        updated = conn.execute(
            f"UPDATE highlights SET {assignments} WHERE id = ?",
            [*updates.values(), highlight_id],
        ).rowcount
    if updated == 0:
        raise KeyError("Highlight not found")


def delete(highlight_id: int) -> None:
    with transaction() as conn:
        deleted = conn.execute("DELETE FROM highlights WHERE id = ?", (highlight_id,)).rowcount
    if deleted == 0:
        raise KeyError("Highlight not found")
