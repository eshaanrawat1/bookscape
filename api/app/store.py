from __future__ import annotations

import difflib
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
BOOKS_PATH = ROOT / "data" / "books.json"
RUNTIME_CATALOG = ROOT / "data" / "runtime" / "catalog"
RUNTIME_VECTOR = ROOT / "data" / "runtime" / "vector"


class AtlasStore:
    def __init__(self) -> None:
        self._artifact_stamp: tuple[float, float, float] = (0.0, 0.0, 0.0)
        self.points: list[dict] = []
        self.point_by_id: dict[str, dict] = {}
        self.books_by_id: dict[str, dict] = {}
        self.catalog: list[dict] = []
        self.id_to_index: dict[str, int] = {}
        self.search_docs: list[tuple[str, str, dict]] = []
        self.points_cache: dict[tuple[str, int], list[dict]] = {}
        self.clusters: dict[int, list[dict]] = {}
        self.ids: list[str] = []
        self.embeddings: np.ndarray | None = None
        self.faiss_index = None
        self._global_library_cache: list[dict] | None = None
        self._all_books_cache: dict[str, dict] | None = None
        self._catalog_title_author_index: dict[tuple[str, str], dict] = {}
        self._load()

    def reload(self) -> None:
        self._load()

    @staticmethod
    def _mtime_or_zero(path: Path) -> float:
        try:
            return float(path.stat().st_mtime)
        except Exception:
            return 0.0

    @staticmethod
    def _normalize_text(value: object) -> str:
        return " ".join(str(value or "").strip().lower().split())

    def _current_artifact_stamp(self) -> tuple[float, float, float, float]:
        return (
            self._mtime_or_zero(BOOKS_PATH),
            self._mtime_or_zero(RUNTIME_CATALOG / "books_globe.json"),
            self._mtime_or_zero(RUNTIME_VECTOR / "book_ids.npy"),
            self._mtime_or_zero(RUNTIME_VECTOR / "embeddings.npy"),
        )

    def _maybe_reload(self) -> None:
        stamp = self._current_artifact_stamp()
        if stamp != self._artifact_stamp:
            self._load()

    def _load(self) -> None:
        self.points = []
        self.point_by_id = {}
        self.books_by_id = {}
        self.catalog = []
        self.search_docs = []
        self.points_cache = {}
        self.clusters = {}
        self.ids = []
        self.id_to_index = {}
        self.embeddings = None
        self.faiss_index = None
        self._global_library_cache = None
        self._all_books_cache = None
        self._catalog_title_author_index = {}

        books_catalog = self._load_books_catalog()
        self.catalog = list(books_catalog)
        self._all_books_cache = {
            str(book.get("uid")): book
            for book in self.catalog
            if isinstance(book, dict) and book.get("uid")
        }
        self._catalog_title_author_index = {
            (self._normalize_text(book.get("title")), self._normalize_text(book.get("author"))): book
            for book in self.catalog
            if isinstance(book, dict) and book.get("title") and book.get("author")
        }
        self._build_search_indexes()

        points_path = RUNTIME_CATALOG / "books_globe.json"
        if points_path.exists():
            with points_path.open("r", encoding="utf-8") as f:
                payload = json.load(f)
            self.points = payload.get("points", [])
            self.point_by_id = {p["id"]: p for p in self.points}

        self.books_by_id = dict(self.point_by_id)
        self._build_point_indexes()

        ids_path = RUNTIME_VECTOR / "book_ids.npy"
        emb_path = RUNTIME_VECTOR / "embeddings.npy"
        if ids_path.exists() and emb_path.exists():
            self.ids = np.load(ids_path, allow_pickle=True).tolist()
            self.id_to_index = {book_id: i for i, book_id in enumerate(self.ids)}
            self.embeddings = np.load(emb_path).astype(np.float32)

        faiss_path = RUNTIME_VECTOR / "books.faiss"
        if faiss_path.exists():
            try:
                import faiss

                self.faiss_index = faiss.read_index(str(faiss_path))
            except Exception:
                self.faiss_index = None
        self._artifact_stamp = self._current_artifact_stamp()

    def has_data(self) -> bool:
        self._maybe_reload()
        return bool(self.catalog)

    def _build_point_indexes(self) -> None:
        self.clusters = {}
        self.points_cache = {}
        for p in self.points:
            self.clusters.setdefault(int(p["cluster"]), []).append(p)

    def _load_books_catalog(self) -> list[dict]:
        if not BOOKS_PATH.exists():
            return []
        try:
            with BOOKS_PATH.open("r", encoding="utf-8") as f:
                payload = json.load(f)
        except Exception:
            return []

        if isinstance(payload, dict):
            payload = list(payload.values())
        if not isinstance(payload, list):
            return []
        return [row for row in payload if isinstance(row, dict)]

    def _add_search_doc(self, point: dict, seen: set[str]) -> None:
        title = str(point.get("title", "")).lower().strip()
        if not title:
            return
        genres = point.get("genres", [])
        genres_text = " ".join(str(g) for g in genres) if isinstance(genres, list) else str(genres or "")
        text = f"{title} {point.get('author', '')} {point.get('genre', '')} {genres_text} {point.get('description', '')}".lower()
        key = str(point.get("id") or point.get("uid") or f"{title}::{point.get('author', '')}").strip()
        if key in seen:
            return
        seen.add(key)
        self.search_docs.append((title, text, point))

    def _build_search_indexes(self) -> None:
        self.search_docs = []
        seen: set[str] = set()
        for p in self.catalog:
            self._add_search_doc(p, seen)

    @staticmethod
    def _sample_evenly(items: list[dict], target: int) -> list[dict]:
        if len(items) <= target:
            return items
        step = len(items) / target
        return [items[int(i * step)] for i in range(target)]

    def points_for_zoom(self, zoom: str, max_points: int = 12000) -> list[dict]:
        self._maybe_reload()
        cache_key = (zoom, max_points)
        if cache_key in self.points_cache:
            return self.points_cache[cache_key]

        if zoom == "near":
            out = self._sample_evenly(self.points, max_points)
            self.points_cache[cache_key] = out
            return out

        if zoom == "far":
            centroids: list[dict] = []
            for cluster_id, items in self.clusters.items():
                arr = np.array([[it["x"], it["y"], it["z"]] for it in items], dtype=np.float32)
                centroid = arr.mean(axis=0)
                sample = items[0]
                centroids.append(
                    {
                        **sample,
                        "id": f"cluster-{cluster_id}",
                        "title": f"Cluster {cluster_id}",
                        "author": f"{len(items)} books",
                        "x": float(centroid[0]),
                        "y": float(centroid[1]),
                        "z": float(centroid[2]),
                        "is_cluster": True,
                    }
                )
            out = self._sample_evenly(centroids, max_points)
            self.points_cache[cache_key] = out
            return out

        # mid zoom: keep large clusters dense and small clusters visible.
        mid_points: list[dict] = []
        for _, items in self.clusters.items():
            n = len(items)
            take = max(1, min(n, int(np.sqrt(n) * 2)))
            step = max(1, n // take)
            mid_points.extend(items[::step][:take])
        out = self._sample_evenly(mid_points, max_points)
        self.points_cache[cache_key] = out
        return out

    def _ensure_all_books(self) -> None:
        if self._all_books_cache is not None:
            return

        if self.catalog:
            self._all_books_cache = {
                str(book.get("uid")): book
                for book in self.catalog
                if isinstance(book, dict) and book.get("uid")
            }
            if not self._catalog_title_author_index:
                self._catalog_title_author_index = {
                    (self._normalize_text(book.get("title")), self._normalize_text(book.get("author"))): book
                    for book in self.catalog
                    if isinstance(book, dict) and book.get("title") and book.get("author")
                }
            return

        books_file = ROOT / "data" / "books.json"
        if not books_file.exists():
            self._all_books_cache = {}
            return

        with books_file.open("r", encoding="utf-8") as f:
            all_books = json.load(f)
            if isinstance(all_books, dict):
                all_books = list(all_books.values())

        self._all_books_cache = {str(b.get("uid")): b for b in all_books if isinstance(b, dict)}
        self._catalog_title_author_index = {
            (self._normalize_text(book.get("title")), self._normalize_text(book.get("author"))): book
            for book in all_books
            if isinstance(book, dict) and book.get("title") and book.get("author")
        }

    def find_book_by_title_author(self, title: object, author: object) -> dict | None:
        self._maybe_reload()
        key = (self._normalize_text(title), self._normalize_text(author))
        if not key[0] or not key[1]:
            return None
        return self._catalog_title_author_index.get(key)

    def get_book(self, book_id: str) -> dict | None:
        self._maybe_reload()
        self._ensure_all_books()

        book = self._all_books_cache.get(book_id)
        if not book:
            return self.books_by_id.get(book_id)

        # Resolve similar books instantly.
        similar_ids = book.get("similar_book_ids", [])
        similar_books = []
        for sid in similar_ids:
            similar = self._all_books_cache.get(sid)
            if not similar:
                continue
            similar_books.append({**similar, "catalog_uid": str(similar.get("catalog_uid") or similar.get("uid") or "")})

        # Return a copy with similar_books populated.
        result = dict(book)
        result["catalog_uid"] = str(book.get("catalog_uid") or book.get("uid") or "")
        result["similar_books"] = similar_books
        return result

    def search(self, query: str, limit: int = 10) -> list[dict]:
        self._maybe_reload()
        q = query.lower().strip()
        if not q:
            return []
        scored = []
        for title_lower, text_lower, point in self.search_docs:
            lex_score = 0
            if title_lower.startswith(q):
                lex_score = 5
            elif q in title_lower:
                lex_score = 4
            elif q in text_lower:
                lex_score = 2
            sim = difflib.SequenceMatcher(None, q, title_lower[: max(len(q), 24)]).ratio()
            fuzzy_score = 2 if sim >= 0.78 else 1 if sim >= 0.66 else 0
            score = lex_score + fuzzy_score
            scored.append((score, sim, point))
        scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
        out = []
        seen = set()
        for s, _, p in scored:
            if s <= 0:
                continue
            key = p.get("id") or f"{p.get('title','')}::{p.get('author','')}"
            if key in seen:
                continue
            seen.add(key)
            out.append(p)
            if len(out) >= limit:
                break
        return out

    def suggest_titles(self, query: str, limit: int = 8) -> list[str]:
        self._maybe_reload()
        q = query.lower().strip()
        if not q:
            return []
        title_set = {p.get("title", "").strip() for p in self.catalog if p.get("title")}
        titles = [t for t in title_set if t]
        prefix = [t for t in titles if t.lower().startswith(q)]
        contains = [t for t in titles if q in t.lower() and not t.lower().startswith(q)]
        fuzzy = difflib.get_close_matches(query, titles, n=limit * 2, cutoff=0.6)
        merged = []
        seen = set()
        for row in [*prefix, *contains, *fuzzy]:
            k = row.lower()
            if k in seen:
                continue
            seen.add(k)
            merged.append(row)
            if len(merged) >= limit:
                break
        return merged

    def recommend(self, book_id: str, limit: int = 5) -> list[dict]:
        self._maybe_reload()
        if self.embeddings is None or book_id not in self.id_to_index:
            return []

        idx = self.id_to_index[book_id]
        q = self.embeddings[idx : idx + 1]

        if self.faiss_index is not None:
            sims, inds = self.faiss_index.search(q, min(limit + 1, len(self.ids)))
            neighbors = [self.ids[i] for i in inds[0] if i >= 0 and self.ids[i] != book_id][:limit]
        else:
            sims = self.embeddings @ q.T
            order = np.argsort(-sims.squeeze())
            neighbors = [self.ids[i] for i in order if self.ids[i] != book_id][:limit]

        return [self.point_by_id[n] for n in neighbors if n in self.point_by_id]

    def random_cluster_point(self) -> dict | None:
        self._maybe_reload()
        if not self.points:
            return None

        cluster_items = sorted(self.clusters.items(), key=lambda x: len(x[1]), reverse=True)
        selected = cluster_items[0][1] if cluster_items else self.points
        return selected[0] if selected else None

    def get_global_library(self) -> list[dict]:
        self._maybe_reload()
        if self._global_library_cache is not None:
            return self._global_library_cache

        self._ensure_all_books()
        if not self._all_books_cache:
            return []

        all_books = list(self._all_books_cache.values())

        # Exclude unhelpful/broad genres
        exclude = {"...more", "audiobook", "book club", "adult", "fiction", "nonfiction", "novels", "literature"}
        
        genre_counts = {}
        for b in all_books:
            for g in b.get("genres", []):
                g_lower = g.lower()
                if g_lower not in exclude:
                    genre_counts[g] = genre_counts.get(g, 0) + 1
                    
        # Top 5 genres
        top_genres = sorted(genre_counts.items(), key=lambda x: x[1], reverse=True)[:5]
        top_genre_names = [g[0] for g in top_genres]
        
        library = []
        for genre in top_genre_names:
            genre_books = [b for b in all_books if genre in b.get("genres", [])]
            # Sort by popularity (rating_count)
            genre_books.sort(key=lambda x: int(x.get("rating_count", 0)), reverse=True)
            top_30 = genre_books[:30]
            
            # Map to expected UI format
            mapped = []
            for b in top_30:
                mapped.append({
                    "id": b.get("uid", ""),
                    "catalog_uid": b.get("uid", ""),
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
                    "status": "not_started"
                })
            library.append({
                "genre": genre,
                "books": mapped
            })
            
        self._global_library_cache = library
        return library
