from __future__ import annotations

import difflib
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from ..utils import normalize_author, read_json, split_author_field


@dataclass(frozen=True)
class CatalogIndex:
    books: list[dict]
    by_uid: dict[str, dict]


def _catalog_path(root: Path) -> Path:
    return root / "backend" / "data" / "books.json"


@lru_cache(maxsize=8)
def _load_catalog_index(path_str: str, mtime: float) -> CatalogIndex:
    payload = read_json(Path(path_str), {})

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
    """Resolve a book by uid from the catalog."""
    book_id = str(book_id or "").strip()
    if not book_id:
        return None

    index = load_catalog_index(root)
    direct = index.by_uid.get(book_id)
    if direct:
        return dict(direct)

    return None


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
    query = normalize_author(author)
    if not query:
        return []

    index = load_catalog_index(root)
    matched = []
    seen: set[str] = set()

    for book in index.books:
        author_field = book.get("author", "")
        candidates = [(author_field)] + [
            normalize_author(part) for part in split_author_field(author_field)
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
