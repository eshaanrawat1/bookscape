from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from .common import ARTIFACTS, read_jsonl


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--books", required=True)
    parser.add_argument("--out", default=str(ARTIFACTS / "books_globe.json"))
    parser.add_argument("--out-manifest", default=str(ARTIFACTS / "manifest.json"))
    args = parser.parse_args()

    books = read_jsonl(Path(args.books))
    ids = np.load(ARTIFACTS / "book_ids.npy", allow_pickle=True).tolist()
    labels = np.load(ARTIFACTS / "cluster_labels.npy").tolist()
    xyz = np.load(ARTIFACTS / "points_xyz.npy").tolist()

    by_id = {b["id"]: b for b in books}
    points = []
    for i, book_id in enumerate(ids):
        b = by_id[book_id]
        points.append(
            {
                "id": b["id"],
                "title": b["title"],
                "author": b["author"],
                "description": b["description"],
                "genre": b["genre"],
                "book_pages": b.get("book_pages"),
                "book_rating": b.get("book_rating"),
                "book_rating_count": b.get("book_rating_count"),
                "book_review_count": b.get("book_review_count"),
                "image_url": b.get("image_url"),
                "cluster": int(labels[i]),
                "x": float(xyz[i][0]),
                "y": float(xyz[i][1]),
                "z": float(xyz[i][2]),
            }
        )

    with Path(args.out).open("w", encoding="utf-8") as f:
        json.dump({"points": points}, f, indent=2)

    with Path(args.out_manifest).open("w", encoding="utf-8") as f:
        json.dump(
            {
                "dataset": "books_v1",
                "points": len(points),
                "files": [
                    "embeddings.npy",
                    "book_ids.npy",
                    "cluster_labels.npy",
                    "points_xyz.npy",
                    "books_globe.json",
                ],
            },
            f,
            indent=2,
        )

    print(f"exported {len(points)} points to {args.out}")


if __name__ == "__main__":
    main()
