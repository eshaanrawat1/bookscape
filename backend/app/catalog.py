from __future__ import annotations

import difflib
import hashlib
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
    by_title_author: dict[tuple[str, str], dict]
    by_title: dict[str, list[dict]]


def _normalize_text(value: object) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _normalize_author_text(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[\[\]\(\)]", " ", text)
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    return " ".join(text.lower().split())


def _split_author_field(value: object) -> list[str]:
    raw = str(value or "").strip()
    if not raw:
        return []
    parts = re.split(r"\s+(?:&|and|with|x)\s+|[;/]", raw, flags=re.IGNORECASE)
    cleaned = [part.strip() for part in parts if str(part or "").strip()]
    return cleaned or [raw]


def _catalog_path(root: Path) -> Path:
    return root / "data" / "books.json"


def _snapshot_path(root: Path, name: str) -> Path:
    return root / "user_data" / name


def _load_json_dict(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as f:
            payload = json.load(f)
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _load_snapshot_books(root: Path) -> dict[str, dict]:
    books: dict[str, dict] = {}
    for name in ("all_books.json", "obsidian_books.json"):
        payload = _load_json_dict(_snapshot_path(root, name))
        snapshot_books = payload.get("books", {})
        if not isinstance(snapshot_books, dict):
            continue
        for book_id, row in snapshot_books.items():
            if isinstance(row, dict):
                books[str(book_id)] = row
    return books


@lru_cache(maxsize=8)
def _load_catalog_index(path_str: str, mtime: float) -> CatalogIndex:
    path = Path(path_str)
    if not path.exists():
        return CatalogIndex([], {}, {}, [])

    try:
        with path.open("r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception:
        return CatalogIndex([], {}, {}, [])

    if isinstance(payload, dict):
        rows = list(payload.values())
    elif isinstance(payload, list):
        rows = payload
    else:
        rows = []

    books = [row for row in rows if isinstance(row, dict)]
    by_uid: dict[str, dict] = {}
    by_title_author: dict[tuple[str, str], dict] = {}
    by_title: dict[str, list[dict]] = []

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
    return resolve_book(root, book_id)


def resolve_book(root: Path, book_id: str) -> dict | None:
    """Resolve a book by uid only - checks catalog first, then snapshots."""
    book_id = str(book_id or "").strip()
    if not book_id:
        return None
    
    index = load_catalog_index(root)
    direct = index.by_uid.get(book_id)
    if direct:
        return dict(direct)
    
    snapshots = _load_snapshot_books(root)
    snapshot = snapshots.get(book_id)
    if isinstance(snapshot, dict):
        return dict(snapshot)
    
    return None


def get_book_payload(root: Path, book_id: str) -> dict | None:
    book = resolve_book(root, book_id)
    if not book:
        return None

    index = load_catalog_index(root)
    similar_books = []
    for sid in book.get("similar_book_ids", []) or []:
        similar = index.by_uid.get(str(sid))
        if similar:
            similar_books.append(similar)

    result = dict(book)
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
        
    top_genres = ["Romantasy", "Romance", "Fantasy", "Dark Academia", "Contemporary", "Fiction", "High Fantasy", "Mystery"]

    library = []
    for genre in top_genres:
        genre_books = [book for book in all_books if genre in (book.get("genres", []) or [])]
        genre_books.sort(key=lambda x: int(x.get("rating_count", 0) or 0), reverse=True)
        mapped = []
        for book in genre_books[:30]:
            mapped.append({
                "id": book.get("uid", ""),
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


def get_books_by_author(root: Path, author: str) -> list[dict]:
    index = load_catalog_index(root)
    query = _normalize_author_text(author)
    if not query:
        return []

    matched = []
    seen: set[str] = set()
    for book in index.books:
        author_field = book.get("author", "")
        author_candidates = [_normalize_author_text(author_field)]
        author_candidates.extend(_normalize_author_text(part) for part in _split_author_field(author_field))
        if any(
            candidate and (
                candidate == query
                or candidate in query
                or query in candidate
            )
            for candidate in author_candidates
        ):
            book_uid = str(book.get("uid") or "").strip()
            if not book_uid or book_uid in seen:
                continue
            seen.add(book_uid)
            matched.append(book)

    matched.sort(key=lambda item: (str(item.get("title") or "").lower(), str(item.get("uid") or "")))
    return matched


def get_books_by_genre(root: Path, genre: str, limit: int = 100) -> list[dict]:
    index = load_catalog_index(root)
    query = str(genre or "").strip()
    if not query:
        return []

    matched = []
    seen: set[str] = set()
    for book in index.books:
        book_genres = book.get("genres", [])
        if not isinstance(book_genres, list):
            book_genres = [book_genres]
        
        if any(str(g or "").strip() == query for g in book_genres):
            book_uid = str(book.get("uid") or "").strip()
            if not book_uid or book_uid in seen:
                continue
            seen.add(book_uid)
            matched.append(book)
            if len(matched) >= limit:
                break

    matched.sort(key=lambda item: int(item.get("rating_count", 0) or 0), reverse=True)
    return matched
