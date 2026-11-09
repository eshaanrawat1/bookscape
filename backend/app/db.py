from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

DB_FILENAME = "bookscape.db"

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS books (
  uid               TEXT PRIMARY KEY,
  title             TEXT NOT NULL DEFAULT '',
  author            TEXT NOT NULL DEFAULT '',
  image_url         TEXT NOT NULL DEFAULT '',
  avg_rating        REAL NOT NULL DEFAULT 0,
  rating_count      INTEGER NOT NULL DEFAULT 0,
  review_count      INTEGER NOT NULL DEFAULT 0,
  description       TEXT NOT NULL DEFAULT '',
  page_count        INTEGER NOT NULL DEFAULT 0,
  series            TEXT NOT NULL DEFAULT '',
  series_number     TEXT NOT NULL DEFAULT '',
  -- Ordered JSON arrays: both are read whole, always alongside the book.
  genres            TEXT NOT NULL DEFAULT '[]',
  similar_book_ids  TEXT NOT NULL DEFAULT '[]',
  scraped_at        TEXT NOT NULL DEFAULT ''
);

-- What you say about a book, where `books` is what Goodreads says. No row means
-- not started; a row left holding nothing is deleted rather than kept.
--
-- `total_pages` is your edition's length when it differs from the catalog's, and
-- 0 otherwise.
CREATE TABLE IF NOT EXISTS user_book_state (
  uid               TEXT PRIMARY KEY REFERENCES books(uid) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'not_started'
                       CHECK (status IN ('not_started','want','reading','done','dnf')),
  current_page      INTEGER NOT NULL DEFAULT 0,
  total_pages       INTEGER NOT NULL DEFAULT 0,
  start_date        TEXT NOT NULL DEFAULT '',
  finish_date       TEXT NOT NULL DEFAULT '',
  -- Your own score out of 5, distinct from books.avg_rating (the scraped crowd
  -- average). 0 is "not rated yet" rather than a literal zero, matching every
  -- display site's `rating > 0` gate — a book you actively hated is a 0.01.
  my_rating         REAL NOT NULL DEFAULT 0
                       CHECK (my_rating >= 0 AND my_rating <= 5),
  notes             TEXT NOT NULL DEFAULT '',
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ubs_status ON user_book_state(status);

-- `icon` is a lucide icon name (kebab-case) or '' for the default dot. The
-- backend keeps it opaque: the icon set lives in the frontend, so a name that
-- no longer resolves there simply falls back to the dot rather than 404ing
-- here.
CREATE TABLE IF NOT EXISTS collections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  icon       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS collection_books (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  uid           TEXT NOT NULL REFERENCES books(uid) ON DELETE CASCADE,
  added_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (collection_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_cb_uid ON collection_books(uid);

-- A snippet copied out of a book, with the page it came from and an optional
-- note of your own about it. Distinct from user_book_state.notes, which is one
-- free-text field per book: these are many per book, each anchored to a page.
--
-- `page` is 0 for "no page recorded" rather than nullable, matching my_rating's
-- reading of 0 — a highlight's page is either known or it isn't, and no book
-- has a page zero to confuse it with.
--
-- Bookscape-only, like collections: highlights are not part of CSV import/export.
CREATE TABLE IF NOT EXISTS highlights (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT NOT NULL REFERENCES books(uid) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  page       INTEGER NOT NULL DEFAULT 0,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_highlights_uid ON highlights(uid, created_at);

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
"""


def db_path(root: Path) -> Path:
    data_dir = root / "backend" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / DB_FILENAME


def get_connection(root: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path(root), timeout=5, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def transaction(root: Path) -> Iterator[sqlite3.Connection]:
    conn = get_connection(root)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _add_missing_columns(conn: sqlite3.Connection) -> None:
    """Add columns missing from an existing database; changing a column needs a real migration."""
    for table, column, ddl in (
        (
            "user_book_state",
            "my_rating",
            "REAL NOT NULL DEFAULT 0 CHECK (my_rating >= 0 AND my_rating <= 5)",
        ),
        ("collections", "icon", "TEXT NOT NULL DEFAULT ''"),
    ):
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


def _drop_obsidian_leftovers(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(user_book_state)")}
    if "obsidian_filename" in columns:
        conn.execute("ALTER TABLE user_book_state DROP COLUMN obsidian_filename")
    conn.execute("DELETE FROM app_settings WHERE key = 'obsidian_vault_path'")


def init_app_db(root: Path) -> None:
    conn = get_connection(root)
    try:
        conn.executescript(SCHEMA_SQL)
        _add_missing_columns(conn)
        _drop_obsidian_leftovers(conn)
        conn.commit()
    finally:
        conn.close()
