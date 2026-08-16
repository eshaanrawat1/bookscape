from __future__ import annotations

import difflib
import json
from pathlib import Path

from ..db import transaction
from ..utils import normalize_text, split_author_field

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
    "similar_book_ids",
    "source_url",
    "color",
    "scraped_at",
}


# Goodreads renders an expand link inside the genre list that matches the same
# tag selector as real genres, so filter it out wherever genres get written.
NON_GENRE_NAMES = {"...more", "…more", "more"}


def _parse_json_list(value: object) -> list:
    try:
        parsed = json.loads(value) if value else []
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def _genres_for_uid(conn, uid: str) -> list[str]:
    rows = conn.execute(
        "SELECT genres.name AS name FROM book_genres "
        "JOIN genres ON genres.id = book_genres.genre_id "
        "WHERE book_genres.uid = ? ORDER BY book_genres.position",
        (uid,),
    ).fetchall()
    return [row["name"] for row in rows]


def _state_for_uid(conn, uid: str) -> dict | None:
    row = conn.execute("SELECT * FROM user_book_state WHERE uid = ?", (uid,)).fetchone()
    return dict(row) if row else None


def _states_map(conn) -> dict[str, dict]:
    rows = conn.execute("SELECT * FROM user_book_state").fetchall()
    return {row["uid"]: dict(row) for row in rows}


def reading_overlay(state: dict | None, page_count: object = 0) -> dict:
    """The reading-row half of a book payload, in the shape the client reads.

    A book is two rows — the catalog row (what the edition *is*) and the
    user_book_state row (where *you* are in it) — and the card that renders a
    book wants both. Keeping the overlay in one function, applied at the single
    point where a catalog row becomes a dict, is what makes progress show up on
    every page that lists books rather than only the ones whose endpoint
    remembered to join the reading row. It used to be the latter, which is why
    a book you were halfway through rendered as an untouched one everywhere
    except Reading Now.

    The keys are prefixed `reading_` because both rows carry a page count and
    they mean different things: the reading row's is the edition in your hands,
    the catalog's `page_count` is whatever was scraped. The client prefers the
    former, so an untracked book falls back to the latter here — the same rule
    GET /reading-progress/{id} already applies when it seeds a fresh tracking
    panel, and the reason opening one lands on "0 of 412" rather than "0 of 0".

    Every book gets the full set, zeroed and "not_started" when there is no
    reading row, so no consumer has to test for presence.
    """
    state = state or {}
    total_pages = int(state.get("total_pages") or 0)
    if total_pages <= 0:
        total_pages = max(0, int(page_count or 0))
    return {
        "reading_status": str(state.get("status") or "not_started"),
        "reading_current_page": int(state.get("current_page") or 0),
        "reading_total_pages": total_pages,
        "reading_start_date": str(state.get("start_date") or ""),
        "reading_finish_date": str(state.get("finish_date") or ""),
        "want_to_read": bool(state.get("want_to_read")),
    }


def _row_to_book(
    conn,
    row,
    genres_map: dict[str, list[str]] | None = None,
    states_map: dict[str, dict] | None = None,
) -> dict:
    book = dict(row)
    uid = book["uid"]
    book["similar_book_ids"] = _parse_json_list(book.get("similar_book_ids"))
    book["genres"] = (
        genres_map.get(uid, []) if genres_map is not None else _genres_for_uid(conn, uid)
    )
    # The maps are the bulk path: callers listing more than one book build them
    # once up front so attaching genres and reading state stays two queries
    # rather than two per book.
    state = states_map.get(uid) if states_map is not None else _state_for_uid(conn, uid)
    book.update(reading_overlay(state, book.get("page_count")))
    return book


def _load_all_books(conn) -> list[dict]:
    book_rows = conn.execute("SELECT * FROM books").fetchall()
    genre_rows = conn.execute(
        "SELECT book_genres.uid AS uid, genres.name AS name FROM book_genres "
        "JOIN genres ON genres.id = book_genres.genre_id "
        "ORDER BY book_genres.uid, book_genres.position"
    ).fetchall()
    genres_map: dict[str, list[str]] = {}
    for row in genre_rows:
        genres_map.setdefault(row["uid"], []).append(row["name"])
    states = _states_map(conn)
    return [_row_to_book(conn, row, genres_map, states) for row in book_rows]


