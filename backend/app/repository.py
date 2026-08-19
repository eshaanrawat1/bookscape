from __future__ import annotations

import sqlite3
from datetime import date
from pathlib import Path

from .db import transaction
from .utils import parse_iso_date_string

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

    def upsert_book_state(self, uid: str, *, day: str = "", **fields) -> dict:
        """Write book state, recording any page movement against a calendar day.

        `day` defaults to the machine's local date, which is the right answer
        here rather than UTC: the API runs as a local process on the user's own
        machine, so its today *is* their today. Callers only pass it explicitly
        when they are writing history rather than the present (the backfill).
        """
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

        # Only page and status writes can move the heatmap, so want_to_read and
        # obsidian_filename updates skip the extra read and locking entirely.
        tracked = "current_page" in fields or "status" in fields

        with transaction(self.root) as conn:
            prev = None
            if tracked:
                # BEGIN IMMEDIATE is what makes read-then-write atomic here.
                # pysqlite only opens a transaction implicitly before a write,
                # so without it this SELECT runs in autocommit and two saves
                # landing together — the dialog's autosave and an Obsidian pull,
                # say — could both diff against the same stale page.
                conn.execute("BEGIN IMMEDIATE")
                prev = conn.execute(
                    "SELECT current_page, total_pages, status, finish_date "
                    "FROM user_book_state WHERE uid = ?",
                    (uid,),
                ).fetchone()

            conn.execute(
                f"INSERT INTO user_book_state ({col_list}) VALUES ({placeholders}) "
                f"ON CONFLICT(uid) DO UPDATE SET {update_clause}",
                [uid, *values],
            )

            if tracked:
                self._track_progress(conn, uid, fields, prev, day or date.today().isoformat())

        return self.get_book_state(uid) or {}

    # Reading days (heatmap)

    @staticmethod
    def _add_reading_day(
        conn: sqlite3.Connection,
        uid: str,
        day: str,
        pages: int,
        last_page: int,
        source: str = "progress",
    ) -> None:
        """Accumulate a signed page delta onto one book-day. No-op for zero."""
        if not pages or not day:
            return
        conn.execute(
            "INSERT INTO reading_days (uid, day, pages, last_page, source) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(uid, day) DO UPDATE SET "
            "  pages = pages + excluded.pages, "
            "  last_page = excluded.last_page, "
            "  source = excluded.source",
            (uid, day, pages, last_page, source),
        )

    def _track_progress(
        self,
        conn: sqlite3.Connection,
        uid: str,
        fields: dict,
        prev: sqlite3.Row | None,
        day: str,
    ) -> None:
        """Translate one state write into reading_days rows.

        Ordinary progress is credited to `day`, the day of the edit. For an
        Obsidian pull that means the sync day rather than the day the pages were
        really read, which frontmatter carrying only a current page cannot
        recover.

        A book *completing* is the exception, and is credited to its finish_date
        instead. Marking a book done sets its page to the total in the same
        write, so without this the closing chunk would land on the day the user
        happened to log it — a book finished last month would light up today and
        leave its real finish date empty.
        """
        prior = dict(prev) if prev else {}
        was_done = str(prior.get("status") or "").strip().lower() == "done"
        is_done = str(fields.get("status") or "").strip().lower() == "done"
        finishing = is_done and not was_done

        target, source = day, "progress"
        if finishing:
            target = parse_iso_date_string(fields.get("finish_date") or prior.get("finish_date")) or day
            source = "finish"

        # Whether the book was already being tracked decides how a finish is
        # credited, and the delta below adds a row of its own, so this has to be
        # read first.
        tracked_before = finishing and bool(
            conn.execute(
                "SELECT 1 FROM reading_days WHERE uid = ? LIMIT 1", (uid,)
            ).fetchone()
        )

        from_page = int(prior.get("current_page") or 0)
        to_page = int(fields.get("current_page", from_page) or 0)
        self._add_reading_day(conn, uid, target, to_page - from_page, to_page, source=source)

        if not finishing:
            return

        # A book flipped straight to done never had its pages typed in at all,
        # so the delta above was zero and the history is short by the whole
        # book. Without this the most common way to finish a book — never
        # touching the page field — would contribute nothing to the heatmap.
        #
        # Only for a book with *no* day history, though. Once a book has been
        # tracked, the shortfall is not missing pages from this session but the
        # stretch read before the heatmap existed, and crediting that to the
        # finish date turns an ordinary last day into a false several-hundred
        # page one. Those pages stay untracked; the backfill script is the place
        # that reconstructs pre-tracking history, and it says so.
        if tracked_before:
            return

        total = int(fields.get("total_pages") or prior.get("total_pages") or 0)
        if total <= 0:
            return
        counted = conn.execute(
            "SELECT COALESCE(SUM(MAX(pages, 0)), 0) AS n FROM reading_days WHERE uid = ?", (uid,)
        ).fetchone()
        remainder = total - int(counted["n"] or 0)
        if remainder > 0:
            self._add_reading_day(conn, uid, target, remainder, total, source="finish")

    def reading_days(self, start: str, end: str) -> list[dict]:
        """Daily page totals across the inclusive range, omitting empty days.

        Non-positive nets are filtered rather than clamped to zero, which keeps
        the book count honest too: a day whose only movement was a restart is
        not "a day you read one book".
        """
        with transaction(self.root) as conn:
            rows = conn.execute(
                "SELECT day, SUM(pages) AS pages, COUNT(*) AS books, GROUP_CONCAT(uid) AS uids "
                "FROM reading_days "
                "WHERE pages > 0 AND day BETWEEN ? AND ? "
                "GROUP BY day ORDER BY day",
                (start, end),
            ).fetchall()
        return [
            {
                "date": row["day"],
                "pages": int(row["pages"] or 0),
                "books": int(row["books"] or 0),
                # Catalog uids are numeric strings, so the default separator is
                # unambiguous.
                "book_ids": [u for u in str(row["uids"] or "").split(",") if u],
            }
            for row in rows
        ]

    def books_with_reading_days(self) -> set[str]:
        """Uids that already have day history — the backfill's skip list."""
        with transaction(self.root) as conn:
            rows = conn.execute("SELECT DISTINCT uid FROM reading_days").fetchall()
        return {row["uid"] for row in rows}

    def add_reading_days(self, rows: list[tuple[str, str, int, int]], source: str = "backfill") -> int:
        """Bulk-add (uid, day, pages, last_page) rows in one transaction."""
        with transaction(self.root) as conn:
            for uid, day, pages, last_page in rows:
                self._add_reading_day(conn, uid, day, pages, last_page, source=source)
        return len(rows)
