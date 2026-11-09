from __future__ import annotations

import difflib
import json
import sqlite3
from typing import Iterable, Literal, get_args

from ..db import transaction

Status = Literal["not_started", "want", "reading", "done", "dnf"]
VALID_STATUSES = set(get_args(Status))

BOOK_COLUMNS = {
    "title",
    "author",
    "image_url",
    "avg_rating",
    "rating_count",
    "review_count",
    "description",
    "page_count",
    "series",
    "series_number",
    "genres",
    "similar_book_ids",
    "scraped_at",
}

STATE_COLUMNS = {
    "status",
    "current_page",
    "total_pages",
    "start_date",
    "finish_date",
    "my_rating",
    "notes",
}

NON_GENRE_NAMES = {"...more", "…more", "more"}

# The one shape a book takes: what Goodreads says plus what you say. No state row
# means not started, and a total_pages of 0 means the catalog's own length.
_BOOK_SELECT = """
SELECT
  b.uid AS id,
  COALESCE(NULLIF(b.title, ''), 'Untitled') AS title,
  b.author, b.image_url, b.description, b.avg_rating, b.rating_count, b.review_count,
  b.page_count, b.series, b.series_number, b.genres, b.similar_book_ids,
  COALESCE(s.status, 'not_started') AS status,
  COALESCE(s.current_page, 0) AS current_page,
  COALESCE(NULLIF(s.total_pages, 0), b.page_count) AS total_pages,
  COALESCE(s.start_date, '') AS start_date,
  COALESCE(s.finish_date, '') AS finish_date,
  COALESCE(s.my_rating, 0) AS my_rating,
  COALESCE(s.notes, '') AS notes,
  COALESCE(s.updated_at, '') AS updated_at
FROM books b LEFT JOIN user_book_state s ON s.uid = b.uid
"""

# No row means not started, so a row that has gone back to saying nothing is
# removed rather than kept as an empty stand-in for the same fact.
_DELETE_IF_EMPTY = """
DELETE FROM user_book_state
WHERE uid = ? AND status = 'not_started' AND current_page = 0 AND total_pages = 0
  AND start_date = '' AND finish_date = '' AND my_rating = 0 AND notes = ''
"""


def _clean_genres(names: list | None) -> list[str]:
    """Drop scrape debris and repeats, keeping the order Goodreads lists them in."""
    clean: list[str] = []
    seen: set[str] = set()
    for raw in names or []:
        name = str(raw).strip()
        key = name.casefold()
        if name and key not in NON_GENRE_NAMES and key not in seen:
            seen.add(key)
            clean.append(name)
    return clean


def _to_book(row: sqlite3.Row) -> dict:
    return {
        **dict(row),
        "genres": json.loads(row["genres"]),
        "similar_book_ids": json.loads(row["similar_book_ids"]),
    }


def list_books() -> list[dict]:
    with transaction() as conn:
        return [_to_book(row) for row in conn.execute(_BOOK_SELECT)]


def resolve_book(book_id: str) -> dict | None:
    with transaction() as conn:
        row = conn.execute(f"{_BOOK_SELECT} WHERE b.uid = ?", (book_id,)).fetchone()
    return _to_book(row) if row else None


def _upsert(
    conn: sqlite3.Connection, table: str, uid: str, fields: dict, also_set: Iterable[str] = ()
) -> None:
    """Insert or partially update a row: only the columns in `fields` are touched."""
    columns = ", ".join(["uid", *fields])
    placeholders = ", ".join("?" * (len(fields) + 1))
    assignments = [*(f"{c} = excluded.{c}" for c in fields), *also_set]
    conflict = "DO UPDATE SET " + ", ".join(assignments) if assignments else "DO NOTHING"
    conn.execute(
        f"INSERT INTO {table} ({columns}) VALUES ({placeholders}) ON CONFLICT(uid) {conflict}",
        [uid, *fields.values()],
    )


def upsert_book(book: dict) -> None:
    uid = str(book.get("uid") or "").strip()
    if not uid:
        raise ValueError("book uid is required")

    fields = {k: v for k, v in book.items() if k in BOOK_COLUMNS}
    if "genres" in fields:
        fields["genres"] = json.dumps(_clean_genres(fields["genres"]), ensure_ascii=False)
    if "similar_book_ids" in fields:
        fields["similar_book_ids"] = json.dumps(fields["similar_book_ids"] or [])

    with transaction() as conn:
        _upsert(conn, "books", uid, fields)


def upsert_book_state(uid: str, **fields) -> None:
    fields = {k: v for k, v in fields.items() if k in STATE_COLUMNS}

    # A DNF has no finish date, or it adds an empty stats year. Here so CSV imports are covered too.
    if fields.get("status") == "dnf":
        fields["finish_date"] = ""

    with transaction() as conn:
        # Every caller hands over the length it was shown, which is usually
        # the catalog's own. Storing that would freeze a copy that a later
        # re-scrape could not correct, so only a real difference is kept.
        if "total_pages" in fields:
            book = conn.execute("SELECT page_count FROM books WHERE uid = ?", (uid,)).fetchone()
            if book and fields["total_pages"] == book["page_count"]:
                fields["total_pages"] = 0

        _upsert(
            conn,
            "user_book_state",
            uid,
            fields,
            also_set=["updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"],
        )
        conn.execute(_DELETE_IF_EMPTY, (uid,))


def search_book_ids(query: str, limit: int = 10) -> list[str]:
    """Ids of the best matches, best first. The client already holds the books."""
    q = query.lower().strip()
    if not q:
        return []

    scored = []
    for book in list_books():
        title_lower = book["title"].strip().lower()
        author_lower = book["author"].strip().lower()
        genres_text = " ".join(book["genres"])
        text_lower = f"{title_lower} {author_lower} {genres_text} {book['description']}".lower()

        if title_lower.startswith(q):
            lex_score = 5
        elif q in title_lower:
            lex_score = 4
        elif author_lower and (author_lower == q or author_lower.startswith(q)):
            lex_score = 5
        elif author_lower and q in author_lower:
            lex_score = 4
        elif q in text_lower:
            lex_score = 2
        else:
            lex_score = 0

        title_sim = difflib.SequenceMatcher(None, q, title_lower[: max(len(q), 24)]).ratio()
        author_sim = (
            difflib.SequenceMatcher(None, q, author_lower[: max(len(q), 24)]).ratio() if author_lower else 0
        )
        sim = max(title_sim, author_sim)
        fuzzy_score = 2 if sim >= 0.78 else 1 if sim >= 0.66 else 0
        total_score = lex_score + fuzzy_score

        if total_score > 0:
            scored.append((total_score, sim, book["id"]))

    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return [book_id for _, _, book_id in scored[:limit]]
