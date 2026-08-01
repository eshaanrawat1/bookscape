"""
gradient.py
────────────────
Standalone, rate-limited cover-color extractor.

What it does:
  1. Ask bookscape.db for every book that has a cover image but no color yet
  2. Download each cover and extract a single dominant color via ColorThief
  3. Write it straight back to that book's `color` column

Colors are committed one at a time, so a rate-limit shutdown (or a Ctrl-C)
never loses the work already done — just re-run to pick up where it stopped.
The database is the queue: there is no separate list of ids to keep in sync.

Reads and writes backend/data/bookscape.db regardless of the cwd it is run from.

Usage:
    python3 backend/scripts/gradient.py
    python3 backend/scripts/gradient.py --limit 25
"""

import argparse
import io
import random
import sys
import time
from pathlib import Path

import httpx
from colorthief import ColorThief

# This script lives in backend/scripts/; the app package lives alongside it at
# backend/app/. Put the repo root on sys.path so colors are written through the
# same upsert the desktop app and the scraper use.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.db import init_app_db, transaction        # noqa: E402
from backend.app.services.catalog import upsert_book       # noqa: E402


MIN_DELAY    = 8.0
MAX_DELAY    = 14.0

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


# ── Catalog access ────────────────────────────────────────────────────────────

def books_needing_color(limit: int | None = None) -> list[dict]:
    """Books that have a cover to sample but no color yet.

    Newest first, so books just added by the app or the crawler get their color
    before the long tail of the back catalog.
    """
    sql = (
        "SELECT uid, title, image_url FROM books "
        "WHERE color = '' AND image_url != '' "
        "ORDER BY updated_at DESC"
    )
    params: tuple = ()
    if limit:
        sql += " LIMIT ?"
        params = (int(limit),)
    with transaction(PROJECT_ROOT) as conn:
        return [dict(row) for row in conn.execute(sql, params).fetchall()]


def save_color(uid: str, color: str) -> None:
    """Persist one color. Uses upsert_book so only the `color` column is
    touched — every scraper-owned field on the row is left exactly as it was."""
    upsert_book(PROJECT_ROOT, {"uid": uid, "color": color})


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description="Cover color extractor for the Bookscape catalog")
    p.add_argument("--limit", type=int, metavar="N",
                   help="Process at most N books this run (each one costs 8-14s of rate limiting)")
    args = p.parse_args()

    init_app_db(PROJECT_ROOT)

    todo = books_needing_color(args.limit)
    if not todo:
        print("✅  Every book with a cover already has a color.")
        return

    print(f"📋  {len(todo)} book(s) need a cover color\n")

    limiter = RateLimiter()
    found   = 0

    session_headers = {"User-Agent": random.choice(USER_AGENTS)}
    with httpx.Client(headers=session_headers, timeout=20, follow_redirects=True) as session:
        for i, book in enumerate(todo, 1):
            print(f"[{i}/{len(todo)}] {book['uid']}  {book['title']!r}")

            limiter.wait()

            try:
                color = get_dominant_color(book["image_url"], session)
            except FatalHTTPError as e:
                print(f"\n🚨 {e}")
                print(f"  💾 {found} color(s) already committed — re-run to continue")
                sys.exit(1)

            if color:
                save_color(book["uid"], color)
                found += 1
                print(f"  🎨 {color}")
            else:
                print("  ⚠️  No color extracted")

    print(f"\n🏁 Done. {found}/{len(todo)} colors found and written to bookscape.db")


if __name__ == "__main__":
    main()
