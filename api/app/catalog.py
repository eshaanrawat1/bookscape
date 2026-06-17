from __future__ import annotations

import difflib
import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True)
class CatalogIndex:
    books: list[dict]
    by_uid: dict[str, dict]
    by_title_author: dict[tuple[str, str], dict]
    by_title: dict[str, list[dict]]


def _normalize_text(value: object) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _catalog_path(root: Path) -> Path:
    return root / "data" / "books.json"


@lru_cache(maxsize=8)
def _load_catalog_index(path_str: str, mtime: float) -> CatalogIndex:
    path = Path(path_str)
    if not path.exists():
        return CatalogIndex([], {}, {}, {})

    try:
        with path.open("r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception:
        return CatalogIndex([], {}, {}, {})

    if isinstance(payload, dict):
        rows = list(payload.values())
    elif isinstance(payload, list):
        rows = payload
    else:
        rows = []

    books = [row for row in rows if isinstance(row, dict)]
    by_uid: dict[str, dict] = {}
    by_title_author: dict[tuple[str, str], dict] = {}
    by_title: dict[str, list[dict]] = {}

    for row in books:
        uid = str(row.get("uid") or "").strip()
        if not uid:
            continue
        by_uid[uid] = row
        title_key = _normalize_text(row.get("title"))
        author_key = _normalize_text(row.get("author"))
        if title_key and author_key:
            by_title_author[(title_key, author_key)] = row
        if title_key:
            by_title.setdefault(title_key, []).append(row)

    return CatalogIndex(books, by_uid, by_title_author, by_title)


def load_catalog_index(root: Path) -> CatalogIndex:
    path = _catalog_path(root)
    try:
        mtime = float(path.stat().st_mtime)
    except Exception:
        mtime = 0.0
    return _load_catalog_index(str(path), mtime)


def has_data(root: Path) -> bool:
    return bool(load_catalog_index(root).books)


def get_book(root: Path, book_id: str) -> dict | None:
    book_id = str(book_id or "").strip()
    if not book_id:
        return None
    return load_catalog_index(root).by_uid.get(book_id)


def get_book_payload(root: Path, book_id: str) -> dict | None:
    book = get_book(root, book_id)
    if not book:
        return None

    index = load_catalog_index(root)
    similar_books = []
    for sid in book.get("similar_book_ids", []) or []:
        similar = index.by_uid.get(str(sid))
        if not similar:
            continue
        similar_books.append({**similar, "catalog_uid": str(similar.get("catalog_uid") or similar.get("uid") or "")})

    result = dict(book)
    result["catalog_uid"] = str(book.get("catalog_uid") or book.get("uid") or "")
    result["similar_books"] = similar_books
    return result


def search_books(root: Path, query: str, limit: int = 10) -> list[dict]:
    index = load_catalog_index(root)
    q = str(query or "").lower().strip()
    if not q:
        return []

    scored = []
    for point in index.books:
        title_lower = str(point.get("title", "")).lower().strip()
        if not title_lower:
            continue
        genres = point.get("genres", [])
        genres_text = " ".join(str(g) for g in genres) if isinstance(genres, list) else str(genres or "")
        text_lower = f"{title_lower} {point.get('author', '')} {point.get('genre', '')} {genres_text} {point.get('description', '')}".lower()
        lex_score = 0
        if title_lower.startswith(q):
            lex_score = 5
        elif q in title_lower:
            lex_score = 4
        elif q in text_lower:
            lex_score = 2
        sim = difflib.SequenceMatcher(None, q, title_lower[: max(len(q), 24)]).ratio()
        fuzzy_score = 2 if sim >= 0.78 else 1 if sim >= 0.66 else 0
        scored.append((lex_score + fuzzy_score, sim, point))

    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    out = []
    seen = set()
    for score, _, point in scored:
        if score <= 0:
            continue
        key = point.get("uid") or f"{point.get('title', '')}::{point.get('author', '')}"
        if key in seen:
            continue
        seen.add(key)
        out.append(point)
        if len(out) >= limit:
            break
    return out


def suggest_titles(root: Path, query: str, limit: int = 8) -> list[str]:
    index = load_catalog_index(root)
    q = str(query or "").lower().strip()
    if not q:
        return []

    titles = [str(book.get("title", "")).strip() for book in index.books if book.get("title")]
    prefix = [title for title in titles if title.lower().startswith(q)]
    contains = [title for title in titles if q in title.lower() and not title.lower().startswith(q)]
    fuzzy = difflib.get_close_matches(query, titles, n=limit * 2, cutoff=0.6)

    merged = []
    seen = set()
    for title in [*prefix, *contains, *fuzzy]:
        key = title.lower()
        if key in seen:
            continue
        seen.add(key)
        merged.append(title)
        if len(merged) >= limit:
            break
    return merged


def get_global_library(root: Path) -> list[dict]:
    index = load_catalog_index(root)
    all_books = index.books
    if not all_books:
        return []

    exclude = {"...more", "audiobook", "book club", "adult", "fiction", "nonfiction", "novels", "literature"}
    genre_counts: dict[str, int] = {}
    for book in all_books:
        for genre in book.get("genres", []):
            genre_name = str(genre or "").strip()
            if not genre_name:
                continue
            if genre_name.lower() in exclude:
                continue
            genre_counts[genre_name] = genre_counts.get(genre_name, 0) + 1

    top_genres = sorted(genre_counts.items(), key=lambda x: x[1], reverse=True)[:5]
    library = []
    for genre, _count in top_genres:
        genre_books = [book for book in all_books if genre in (book.get("genres", []) or [])]
        genre_books.sort(key=lambda x: int(x.get("rating_count", 0) or 0), reverse=True)
        mapped = []
        for book in genre_books[:30]:
            mapped.append({
                "id": book.get("uid", ""),
                "catalog_uid": book.get("uid", ""),
                "title": book.get("title", "Untitled"),
                "author": book.get("author", ""),
                "cover": book.get("image_url", ""),
                "color": book.get("color", ""),
                "tint": "220 30% 45%",
                "genre": genre,
                "genres": book.get("genres", []),
                "avg_rating": book.get("avg_rating", 0),
                "rating_count": book.get("rating_count", 0),
                "review_count": book.get("review_count", 0),
                "book_rating": book.get("avg_rating", 0),
                "description": book.get("description", ""),
                "total_pages": book.get("page_count", 0),
                "status": "not_started",
            })
        library.append({"genre": genre, "books": mapped})
    return library


def recommend_books(root: Path, book_id: str, limit: int = 5) -> list[dict]:
    index = load_catalog_index(root)
    book = index.by_uid.get(str(book_id or "").strip())
    if not book:
        return []

    out = []
    for sid in book.get("similar_book_ids", []) or []:
        similar = index.by_uid.get(str(sid))
        if not similar:
            continue
        out.append(similar)
        if len(out) >= limit:
            break
    return out
