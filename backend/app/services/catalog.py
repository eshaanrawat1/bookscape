from __future__ import annotations

import difflib
import json
from pathlib import Path

from ..db import transaction
from ..utils import clamp_my_rating

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

NON_GENRE_NAMES = {"...more", "…more", "more"}


def _parse_json_list(value: object) -> list:
    try:
        parsed = json.loads(value) if value else []
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


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


def _to_book(row, state: dict | None) -> dict:
    """The one shape a book takes: what Goodreads says plus what you say."""
    state = state or {}
    page_count = int(row["page_count"] or 0)
    return {
        "id": row["uid"],
        "title": row["title"],
        "author": row["author"],
        "image_url": row["image_url"],
        "description": row["description"],
        "avg_rating": float(row["avg_rating"] or 0),
        "rating_count": int(row["rating_count"] or 0),
        "review_count": int(row["review_count"] or 0),
        "page_count": page_count,
        "series": row["series"],
        "series_number": row["series_number"],
        "genres": _parse_json_list(row["genres"]),
        "similar_book_ids": [str(sid) for sid in _parse_json_list(row["similar_book_ids"])],
        "status": str(state.get("status") or "not_started"),
        "current_page": int(state.get("current_page") or 0),
        "total_pages": int(state.get("total_pages") or 0) or page_count,
        "start_date": str(state.get("start_date") or ""),
        "finish_date": str(state.get("finish_date") or ""),
        "my_rating": clamp_my_rating(state.get("my_rating")),
        "notes": str(state.get("notes") or ""),
        "updated_at": str(state.get("updated_at") or ""),
    }


def list_books(root: Path) -> list[dict]:
    with transaction(root) as conn:
        rows = conn.execute("SELECT * FROM books").fetchall()
        states = {row["uid"]: dict(row) for row in conn.execute("SELECT * FROM user_book_state")}
    return [_to_book(row, states.get(row["uid"])) for row in rows]


def resolve_book(root: Path, book_id: str) -> dict | None:
    book_id = str(book_id or "").strip()
    if not book_id:
        return None
    with transaction(root) as conn:
        row = conn.execute("SELECT * FROM books WHERE uid = ?", (book_id,)).fetchone()
        if not row:
            return None
        state = conn.execute("SELECT * FROM user_book_state WHERE uid = ?", (book_id,)).fetchone()
    return _to_book(row, dict(state) if state else None)


def upsert_book(root: Path, book: dict) -> None:
    """Insert or partially update a catalog row. Only keys present in `book` are
    touched, so a partial dict never blanks a field it does not carry."""
    uid = str(book.get("uid") or "").strip()
    if not uid:
        raise ValueError("book uid is required")

    fields = {k: v for k, v in book.items() if k in BOOK_COLUMNS}
    if "genres" in fields:
        fields["genres"] = json.dumps(_clean_genres(fields["genres"]), ensure_ascii=False)
    if "similar_book_ids" in fields:
        fields["similar_book_ids"] = json.dumps(fields["similar_book_ids"] or [])

    columns = list(fields.keys())
    col_list = ", ".join(["uid", *columns])
    placeholders = ", ".join(["?"] * (len(columns) + 1))
    conflict = (
        "DO UPDATE SET " + ", ".join(f"{c} = excluded.{c}" for c in columns)
        if columns
        else "DO NOTHING"
    )

    with transaction(root) as conn:
        conn.execute(
            f"INSERT INTO books ({col_list}) VALUES ({placeholders}) ON CONFLICT(uid) {conflict}",
            [uid, *fields.values()],
        )


def search_book_ids(root: Path, query: str, limit: int = 10) -> list[str]:
    """Ids of the best matches, best first. The client already holds the books."""
    q = str(query or "").lower().strip()
    if not q:
        return []

    scored = []
    for book in list_books(root):
        title_lower = book["title"].strip().lower()
        if not title_lower:
            continue

        author_lower = book["author"].strip().lower()
        genres_text = " ".join(str(g) for g in book["genres"])
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
