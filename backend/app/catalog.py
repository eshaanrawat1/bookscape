from __future__ import annotations

import difflib
import json
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True)
class CatalogIndex:
    books: list[dict]
    by_uid: dict[str, dict]


def _normalize_author(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^\w\s]", " ", text)
    return " ".join(text.lower().split())


def _split_author_field(value: object) -> list[str]:
    raw = str(value or "").strip()
    if not raw:
        return []
    parts = re.split(r"\s+(?:&|and|with|x)\s+|[;/]", raw, flags=re.IGNORECASE)
    return [p.strip() for p in parts if p.strip()] or [raw]


def _catalog_path(root: Path) -> Path:
    return root / "data" / "books.json"


def _load_json(path: Path) -> dict | list:
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, (dict, list)) else {}
    except Exception:
        return {}


@lru_cache(maxsize=16)
def _load_snapshot_books_cached(path_str: str, mtime: float) -> dict[str, dict]:
    payload = _load_json(Path(path_str))
    if not isinstance(payload, dict):
        return {}
    raw_books = payload.get("books", {})
    if not isinstance(raw_books, dict):
        return {}
    return {str(k): v for k, v in raw_books.items() if isinstance(v, dict)}


def _load_snapshot_books(root: Path) -> dict[str, dict]:
    books: dict[str, dict] = {}
    for name in ("all_books.json", "obsidian_books.json"):
        path = root / "user_data" / name
        mtime = path.stat().st_mtime if path.exists() else 0.0
        books.update(_load_snapshot_books_cached(str(path), mtime))
    return books


@lru_cache(maxsize=8)
def _load_catalog_index(path_str: str, mtime: float) -> CatalogIndex:
    payload = _load_json(Path(path_str))

    if isinstance(payload, dict):
        rows = list(payload.values())
    elif isinstance(payload, list):
        rows = payload
    else:
        rows = []

    books = [row for row in rows if isinstance(row, dict)]
    by_uid = {
        str(row["uid"]).strip(): row
        for row in books
        if str(row.get("uid") or "").strip()
    }

    return CatalogIndex(books=books, by_uid=by_uid)


def load_catalog_index(root: Path) -> CatalogIndex:
    path = _catalog_path(root)
    mtime = path.stat().st_mtime if path.exists() else 0.0
    return _load_catalog_index(str(path), mtime)


def has_data(root: Path) -> bool:
    return bool(load_catalog_index(root).books)


def resolve_book(root: Path, book_id: str) -> dict | None:
    """Resolve a book by uid only - checks catalog first, then snapshots."""
    book_id = str(book_id or "").strip()
    if not book_id:
        return None

    index = load_catalog_index(root)
    direct = index.by_uid.get(book_id)
    if direct:
        return dict(direct)

    snapshot = _load_snapshot_books(root).get(book_id)
    if isinstance(snapshot, dict):
        return dict(snapshot)

    return None


# Alias for backward compatibility - remove later
get_book = resolve_book


def get_book_with_similar(root: Path, book_id: str) -> dict | None:
    book = resolve_book(root, book_id)
    if not book:
        return None

    index = load_catalog_index(root)
    similar_ids = book.get("similar_book_ids") or []
    similar_books = [
        index.by_uid[str(sid)]
        for sid in similar_ids
        if str(sid) in index.by_uid
    ]

    result = dict(book)
    result["similar_books"] = similar_books
    return result


def search_books(root: Path, query: str, limit: int = 10) -> list[dict]:
    q = str(query or "").lower().strip()
    if not q:
        return []

    index = load_catalog_index(root)
    scored = []

    for point in index.books:
        title = str(point.get("title", "")).strip()
        title_lower = title.lower()
        if not title_lower:
            continue

        genres = point.get("genres", [])
        genres_text = " ".join(str(g) for g in genres) if isinstance(genres, list) else str(genres or "")
        text_lower = f"{title_lower} {point.get('author', '')} {point.get('genre', '')} {genres_text} {point.get('description', '')}".lower()

        if title_lower.startswith(q):
            lex_score = 5
        elif q in title_lower:
            lex_score = 4
        elif q in text_lower:
            lex_score = 2
        else:
            lex_score = 0

        sim = difflib.SequenceMatcher(None, q, title_lower[: max(len(q), 24)]).ratio()
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
    index = load_catalog_index(root)
    all_books = index.books
    if not all_books:
        return []

    top_genres = ["Romantasy", "Romance", "Fantasy", "Dark Academia", "Contemporary", "Fiction", "High Fantasy", "Mystery"]
    top_genres_set = set(top_genres)

    # Single-pass grouping by genre
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
        mapped = [
            {
                "id": b.get("uid", ""),
                "title": b.get("title", "Untitled"),
                "author": b.get("author", ""),
                "cover": b.get("image_url", ""),
                "color": b.get("color", ""),
                "tint": "220 30% 45%",
                "genre": genre,
                "genres": b.get("genres", []),
                "avg_rating": b.get("avg_rating", 0),
                "rating_count": b.get("rating_count", 0),
                "review_count": b.get("review_count", 0),
                "book_rating": b.get("avg_rating", 0),
                "description": b.get("description", ""),
                "total_pages": b.get("page_count", 0),
                "status": "not_started",
            }
            for b in genre_books[:30]
        ]
        library.append({"genre": genre, "books": mapped})

    return library


def get_books_by_author(root: Path, author: str) -> list[dict]:
    query = _normalize_author(author)
    if not query:
        return []

    index = load_catalog_index(root)
    matched = []
    seen: set[str] = set()

    for book in index.books:
        author_field = book.get("author", "")
        candidates = [_normalize_author(author_field)] + [
            _normalize_author(part) for part in _split_author_field(author_field)
        ]
        if any(c and (c == query or c in query or query in c) for c in candidates):
            book_uid = str(book.get("uid") or "").strip()
            if book_uid and book_uid not in seen:
                seen.add(book_uid)
                matched.append(book)

    matched.sort(key=lambda item: (str(item.get("title") or "").lower(), str(item.get("uid") or "")))
    return matched


def get_books_by_genre(root: Path, genre: str, limit: int = 100) -> list[dict]:
    query = str(genre or "").strip()
    if not query:
        return []

    index = load_catalog_index(root)
    matched = []
    seen: set[str] = set()

    for book in index.books:
        book_genres = book.get("genres", [])
        if not isinstance(book_genres, list):
            book_genres = [book_genres]

        if any(str(g or "").strip() == query for g in book_genres):
            book_uid = str(book.get("uid") or "").strip()
            if book_uid and book_uid not in seen:
                seen.add(book_uid)
                matched.append(book)
                if len(matched) >= limit:
                    break

    matched.sort(key=lambda item: int(item.get("rating_count", 0) or 0), reverse=True)
    return matched