def _replace_genres(conn, uid: str, genre_names: list) -> None:
    conn.execute("DELETE FROM book_genres WHERE uid = ?", (uid,))
    clean = [
        name
        for g in (genre_names or [])
        if (name := str(g).strip()) and name.lower() not in NON_GENRE_NAMES
    ]
    for position, name in enumerate(clean):
        conn.execute("INSERT INTO genres (name) VALUES (?) ON CONFLICT(name) DO NOTHING", (name,))
        genre_row = conn.execute("SELECT id FROM genres WHERE name = ? COLLATE NOCASE", (name,)).fetchone()
        conn.execute(
            "INSERT INTO book_genres (uid, genre_id, position) VALUES (?, ?, ?)",
            (uid, genre_row["id"], position),
        )


def upsert_book(root: Path, book: dict) -> None:
    """Insert or partially update a catalog row. Only keys present in `book` are touched,
    so a partial dict (e.g. from an Obsidian Pull) never nulls out scraper-only fields."""
    uid = str(book.get("uid") or "").strip()
    if not uid:
        raise ValueError("book uid is required")

    fields = {k: v for k, v in book.items() if k in BOOK_COLUMNS}
    if "similar_book_ids" in fields:
        fields["similar_book_ids"] = json.dumps(fields["similar_book_ids"] or [])

    columns = list(fields.keys())
    values = list(fields.values())
    col_list = ", ".join(["uid", *columns])
    placeholders = ", ".join(["?"] * (len(columns) + 1))
    if columns:
        update_clause = ", ".join(f"{c} = excluded.{c}" for c in columns)
        update_clause += ", updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"
    else:
        update_clause = "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"

    with transaction(root) as conn:
        conn.execute(
            f"INSERT INTO books ({col_list}) VALUES ({placeholders}) "
            f"ON CONFLICT(uid) DO UPDATE SET {update_clause}",
            [uid, *values],
        )
        if "genres" in book:
            _replace_genres(conn, uid, book.get("genres") or [])


def has_data(root: Path) -> bool:
    with transaction(root) as conn:
        row = conn.execute("SELECT 1 FROM books LIMIT 1").fetchone()
    return row is not None


def resolve_book(root: Path, book_id: str) -> dict | None:
    book_id = str(book_id or "").strip()
    if not book_id:
        return None
    with transaction(root) as conn:
        row = conn.execute("SELECT * FROM books WHERE uid = ?", (book_id,)).fetchone()
        if not row:
            return None
        return _row_to_book(conn, row)


def get_book_with_similar(root: Path, book_id: str) -> dict | None:
    book = resolve_book(root, book_id)
    if not book:
        return None

    similar_ids = [str(sid) for sid in (book.get("similar_book_ids") or []) if str(sid).strip()]
    similar_books: list[dict] = []
    if similar_ids:
        with transaction(root) as conn:
            placeholders = ", ".join(["?"] * len(similar_ids))
            rows = conn.execute(f"SELECT * FROM books WHERE uid IN ({placeholders})", similar_ids).fetchall()
            states = _states_map(conn)
            by_uid = {row["uid"]: _row_to_book(conn, row, states_map=states) for row in rows}
        similar_books = [by_uid[sid] for sid in similar_ids if sid in by_uid]

    result = dict(book)
    result["similar_books"] = similar_books
    return result


def search_books(root: Path, query: str, limit: int = 10) -> list[dict]:
    q = str(query or "").lower().strip()
    if not q:
        return []

    with transaction(root) as conn:
        books = _load_all_books(conn)

    scored = []
    for point in books:
        title = str(point.get("title", "")).strip()
        title_lower = title.lower()
        if not title_lower:
            continue

        author_lower = str(point.get("author", "")).strip().lower()
        genres = point.get("genres", [])
        genres_text = " ".join(str(g) for g in genres) if isinstance(genres, list) else str(genres or "")
        text_lower = f"{title_lower} {author_lower} {genres_text} {point.get('description', '')}".lower()

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
            scored.append((total_score, sim, point))

    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)

    out = []
    seen = set()
    for _, _, point in scored:
        key = point.get("uid") or f"{point.get('title', '')}::{point.get('author', '')}"
        if key not in seen:
            seen.add(key)
            out.append(point)
            if len(out) >= limit:
                break

    return out


