from __future__ import annotations

from pathlib import Path

from .db import transaction

BOOK_STATE_COLUMNS = {
    "status",
    "current_page",
    "total_pages",
    "start_date",
    "finish_date",
    "want_to_read",
    "my_rating",
    "notes",
    "obsidian_filename",
}
BOOK_STATE_BOOL_COLUMNS = {"want_to_read"}


class DataRepository:
    def __init__(self, root: Path) -> None:
        self.root = root

    @staticmethod
    def _row_to_state(row) -> dict:
        d = dict(row)
        for col in BOOK_STATE_BOOL_COLUMNS:
            d[col] = bool(d.get(col))
        return d

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

    # Book state

    def get_book_state(self, uid: str) -> dict | None:
        with transaction(self.root) as conn:
            row = conn.execute("SELECT * FROM user_book_state WHERE uid = ?", (uid,)).fetchone()
        return self._row_to_state(row) if row else None

    def list_book_states(self) -> dict[str, dict]:
        with transaction(self.root) as conn:
            rows = conn.execute("SELECT * FROM user_book_state").fetchall()
        return {row["uid"]: self._row_to_state(row) for row in rows}

    def upsert_book_state(self, uid: str, **fields) -> dict:
        fields = {k: v for k, v in fields.items() if k in BOOK_STATE_COLUMNS}
        if not fields:
            return self.get_book_state(uid) or {}

        # A finish date on an abandoned book is a contradiction, and a leaky one:
        # the stats year picker is built from every finish_date in the table, not
        # only the done ones, so a stray date would add a year whose book list is
        # empty. Cleared here rather than in the route because the Obsidian pull
        # writes state directly, and a vault note can carry a completed_date
        # alongside status: dnf.
        if str(fields.get("status") or "").strip().lower() == "dnf":
            fields["finish_date"] = ""

        columns = list(fields.keys())
        values = [int(v) if k in BOOK_STATE_BOOL_COLUMNS else v for k, v in fields.items()]
        col_list = ", ".join(["uid", *columns])
        placeholders = ", ".join(["?"] * (len(columns) + 1))
        update_clause = ", ".join(f"{c} = excluded.{c}" for c in columns)
        update_clause += ", updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"

        with transaction(self.root) as conn:
            conn.execute(
                f"INSERT INTO user_book_state ({col_list}) VALUES ({placeholders}) "
                f"ON CONFLICT(uid) DO UPDATE SET {update_clause}",
                [uid, *values],
            )

        return self.get_book_state(uid) or {}
