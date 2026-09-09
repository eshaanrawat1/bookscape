from __future__ import annotations

from pathlib import Path

from ..db import transaction

# A highlight is a snippet, not a chapter. The cap is generous enough for a long
# passage and exists so a runaway paste cannot put a megabyte in a row that the
# highlights page renders in full.
MAX_TEXT_LENGTH = 5000
MAX_NOTE_LENGTH = 5000

# No book has a page zero, so 0 doubles as "no page recorded"; the ceiling is
# only here to keep a mistyped number out of the column.
MAX_PAGE = 100_000


class HighlightStore:
    """Snippets copied out of books, with the page and an optional note.

    Shaped like ReadingListStore: the validation lives here so every caller gets
    it, and the routes only translate the exceptions into status codes.
    """

    def __init__(self, root: Path) -> None:
        self.root = root

    @staticmethod
    def _clean_text(text: object) -> str:
        clean = str(text or "").strip()
        if not clean:
            raise ValueError("Highlight text is required")
        return clean[:MAX_TEXT_LENGTH]

    @staticmethod
    def _clean_note(note: object) -> str:
        return str(note or "").strip()[:MAX_NOTE_LENGTH]

    @staticmethod
    def _clean_page(page: object) -> int:
        try:
            value = int(page or 0)
        except (TypeError, ValueError) as e:
            raise ValueError("Page must be a number") from e
        return min(MAX_PAGE, max(0, value))

    @staticmethod
    def _row_to_highlight(row) -> dict:
        return {
            "id": int(row["id"]),
            "book_id": str(row["uid"]),
            "text": str(row["text"] or ""),
            "page": int(row["page"] or 0),
            "note": str(row["note"] or ""),
            "created_at": str(row["created_at"] or ""),
            "updated_at": str(row["updated_at"] or ""),
        }

    # Reads

    def list_all(self) -> list[dict]:
        """Every highlight, grouped by book, newest-highlighted book first.

        One query rather than one per book: the page shows the whole corpus at
        once, and the grouping is cheaper here than as N round trips.
        """
        with transaction(self.root) as conn:
            rows = conn.execute(
                "SELECT * FROM highlights ORDER BY created_at DESC, id DESC"
            ).fetchall()

        groups: dict[str, list[dict]] = {}
        for row in rows:
            groups.setdefault(str(row["uid"]), []).append(self._row_to_highlight(row))
        # Dicts keep insertion order, and the rows arrived newest-first, so the
        # book whose most recent highlight is newest is already first.
        return [{"book_id": uid, "highlights": items} for uid, items in groups.items()]

    def list_for_book(self, uid: str) -> list[dict]:
        with transaction(self.root) as conn:
            rows = conn.execute(
                "SELECT * FROM highlights WHERE uid = ? ORDER BY created_at DESC, id DESC",
                (uid,),
            ).fetchall()
        return [self._row_to_highlight(row) for row in rows]

    def book_id_for(self, highlight_id: int) -> str:
        """The book a highlight belongs to — what a mutation's response is keyed on."""
        with transaction(self.root) as conn:
            row = conn.execute("SELECT uid FROM highlights WHERE id = ?", (highlight_id,)).fetchone()
        if not row:
            raise KeyError("Highlight not found")
        return str(row["uid"])

    # Writes

    def create(self, uid: str, text: object, page: object = 0) -> dict:
        clean_uid = str(uid or "").strip()
        if not clean_uid:
            raise ValueError("book_id is required")
        clean_text = self._clean_text(text)
        clean_page = self._clean_page(page)
        with transaction(self.root) as conn:
            cur = conn.execute(
                "INSERT INTO highlights (uid, text, page) VALUES (?, ?, ?)",
                (clean_uid, clean_text, clean_page),
            )
            row = conn.execute("SELECT * FROM highlights WHERE id = ?", (cur.lastrowid,)).fetchone()
        return self._row_to_highlight(row)

    def update(self, highlight_id: int, **fields) -> dict:
        """Patch one highlight. Only the keys present are touched."""
        updates: dict[str, object] = {}
        if "text" in fields:
            updates["text"] = self._clean_text(fields["text"])
        if "page" in fields:
            updates["page"] = self._clean_page(fields["page"])
        if "note" in fields:
            updates["note"] = self._clean_note(fields["note"])
        if not updates:
            raise ValueError("Nothing to update")

        assignments = ", ".join(f"{column} = ?" for column in updates)
        assignments += ", updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"
        with transaction(self.root) as conn:
            cur = conn.execute(
                f"UPDATE highlights SET {assignments} WHERE id = ?",
                [*updates.values(), highlight_id],
            )
            if cur.rowcount == 0:
                raise KeyError("Highlight not found")
            row = conn.execute("SELECT * FROM highlights WHERE id = ?", (highlight_id,)).fetchone()
        return self._row_to_highlight(row)

    def delete(self, highlight_id: int) -> None:
        with transaction(self.root) as conn:
            cur = conn.execute("DELETE FROM highlights WHERE id = ?", (highlight_id,))
            deleted = cur.rowcount
        if deleted == 0:
            raise KeyError("Highlight not found")
