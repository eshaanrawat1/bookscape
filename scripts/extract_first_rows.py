#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path


def extract_first_rows(input_path: Path, output_path: Path, limit: int) -> int:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    written = 0
    with input_path.open("r", encoding="utf-8", errors="replace") as src, output_path.open(
        "w", encoding="utf-8"
    ) as dst:
        for line in src:
            dst.write(line)
            written += 1
            if written >= limit:
                break

    return written


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Write the first N lines from a text file to a new file."
    )
    parser.add_argument("input", help="Path to the source .txt file")
    parser.add_argument("output", help="Path to the output file")
    parser.add_argument(
        "--limit",
        type=int,
        default=100_000,
        help="Number of rows/lines to copy (default: 100000)",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")
    if args.limit <= 0:
        raise ValueError("--limit must be a positive integer")

    written = extract_first_rows(input_path, output_path, args.limit)
    print(f"Wrote {written} lines to {output_path}")


if __name__ == "__main__":
    main()
