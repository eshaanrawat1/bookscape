"""
gradient.py
────────────────
Standalone, rate-limited cover-color extractor.

What it does:
  1. Load all uids from colors.txt (one per line)
  2. For each uid not yet colored in books.json, download its cover
     image and extract a single dominant color via ColorThief
  3. Write the result as `"color": "rgb(r, g, b)"` onto that book's
     record in books.json

Reads and writes backend/data/ regardless of the cwd it is run from.

Usage:
    python3 backend/scripts/gradient.py
    python3 backend/scripts/gradient.py --colors-file <file> --books-file <file>
"""

import argparse
import io
import json
import os
import random
import sys
import time
from pathlib import Path

import httpx
from colorthief import ColorThief


MIN_DELAY    = 8.0
MAX_DELAY    = 14.0

# This script lives in backend/scripts/; its data lives in backend/data/.
# Anchor to __file__ so the paths hold no matter what cwd it is run from.
DATA_DIR     = Path(__file__).resolve().parents[1] / "data"
COLORS_FILE  = str(DATA_DIR / "colors.txt")
BOOKS_FILE   = str(DATA_DIR / "books.json")
FLUSH_EVERY  = 25   

FATAL_STATUS_CODES = {429, 502, 503}

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
]


class FatalHTTPError(Exception):
    def __init__(self, status_code: int):
        self.status_code = status_code
        super().__init__(f"Fatal HTTP {status_code} — shutting down immediately")


# ── Rate limiter ─────────────────────────────────────────────────────────────

class RateLimiter:
    def __init__(self):
        self._last = 0.0

    def wait(self):
        elapsed   = time.monotonic() - self._last
        delay     = random.uniform(MIN_DELAY, MAX_DELAY)
        remaining = delay - elapsed
        if remaining > 0:
            print(f"  ⏳ waiting {remaining:.1f}s …")
            time.sleep(remaining)
        self._last = time.monotonic()


# ── Color extraction ───────────────────────────────────────────────────────────

def get_dominant_color(image_url: str, session: httpx.Client) -> str:
    """
    Download a cover image and extract its single dominant color.
    Returns "rgb(r, g, b)" or "" on any failure.
    Raises FatalHTTPError on 429/502/503 — same hard-stop policy as scraper.py.
    """
    if not image_url:
        return ""

    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Referer":    "https://www.goodreads.com/",
    }

    try:
        r = session.get(image_url, headers=headers, timeout=15)

        if r.status_code in FATAL_STATUS_CODES:
            raise FatalHTTPError(r.status_code)
        if r.status_code != 200:
            print(f"  ⚠️  HTTP {r.status_code} fetching cover — skipping")
            return ""

        thief = ColorThief(io.BytesIO(r.content))
        red, green, blue = thief.get_color(quality=1)
        return f"rgb({red}, {green}, {blue})"

    except FatalHTTPError:
        raise
    except httpx.RequestError as e:
        print(f"  ⚠️  Network error fetching cover: {e}")
        return ""
    except Exception as e:
        print(f"  ⚠️  Color extraction failed: {e}")
        return ""


# ── File I/O ──────────────────────────────────────────────────────────────────

def load_color_ids(path: str) -> list[str]:
    if not os.path.exists(path):
        print(f"❌  {path} not found — nothing to do")
        return []
    with open(path, "r", encoding="utf-8") as f:
        ids = [line.strip() for line in f if line.strip()]
    # de-dupe while preserving order
    seen = set()
    deduped = []
    for uid in ids:
        if uid not in seen:
            seen.add(uid)
            deduped.append(uid)
    return deduped


def load_books(path: str) -> list[dict]:
    if not os.path.exists(path):
        print(f"❌  {path} not found")
        return []
    with open(path, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            print(f"⚠️  Could not parse {path} — is it valid JSON?")
            return []


def save_books(path: str, books: list[dict]):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(books, f, indent=2, ensure_ascii=False)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description="Cover color extractor for Goodreads book dataset")
    p.add_argument("--colors-file", default=COLORS_FILE, metavar="FILE",
                    help="File with one book uid per line (default: backend/data/colors.txt)")
    p.add_argument("--books-file", default=BOOKS_FILE, metavar="FILE",
                    help="books.json to read/update (default: backend/data/books.json)")
    args = p.parse_args()

    uids = load_color_ids(args.colors_file)
    if not uids:
        return

    books = load_books(args.books_file)
    if not books:
        return

    # Index by uid for fast lookup + in-place update
    by_uid = {b.get("uid", ""): b for b in books if b.get("uid")}

    # Only process uids that exist in books.json, have an image_url,
    # and don't already have a color
    todo = [
        uid for uid in uids
        if uid in by_uid
        and by_uid[uid].get("image_url")
        and not by_uid[uid].get("color")
    ]

    already_done = len(uids) - len(todo)
    print(f"📋  {len(uids)} ids in {args.colors_file}  "
          f"({already_done} already colored or skippable, {len(todo)} to process)\n")

    if not todo:
        print("✅  Nothing to do.")
        return

    limiter = RateLimiter()
    found   = 0
    since_flush = 0

    session_headers = {"User-Agent": random.choice(USER_AGENTS)}
    with httpx.Client(headers=session_headers, timeout=20, follow_redirects=True) as session:
        for i, uid in enumerate(todo, 1):
            book = by_uid[uid]
            print(f"[{i}/{len(todo)}] {uid}  {book.get('title', '')!r}")

            limiter.wait()

            try:
                color = get_dominant_color(book["image_url"], session)
            except FatalHTTPError as e:
                print(f"\n🚨 {e}")
                save_books(args.books_file, books)
                print(f"  💾 saved progress ({found} colors found) before exit")
                sys.exit(1)

            if color:
                book["color"] = color
                found += 1
                since_flush += 1
                print(f"  🎨 {color}")
            else:
                print("  ⚠️  No color extracted")

            if since_flush >= FLUSH_EVERY:
                save_books(args.books_file, books)
                print(f"  💾 flushed progress → {args.books_file}")
                since_flush = 0

    save_books(args.books_file, books)
    print(f"\n🏁 Done. {found}/{len(todo)} colors found and saved to {args.books_file}")


if __name__ == "__main__":
    main()