def get_global_library(root: Path) -> list[dict]:
    with transaction(root) as conn:
        all_books = _load_all_books(conn)
    if not all_books:
        return []

    top_genres = ["Romantasy", "Romance", "Fantasy", "Young Adult", "Classics", "High Fantasy", "Dark Academia", "Science Fiction", "Historical Fiction", "Mystery", "Thriller", "Nonfiction", "Philosophy", "Self Help", "Psychology", "History"]
    top_genres_set = set(top_genres)

    by_genre: dict[str, list[dict]] = {g: [] for g in top_genres}
    for book in all_books:
        genres = book.get("genres") or []
        for g in genres:
            if g in top_genres_set:
                by_genre[g].append(book)

    library = []
    for genre in top_genres:
        genre_books = by_genre[genre]
        genre_books.sort(key=lambda x: int(x.get("rating_count", 0) or 0), reverse=True)
        # Only the genre is overridden — a book filed under several should read
        # as belonging to the shelf it is sitting on. Everything else is passed
        # through as-is: this used to hand-pick a dozen keys and hardcode
        # "not_started", which is how the Library page became the one place a
        # book you were halfway through rendered as an untouched one.
        mapped = [{**b, "genre": genre} for b in genre_books[:30]]
        library.append({"genre": genre, "books": mapped})

    return library


def get_books_by_author(root: Path, author: str) -> list[dict]:
    query = normalize_text(author)
    if not query:
        return []

    with transaction(root) as conn:
        all_books = _load_all_books(conn)

    matched = []
    seen: set[str] = set()
    for book in all_books:
        author_field = book.get("author", "")
        candidates = [(author_field)] + [
            normalize_text(part) for part in split_author_field(author_field)
        ]
        if any(c and (c == query or c in query or query in c) for c in candidates):
            book_uid = str(book.get("uid") or "").strip()
            if book_uid and book_uid not in seen:
                seen.add(book_uid)
                matched.append(book)

    matched.sort(key=lambda item: (str(item.get("title") or "").lower(), str(item.get("uid") or "")))
    return matched


def series_sort_key(book: dict) -> tuple:
    """Order a series the way a reader would shelve it: by number, ascending.

    `series_number` is text because Goodreads numbers novellas "1.5", so it is
    parsed here rather than sorted as a string — otherwise "10" would file
    between "1" and "2". Anything unparseable (an omnibus "1-3", an empty
    number on a prequel) sorts to the end rather than crashing or landing at
    zero, where it would displace book one.
    """
    raw = str(book.get("series_number") or "").strip()
    try:
        return (0, float(raw), str(book.get("title") or "").lower())
    except ValueError:
        return (1, 0.0, str(book.get("title") or "").lower())


def get_books_by_series(root: Path, series: str) -> list[dict]:
    query = str(series or "").strip()
    if not query:
        return []

    with transaction(root) as conn:
        rows = conn.execute(
            "SELECT * FROM books WHERE series = ? COLLATE NOCASE",
            (query,),
        ).fetchall()
        states = _states_map(conn)
        matched = [_row_to_book(conn, row, states_map=states) for row in rows]

    matched.sort(key=series_sort_key)
    return matched


def get_books_by_genre(root: Path, genre: str, limit: int = 100) -> list[dict]:
    query = str(genre or "").strip()
    if not query:
        return []

    with transaction(root) as conn:
        rows = conn.execute(
            "SELECT DISTINCT books.* FROM books "
            "JOIN book_genres ON book_genres.uid = books.uid "
            "JOIN genres ON genres.id = book_genres.genre_id "
            "WHERE genres.name = ? COLLATE NOCASE "
            "ORDER BY books.rating_count DESC LIMIT ?",
            (query, limit),
        ).fetchall()
        states = _states_map(conn)
        matched = [_row_to_book(conn, row, states_map=states) for row in rows]

    return matched
