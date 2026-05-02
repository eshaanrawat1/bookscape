from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from .common import ARTIFACTS


def build_index(embeddings: np.ndarray, out_dir: Path) -> str:
    try:
        import faiss

        dim = embeddings.shape[1]
        index = faiss.IndexFlatIP(dim)
        index.add(embeddings)
        faiss.write_index(index, str(out_dir / "books.faiss"))
        return "faiss"
    except Exception:
        np.save(out_dir / "embeddings_for_search.npy", embeddings)
        return "numpy-fallback"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--embeddings", default=str(ARTIFACTS / "embeddings.npy"))
    parser.add_argument("--out-dir", default=str(ARTIFACTS))
    args = parser.parse_args()

    embs = np.load(Path(args.embeddings)).astype(np.float32)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    method = build_index(embs, out_dir)

    with (out_dir / "index_meta.json").open("w", encoding="utf-8") as f:
        json.dump({"method": method, "count": int(embs.shape[0]), "dim": int(embs.shape[1])}, f, indent=2)

    print(f"index built using {method}")


if __name__ == "__main__":
    main()
