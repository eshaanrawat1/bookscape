from __future__ import annotations

import argparse
from pathlib import Path

import requests

from .common import DATA_RAW, write_jsonl


def fetch_openlibrary_subject(subject: str = "science_fiction", limit: int = 50) -> list[dict]:
    url = f"https://openlibrary.org/subjects/{subject}.json?limit={limit}"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    rows = []
    for w in data.get("works", []):
        rows.append(
            {
                "id": w.get("key", "").replace("/works/", ""),
                "title": w.get("title", ""),
                "author": (w.get("authors") or [{}])[0].get("name", ""),
                "description": w.get("subject", [""])[0] if isinstance(w.get("subject"), list) else "",
                "genres": subject,
            }
        )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--subject", default="science_fiction")
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--out", default=str(DATA_RAW / "openlibrary_books.jsonl"))
    args = parser.parse_args()

    rows = fetch_openlibrary_subject(args.subject, args.limit)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    write_jsonl(out, rows)
    print(f"wrote {len(rows)} rows to {out}")


if __name__ == "__main__":
    main()
