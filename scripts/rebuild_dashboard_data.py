#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(cmd: list[str]) -> None:
    print("$", " ".join(cmd))
    subprocess.run(cmd, check=True, cwd=ROOT)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="One-command rebuild for Atlas dashboard artifacts from a JSONL books file."
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path to prepared JSONL (e.g. data/raw/books_from_csv.jsonl)",
    )
    parser.add_argument(
        "--clean-out",
        default="data/processed/books_clean.jsonl",
        help="Path for cleaned JSONL output",
    )
    args = parser.parse_args()

    input_path = (ROOT / args.input).resolve() if not Path(args.input).is_absolute() else Path(args.input)
    clean_out = (ROOT / args.clean_out).resolve() if not Path(args.clean_out).is_absolute() else Path(args.clean_out)

    if not input_path.exists():
        raise FileNotFoundError(f"Input JSONL not found: {input_path}")

    run([sys.executable, "-m", "pipeline.preprocess_books", "--input", str(input_path), "--out", str(clean_out)])
    run([sys.executable, "-m", "pipeline.embed_books", "--input", str(clean_out)])
    run([sys.executable, "-m", "pipeline.cluster_project"])
    run([sys.executable, "-m", "pipeline.index_faiss"])
    run([sys.executable, "-m", "pipeline.export_artifacts", "--books", str(clean_out)])

    print("\nRebuild complete.")
    print("Next:")
    print("1) Restart API (uvicorn api.app.main:app --reload --port 8000)")
    print("2) Refresh frontend page")


if __name__ == "__main__":
    main()
