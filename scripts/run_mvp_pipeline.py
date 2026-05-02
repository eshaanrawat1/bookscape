from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(cmd: list[str]) -> None:
    print(" ".join(cmd))
    subprocess.run(cmd, check=True, cwd=ROOT)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--use-sample", action="store_true")
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()

    if args.use_sample:
        input_path = ROOT / "data" / "raw" / "sample_books.jsonl"
    else:
        run([sys.executable, "-m", "pipeline.ingest_openlibrary", "--limit", str(args.limit)])
        input_path = ROOT / "data" / "raw" / "openlibrary_books.jsonl"

    clean_path = ROOT / "data" / "processed" / "books_clean.jsonl"

    run([sys.executable, "-m", "pipeline.preprocess_books", "--input", str(input_path), "--out", str(clean_path)])
    run([sys.executable, "-m", "pipeline.embed_books", "--input", str(clean_path)])
    run([sys.executable, "-m", "pipeline.cluster_project"])
    run([sys.executable, "-m", "pipeline.index_faiss"])
    run([sys.executable, "-m", "pipeline.export_artifacts", "--books", str(clean_path)])

    print("Pipeline complete. Artifacts ready in /artifacts")


if __name__ == "__main__":
    main()
