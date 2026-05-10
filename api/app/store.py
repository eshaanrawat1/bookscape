from __future__ import annotations

import difflib
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "artifacts"
RAW_DATA = ROOT / "data" / "raw"
USER_DATA = ROOT / "user_data"


class AtlasStore:
    def __init__(self) -> None:
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
        self._load()

    def reload(self) -> None:
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

        points_path = ARTIFACTS / "books_globe.json"
        if points_path.exists():
            with points_path.open("r", encoding="utf-8") as f:
                payload = json.load(f)
            self.points = payload.get("points", [])
            self._hydrate_point_metadata()
            self.point_by_id = {p["id"]: p for p in self.points}

        self.books_by_id = dict(self.point_by_id)
        obsidian_books_path = USER_DATA / "obsidian_books.json"
        if obsidian_books_path.exists():
            try:
                with obsidian_books_path.open("r", encoding="utf-8") as f:
                    obsidian_payload = json.load(f)
                books = (obsidian_payload or {}).get("books", {})
                if isinstance(books, dict):
                    for book_id, row in books.items():
                        if not book_id or not isinstance(row, dict):
                            continue
                        normalized = {
                            "id": str(book_id),
                            "title": row.get("title") or str(book_id),
                            "author": row.get("author") or "",
                            "description": row.get("description") or "",
                            "genre": (
                                row.get("genre")
                                or ((row.get("genres") or ["unknown"])[0] if isinstance(row.get("genres"), list) else (row.get("genres") or "unknown"))
                            ),
                            "genres": row.get("genres") if isinstance(row.get("genres"), list) else [],
                            "image_url": row.get("image_url") or "",
                            "book_rating": row.get("book_rating"),
                            "book_rating_count": row.get("book_rating_count"),
                            "book_review_count": row.get("book_review_count"),
                            "book_pages": row.get("total_pages") or 0,
                        }
                        self.books_by_id[str(book_id)] = normalized
            except Exception:
                pass

        self.catalog = list(self.books_by_id.values())
        self._build_point_indexes()

        ids_path = ARTIFACTS / "book_ids.npy"
        emb_path = ARTIFACTS / "embeddings.npy"
        if ids_path.exists() and emb_path.exists():
            self.ids = np.load(ids_path, allow_pickle=True).tolist()
            self.id_to_index = {book_id: i for i, book_id in enumerate(self.ids)}
            self.embeddings = np.load(emb_path).astype(np.float32)

        faiss_path = ARTIFACTS / "books.faiss"
        if faiss_path.exists():
            try:
                import faiss

                self.faiss_index = faiss.read_index(str(faiss_path))
            except Exception:
                self.faiss_index = None

    def has_data(self) -> bool:
        return bool(self.points)

    def _hydrate_point_metadata(self) -> None:
        if not self.points:
            return
        raw_path = RAW_DATA / "books_from_csv.jsonl"
        if not raw_path.exists():
            raw_path = RAW_DATA / "sample_books.jsonl"
        if not raw_path.exists():
            return

        extra_by_id: dict[str, dict] = {}
        with raw_path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                book_id = row.get("id")
                if not book_id:
                    continue
                extra_by_id[book_id] = row

        for p in self.points:
            src = extra_by_id.get(p.get("id"))
            if not src:
                continue
            p["book_rating"] = src.get("book_rating")
            p["book_rating_count"] = src.get("book_rating_count")
            p["book_review_count"] = src.get("book_review_count")
            p["book_pages"] = src.get("book_pages")

    def _build_point_indexes(self) -> None:
        self.clusters = {}
        self.search_docs = []
        self.points_cache = {}
        for p in self.points:
            self.clusters.setdefault(int(p["cluster"]), []).append(p)
        for p in self.catalog:
            title = p.get("title", "").lower()
            text = f"{title} {p.get('author', '')} {p.get('genre', '')} {p.get('description', '')}".lower()
            self.search_docs.append((title, text, p))

    @staticmethod
    def _sample_evenly(items: list[dict], target: int) -> list[dict]:
        if len(items) <= target:
            return items
        step = len(items) / target
        return [items[int(i * step)] for i in range(target)]

    def points_for_zoom(self, zoom: str, max_points: int = 12000) -> list[dict]:
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

    def get_book(self, book_id: str) -> dict | None:
        return self.books_by_id.get(book_id)

    def search(self, query: str, limit: int = 10) -> list[dict]:
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
        if not self.points:
            return None

        cluster_items = sorted(self.clusters.items(), key=lambda x: len(x[1]), reverse=True)
        selected = cluster_items[0][1] if cluster_items else self.points
        return selected[0] if selected else None
