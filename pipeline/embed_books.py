from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from .common import ARTIFACTS, read_jsonl, stable_hash_vector


def build_text_block(book: dict) -> str:
    return f"Title: {book['title']}\nAuthor: {book['author']}\nGenres: {book['genre']}\nDescription: {book['description']}"


def embed_with_transformer(texts: list[str]) -> np.ndarray:
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    embeddings = model.encode(texts, convert_to_numpy=True, normalize_embeddings=True)
    return embeddings.astype(np.float32)


def embed_with_hash(texts: list[str]) -> np.ndarray:
    return np.vstack([stable_hash_vector(t, dim=384) for t in texts]).astype(np.float32)


def generate_embeddings(books: list[dict]) -> tuple[np.ndarray, list[str], str]:
    texts = [build_text_block(b) for b in books]
    ids = [b["id"] for b in books]

    try:
        embs = embed_with_transformer(texts)
        method = "all-MiniLM-L6-v2"
    except Exception:
        embs = embed_with_hash(texts)
        method = "hash-fallback-384d"

    return embs, ids, method


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out-dir", default=str(ARTIFACTS))
    args = parser.parse_args()

    books = read_jsonl(Path(args.input))
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    embs, ids, method = generate_embeddings(books)
    np.save(out_dir / "embeddings.npy", embs)
    np.save(out_dir / "book_ids.npy", np.array(ids, dtype=object))

    with (out_dir / "embedding_meta.json").open("w", encoding="utf-8") as f:
        json.dump({"method": method, "dim": int(embs.shape[1]), "count": int(embs.shape[0])}, f, indent=2)

    print(f"saved embeddings count={len(ids)} method={method}")


if __name__ == "__main__":
    main()
