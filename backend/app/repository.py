from __future__ import annotations

from pathlib import Path

from .db import transaction

BOOK_STATE_COLUMNS = {
    "status",
    "current_page",
    "total_pages",
    "start_date",
    "finish_date",
    "my_rating",
    "notes",
}
VALID_STATUSES = {"not_started", "want", "reading", "done", "dnf"}

# No row means not started, so a row that has gone back to saying nothing is
# removed rather than kept as an empty stand-in for the same fact.
_DELETE_IF_EMPTY = """
DELETE FROM user_book_state
WHERE uid = ? AND status = 'not_started' AND current_page = 0 AND total_pages = 0
  AND start_date = '' AND finish_date = '' AND my_rating = 0 AND notes = ''
"""


class DataRepository:
    def __init__(self, root: Path) -> None:
        self.root = root

    # Settings

    def get_setting(self, key: str, default: str = "") -> str:
        with transaction(self.root) as conn:
            row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default

    def set_setting(self, key: str, value: str) -> None:
        with transaction(self.root) as conn:
            conn.execute(
                "INSERT INTO app_settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )

    def get_book_state(self, uid: str) -> dict | None:
        with transaction(self.root) as conn:
            row = conn.execute("SELECT * FROM user_book_state WHERE uid = ?", (uid,)).fetchone()
        return dict(row) if row else None

    def list_book_states(self) -> dict[str, dict]:
        with transaction(self.root) as conn:
            rows = conn.execute("SELECT * FROM user_book_state").fetchall()
        return {row["uid"]: dict(row) for row in rows}

    def upsert_book_state(self, uid: str, **fields) -> None:
        fields = {k: v for k, v in fields.items() if k in BOOK_STATE_COLUMNS}
        if not fields:
            return

        # A DNF has no finish date, or it adds an empty stats year. Here so CSV imports are covered too.
        if str(fields.get("status") or "").strip().lower() == "dnf":
            fields["finish_date"] = ""

        with transaction(self.root) as conn:
            # Every caller hands over the length it was shown, which is usually
            # the catalog's own. Storing that would freeze a copy that a later
            # re-scrape could not correct, so only a real difference is kept.
            if "total_pages" in fields:
                book = conn.execute("SELECT page_count FROM books WHERE uid = ?", (uid,)).fetchone()
                if book and int(fields["total_pages"] or 0) == int(book["page_count"] or 0):
                    fields["total_pages"] = 0

            columns = list(fields.keys())
            col_list = ", ".join(["uid", *columns])
            placeholders = ", ".join(["?"] * (len(columns) + 1))
            update_clause = ", ".join(f"{c} = excluded.{c}" for c in columns)
            update_clause += ", updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"
            conn.execute(
                f"INSERT INTO user_book_state ({col_list}) VALUES ({placeholders}) "
                f"ON CONFLICT(uid) DO UPDATE SET {update_clause}",
                [uid, *fields.values()],
            )
            conn.execute(_DELETE_IF_EMPTY, (uid,))
