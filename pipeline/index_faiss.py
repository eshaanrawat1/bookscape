from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from .common import RUNTIME_VECTOR, DATA_BUILD


def build_index(embeddings: np.ndarray, out_dir: Path) -> str:
    try:
        import faiss

        dim = embeddings.shape[1]
        index = faiss.IndexFlatIP(dim)
        index.add(embeddings)
        faiss.write_index(index, str(out_dir / "books.faiss"))
        return "faiss"
    except Exception:
        # Keep runtime minimal; API can already do numpy fallback from embeddings.npy.
        return "numpy-fallback"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--embeddings", default=str(RUNTIME_VECTOR / "embeddings.npy"))
    parser.add_argument("--out-dir", default=str(RUNTIME_VECTOR))
    parser.add_argument("--meta-out-dir", default=str(DATA_BUILD))
    parser.add_argument("--write-meta", action="store_true", help="Write index metadata JSON")
    args = parser.parse_args()

    embs = np.load(Path(args.embeddings)).astype(np.float32)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    meta_out = Path(args.meta_out_dir)
    meta_out.mkdir(parents=True, exist_ok=True)
    method = build_index(embs, out_dir)

    if args.write_meta:
        with (meta_out / "index_meta.json").open("w", encoding="utf-8") as f:
            json.dump({"method": method, "count": int(embs.shape[0]), "dim": int(embs.shape[1])}, f, indent=2)

    print(f"index built using {method}")


if __name__ == "__main__":
    main()
