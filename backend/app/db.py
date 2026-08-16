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
  similar_book_ids  TEXT NOT NULL DEFAULT '[]',
  source_url        TEXT NOT NULL DEFAULT '',
  color             TEXT NOT NULL DEFAULT '',
  scraped_at        TEXT NOT NULL DEFAULT '',
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS genres (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS book_genres (
  uid       TEXT NOT NULL REFERENCES books(uid) ON DELETE CASCADE,
  genre_id  INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (uid, genre_id)
);
CREATE INDEX IF NOT EXISTS idx_bg_genre ON book_genres(genre_id);
CREATE INDEX IF NOT EXISTS idx_bg_uid_pos ON book_genres(uid, position);

CREATE TABLE IF NOT EXISTS user_book_state (
  uid               TEXT PRIMARY KEY REFERENCES books(uid) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'not_started'
                       CHECK (status IN ('not_started','reading','done')),
  current_page      INTEGER NOT NULL DEFAULT 0,
  total_pages       INTEGER NOT NULL DEFAULT 0,
  start_date        TEXT NOT NULL DEFAULT '',
  finish_date       TEXT NOT NULL DEFAULT '',
  want_to_read      INTEGER NOT NULL DEFAULT 0 CHECK (want_to_read IN (0,1)),
  notes             TEXT NOT NULL DEFAULT '',
  obsidian_filename TEXT,
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ubs_status ON user_book_state(status);

-- One row per (book, local calendar day) on which that book's page count moved.
-- user_book_state only ever holds the latest page, so it cannot answer "when";
-- this is the history, written at the moment of the edit because that is the
-- only point at which the delta is actually known.
--
-- `pages` is the day's *net* movement, which is what the (uid, day) primary key
-- buys: a page typed wrong and corrected the same day cancels out instead of
-- counting twice, and `last_page` still holds the page the book ended the day
-- on, so a row stays auditable against user_book_state after the fact.
--
-- Negative nets are stored as written rather than clamped, because restarting a
-- book is a real -300 and discarding it would make that day indistinguishable
-- from one never recorded. Reads filter to pages > 0 instead.
--
-- `source` is last-write-wins for a day that saw more than one kind of write,
-- which is the useful reading of it: a day that both progressed and finished a
-- book is a finish.
CREATE TABLE IF NOT EXISTS reading_days (
  uid       TEXT NOT NULL REFERENCES books(uid) ON DELETE CASCADE,
  day       TEXT NOT NULL,
  pages     INTEGER NOT NULL DEFAULT 0,
  last_page INTEGER NOT NULL DEFAULT 0,
  source    TEXT NOT NULL DEFAULT 'progress'
               CHECK (source IN ('progress','finish','backfill')),
  PRIMARY KEY (uid, day)
);
CREATE INDEX IF NOT EXISTS idx_reading_days_day ON reading_days(day);

CREATE TABLE IF NOT EXISTS collections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS collection_books (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  uid           TEXT NOT NULL REFERENCES books(uid) ON DELETE CASCADE,
  added_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (collection_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_cb_uid ON collection_books(uid);

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- One row per book whose cover we have tried to sample a color from. An empty
-- books.color cannot say whether a book is untried or permanently unsamplable,
-- so the color extractor would retry dead cover URLs forever. This table is
-- that missing bit, and the PRIMARY KEY makes "at most one attempt per book" a
-- constraint rather than a convention: a runner claims a book by inserting
-- 'pending' here *before* downloading, so a crash mid-fetch leaves a visible
-- claim instead of silently re-running later.
CREATE TABLE IF NOT EXISTS cover_attempts (
  uid          TEXT PRIMARY KEY REFERENCES books(uid) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','ok','failed')),
  reason       TEXT NOT NULL DEFAULT '',
  detail       TEXT NOT NULL DEFAULT '',
  attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cover_attempts_status ON cover_attempts(status);
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


def init_app_db(root: Path) -> None:
    conn = get_connection(root)
    try:
        conn.executescript(SCHEMA_SQL)
        conn.commit()
    finally:
        conn.close()
