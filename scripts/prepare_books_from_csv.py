#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from pathlib import Path
from typing import Dict

REQUIRED_COLUMNS = [
    "book_authors",
    "book_desc",
    "book_pages",
    "book_rating",
    "book_rating_count",
    "book_review_count",
    "book_title",
    "genres",
    "image_url",
]


def clean_text(value: str) -> str:
    return " ".join((value or "").strip().split())


def to_int(value: str) -> int | None:
    value = (value or "").strip().replace(",", "")
    if not value:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", value)
    if match:
        value = match.group(0)
    try:
        return int(float(value))
    except ValueError:
        return None


def to_float(value: str) -> float | None:
    value = (value or "").strip().replace(",", "")
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def stable_book_id(title: str, authors: str) -> str:
    base = f"{title.lower()}|{authors.lower()}"
    return "CSV-" + hashlib.md5(base.encode("utf-8")).hexdigest()[:12]


def build_record(row: Dict[str, str]) -> dict | None:
    title = clean_text(row.get("book_title", ""))
    author = clean_text(row.get("book_authors", ""))
    desc = clean_text(row.get("book_desc", ""))
    genres = clean_text(row.get("genres", ""))

    # Keep embedder quality reasonable for MVP.
    if not title or not author or len(desc) < 20:
        return None

    return {
        # Keep top-level fields compatible with current pipeline style.
        "id": stable_book_id(title, author),
        "title": title,
        "author": author,
        "description": desc,
        "genres": genres,
        # Keep these for downstream filtering/ranking if needed.
        "book_pages": to_int(row.get("book_pages", "")),
        "book_rating": to_float(row.get("book_rating", "")),
        "book_rating_count": to_int(row.get("book_rating_count", "")),
        "book_review_count": to_int(row.get("book_review_count", "")),
        "image_url": clean_text(row.get("image_url", "")) or None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract required book columns from a CSV and write embedder-ready JSONL."
    )
    parser.add_argument("input_csv", help="Path to input CSV file")
    parser.add_argument("output_jsonl", help="Path to output JSONL file")
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional max records to write (0 = no limit)",
    )
    parser.add_argument(
        "--allow-missing-columns",
        action="store_true",
        help="Proceed even if some required columns are missing",
    )
    args = parser.parse_args()

    input_path = Path(args.input_csv)
    output_path = Path(args.output_jsonl)

    if not input_path.exists():
        raise FileNotFoundError(f"Input CSV not found: {input_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)

    total_rows = 0
    kept_rows = 0
    dropped_rows = 0

    with input_path.open("r", encoding="utf-8", errors="replace", newline="") as src:
        reader = csv.DictReader(src)
        fieldnames = reader.fieldnames or []

        missing = [c for c in REQUIRED_COLUMNS if c not in fieldnames]
        if missing and not args.allow_missing_columns:
            raise ValueError(
                "Missing required columns: "
                + ", ".join(missing)
                + "\nUse --allow-missing-columns to continue."
            )

        with output_path.open("w", encoding="utf-8") as out:
            for row in reader:
                total_rows += 1
                record = build_record(row)
                if record is None:
                    dropped_rows += 1
                    continue

                out.write(json.dumps(record, ensure_ascii=True) + "\n")
                kept_rows += 1

                if args.limit > 0 and kept_rows >= args.limit:
                    break

    print(f"Input rows:   {total_rows}")
    print(f"Written rows: {kept_rows}")
    print(f"Dropped rows: {dropped_rows}")
    print(f"Output:       {output_path}")


if __name__ == "__main__":
    main()
