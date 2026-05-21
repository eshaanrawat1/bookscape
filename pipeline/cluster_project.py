from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA

from .common import RUNTIME_VECTOR, DATA_BUILD


def cluster_embeddings(embeddings: np.ndarray) -> np.ndarray:
    try:
        import hdbscan

        c = hdbscan.HDBSCAN(min_cluster_size=max(2, min(10, len(embeddings) // 2)))
        labels = c.fit_predict(embeddings)
    except Exception:
        k = max(2, min(6, len(embeddings) // 2))
        labels = KMeans(n_clusters=k, n_init="auto", random_state=42).fit_predict(embeddings)
    return labels.astype(int)


def reduce_to_3d(embeddings: np.ndarray) -> np.ndarray:
    try:
        import umap

        reducer = umap.UMAP(n_components=3, random_state=42)
        xyz = reducer.fit_transform(embeddings)
    except Exception:
        xyz = PCA(n_components=3, random_state=42).fit_transform(embeddings)
    return xyz.astype(np.float32)


def project_to_sphere(xyz: np.ndarray, radius: float = 1.0) -> np.ndarray:
    norms = np.linalg.norm(xyz, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return (xyz / norms) * radius


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--embeddings", default=str(RUNTIME_VECTOR / "embeddings.npy"))
    parser.add_argument("--out-dir", default=str(DATA_BUILD))
    parser.add_argument("--write-meta", action="store_true", help="Write cluster metadata JSON")
    args = parser.parse_args()

    embs = np.load(Path(args.embeddings))
    labels = cluster_embeddings(embs)
    xyz = reduce_to_3d(embs)
    sphere = project_to_sphere(xyz)

    out_dir = Path(args.out_dir)
    np.save(out_dir / "cluster_labels.npy", labels)
    np.save(out_dir / "points_xyz.npy", sphere)

    if args.write_meta:
        with (out_dir / "cluster_meta.json").open("w", encoding="utf-8") as f:
            json.dump({"cluster_count": int(len(set(labels.tolist())))}, f, indent=2)

    print(f"saved cluster labels + 3D points for {len(labels)} books")


if __name__ == "__main__":
    main()
