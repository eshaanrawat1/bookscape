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
  liked             INTEGER NOT NULL DEFAULT 0 CHECK (liked IN (0,1)),
  want_to_read      INTEGER NOT NULL DEFAULT 0 CHECK (want_to_read IN (0,1)),
  notes             TEXT NOT NULL DEFAULT '',
  obsidian_filename TEXT,
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ubs_status ON user_book_state(status);

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
