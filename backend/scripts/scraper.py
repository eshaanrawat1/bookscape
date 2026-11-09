"""Rate-limited Goodreads scraper using Playwright, since the site's AWS WAF needs a real browser."""

import argparse
import json
import os
import random
import re
import signal
import sqlite3
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Optional

from bs4 import BeautifulSoup
from playwright.sync_api import Error as PlaywrightError, sync_playwright, Page

# Put the repo root on sys.path to reuse the app's upsert path.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.db import init_app_db                       # noqa: E402
from backend.app.services.catalog import resolve_book, upsert_book  # noqa: E402


MIN_DELAY    = 12.0
MAX_DELAY    = 20.0

DATA_DIR     = Path(__file__).resolve().parents[1] / "data"
FRONTIER_DB  = str(DATA_DIR / "frontier.db")
SIMILAR_CAP  = 20

FATAL_STATUS_CODES = {429, 502, 503}
WAF_RETRY_LIMIT    = 2   

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

GRAPHQL_QUERY = """
query getSimilarBooks($id: ID!, $limit: Int!) {
  getSimilarBooks(id: $id, pagination: {limit: $limit}) {
    edges {
      node {
        legacyId
        title
        webUrl
      }
    }
  }
}
"""


@dataclass
class Book:
    uid:              str       = ""
    title:            str       = ""
    author:           str       = ""
    image_url:        str       = ""
    avg_rating:       float     = 0.0
    rating_count:     int       = 0
    review_count:     int       = 0
    genres:           list[str] = field(default_factory=list)
    description:      str       = ""
    page_count:       int       = 0
    series:           str       = ""
    series_number:    str       = ""
    similar_book_ids: list[str] = field(default_factory=list)
    scraped_at:       str       = ""


_appsync_cache: Optional[dict] = None   # {"endpoint": ..., "api_key": ...}

def _get_appsync_config(page: Page) -> Optional[dict]:
    """Extract the AppSync endpoint and API key from Goodreads' _app JS chunk, via the browser's context."""
    global _appsync_cache
    if _appsync_cache:
        return _appsync_cache

    print("  🔑 Extracting AppSync config from JS bundle …")

    try:
        script_srcs = page.eval_on_selector_all(
            "script[src]", "els => els.map(e => e.src)"
        )
        srcs_sorted = sorted(
            script_srcs,
            key=lambda s: (0 if "_app" in s else 1 if "main" in s else 2)
        )

        for src in srcs_sorted:
            if not src or "doubleclick" in src:
                continue
            try:
                js = page.evaluate(
                    """async (url) => {
                        const res = await fetch(url);
                        return await res.text();
                    }""",
                    src,
                )
            except Exception:
                continue

            if not js or "appsync" not in js.lower():
                continue

            # Match the gap with [\s\S], not [^"]: Goodreads injects quoted WAF config between the two markers.
            block_re = re.compile(
                r'"graphql"\s*:\s*\{[^}]*"apiKey"\s*:\s*"([^"]+)"'
                r'[^}]*"endpoint"\s*:\s*"([^"]+)"[^}]*\}'
                r'[\s\S]{0,500}?"publishWebVitalMetrics"\s*:\s*(true|false)'
            )
            prod   = next((m for m in block_re.finditer(js) if m.group(3) == "true"), None)
            chosen = prod or next(block_re.finditer(js), None)
            if chosen:
                _appsync_cache = {
                    "endpoint": chosen.group(2),
                    "api_key":  chosen.group(1),
                }
                label = "prod" if prod else "fallback"
                print(f"  ✅ AppSync config extracted ({label})  "
                      f"endpoint=…{chosen.group(2)[-40:]}")
                return _appsync_cache

        print("  ⚠️  Could not extract AppSync config — similar books will be empty")
        return None

    except Exception as e:
        print(f"  ⚠️  AppSync config extraction failed: {e}")
        return None


def fetch_similar_books(kca_id: str, page: Page, limiter_fn) -> list[str]:
    """Call AppSync getSimilarBooks in-page so it carries the WAF-cleared cookies."""
    config = _get_appsync_config(page)
    if not config or not kca_id:
        return []

    payload = {
        "operationName": "getSimilarBooks",
        "query":         GRAPHQL_QUERY,
        "variables":     {"id": kca_id, "limit": SIMILAR_CAP},
    }

    limiter_fn()

    try:
        result = page.evaluate(
            """async ({endpoint, apiKey, payload}) => {
                const res = await fetch(endpoint, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-api-key": apiKey,
                    },
                    body: JSON.stringify(payload),
                });
                return {status: res.status, body: await res.text()};
            }""",
            {
                "endpoint": config["endpoint"],
                "apiKey":   config["api_key"],
                "payload":  payload,
            },
        )

        status = result.get("status", 0)
        if status in FATAL_STATUS_CODES:
            raise FatalHTTPError(status)
        if status != 200:
            print(f"  ⚠️  GraphQL HTTP {status}")
            return []

        data  = json.loads(result.get("body", "{}"))
        edges = (
            data.get("data", {})
                .get("getSimilarBooks", {})
                .get("edges", [])
        )
        ids = []
        for edge in edges:
            node = edge.get("node", {})
            lid = node.get("legacyId")
            if lid:
                ids.append(str(lid))
        return ids

    except FatalHTTPError:
        raise
    except Exception as e:
        print(f"  ⚠️  GraphQL error: {e}")
        return []


class Frontier:
    """SQLite-backed URL queue (pending -> done | failed) with a crawl depth per entry."""

    def __init__(self, db_path: str = FRONTIER_DB):
        self.db_path = db_path
        self._init()

    def _conn(self) -> sqlite3.Connection:
        return sqlite3.connect(self.db_path, check_same_thread=False)

    def _init(self):
        with self._conn() as c:
            c.execute("""
                CREATE TABLE IF NOT EXISTS urls (
                    url    TEXT PRIMARY KEY,
                    status TEXT NOT NULL DEFAULT 'pending',
                    depth  INTEGER NOT NULL DEFAULT 0,
                    added  TEXT NOT NULL
                )
            """)
            cols = [row[1] for row in c.execute("PRAGMA table_info(urls)")]
            if "depth" not in cols:
                c.execute("ALTER TABLE urls ADD COLUMN depth INTEGER NOT NULL DEFAULT 0")

    def add(self, url: str, depth: int = 0):
        with self._conn() as c:
            c.execute(
                "INSERT OR IGNORE INTO urls (url, status, depth, added) VALUES (?, 'pending', ?, ?)",
                (url, depth, _now()),
            )

    def add_many(self, urls: list[str], depth: int = 0):
        with self._conn() as c:
            c.executemany(
                "INSERT OR IGNORE INTO urls (url, status, depth, added) VALUES (?, 'pending', ?, ?)",
                [(u, depth, _now()) for u in urls],
            )

    def next(self) -> Optional[tuple[str, int]]:
        with self._conn() as c:
            row = c.execute(
                "SELECT url, depth FROM urls WHERE status = 'pending' ORDER BY rowid LIMIT 1"
            ).fetchone()
        return (row[0], row[1]) if row else None

    def mark_done(self, url: str):
        with self._conn() as c:
            c.execute("UPDATE urls SET status = 'done' WHERE url = ?", (url,))

    def mark_failed(self, url: str):
        with self._conn() as c:
            c.execute("UPDATE urls SET status = 'failed' WHERE url = ?", (url,))

    def stats(self) -> dict:
        with self._conn() as c:
            rows = c.execute(
                "SELECT status, COUNT(*) FROM urls GROUP BY status"
            ).fetchall()
        return {r[0]: r[1] for r in rows}


class RateLimiter:
    """Shared rate limiter; `wait()` runs before every outbound request."""

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


class FatalHTTPError(Exception):
    def __init__(self, status_code: int):
        self.status_code = status_code
        super().__init__(f"Fatal HTTP {status_code} — shutting down immediately")


def fetch_page(url: str, page: Page) -> Optional[str]:
    """Load a book page in Chromium, retrying while it still looks like a WAF challenge."""
    for attempt in range(1, WAF_RETRY_LIMIT + 2):
        try:
            response = page.goto(url, wait_until="domcontentloaded", timeout=30000)
        except Exception as e:
            print(f"  ⚠️  Navigation error: {e}")
            return None

        status = response.status if response else 0

        if status in FATAL_STATUS_CODES:
            raise FatalHTTPError(status)

        if status == 404:
            print("  ⚠️  404 — skipping")
            return None

        # Give the WAF challenge / hydration a moment to resolve
        try:
            page.wait_for_selector("script#__NEXT_DATA__", timeout=8000)
        except Exception:
            pass

        html = page.content()

        if "__NEXT_DATA__" in html and len(html) > 5000:
            return html

        if attempt <= WAF_RETRY_LIMIT:
            print(f"  ⚠️  Looks like a challenge/empty page (status={status}, "
                  f"len={len(html)}) — retry {attempt}/{WAF_RETRY_LIMIT}")
            time.sleep(random.uniform(3.0, 6.0))
            continue

        print(f"  ⚠️  Could not get real content after retries (status={status})")
        return None

    return None


def parse_book(html: str, url: str) -> Optional[tuple]:
    """Parse a book page into (Book, kca_id). Priority: apolloState > JSON-LD > OpenGraph > DOM."""
    soup = BeautifulSoup(html, "lxml")

    uid_match = re.search(r"/book/show/(\d+)", url)
    uid = uid_match.group(1) if uid_match else ""

    apollo      = {}
    book_node   = {}
    work_node   = {}
    kca_id      = ""     # "kca://book/amzn1.gr.book.v3.XXXX" for GraphQL

    next_tag = soup.find("script", id="__NEXT_DATA__")
    if next_tag:
        try:
            next_data = json.loads(next_tag.string or "")
            apollo = (
                next_data
                .get("props", {})
                .get("pageProps", {})
                .get("apolloState", {})
            )
        except (json.JSONDecodeError, TypeError):
            pass

    for key, val in apollo.items():
        if not isinstance(val, dict):
            continue
        if key.startswith("Book:") and val.get("legacyId") == _safe_int(uid):
            book_node = val
            kca_id    = val.get("id", "")
        if key.startswith("Work:"):
            work_node = val

    ld: dict = {}
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            d = json.loads(tag.string or "")
            if isinstance(d, dict) and d.get("@type") == "Book":
                ld = d
                break
        except (json.JSONDecodeError, TypeError):
            pass

    title = (
        book_node.get("title")
        or ld.get("name")
        or _og(soup, "og:title")
        or _text(soup, 'h1[data-testid="bookTitle"]')
    )

    author = ""
    contrib_edge = book_node.get("primaryContributorEdge") or {}
    contrib_ref  = contrib_edge.get("node") or {}
    contrib_key  = contrib_ref.get("__ref", "")
    if contrib_key and contrib_key in apollo:
        author = apollo[contrib_key].get("name", "")
    if not author:
        al = ld.get("author")
        if isinstance(al, list) and al:
            author = al[0].get("name", "")
        elif isinstance(al, dict):
            author = al.get("name", "")
    if not author:
        author = _text(soup, ".ContributorLink__name")

    image_url = (
        book_node.get("imageUrl")
        or _og(soup, "og:image")
        or ld.get("image", "")
    )

    work_stats  = work_node.get("stats") or {}
    stats_ref   = work_stats.get("__ref", "")
    stats_node  = apollo.get(stats_ref, {}) if stats_ref else work_stats

    try:
        avg_rating = float(
            stats_node.get("averageRating")
            or (ld.get("aggregateRating") or {}).get("ratingValue")
            or _text(soup, ".RatingStatistics__rating")
            or 0
        )
    except (ValueError, TypeError):
        avg_rating = 0.0

    rating_count = _parse_int(
        stats_node.get("ratingsCount")
        or (ld.get("aggregateRating") or {}).get("ratingCount")
        or _text(soup, '[data-testid="ratingsCount"]')
    )
    review_count = _parse_int(
        stats_node.get("textReviewsCount")
        or (ld.get("aggregateRating") or {}).get("reviewCount")
        or _text(soup, '[data-testid="reviewsCount"]')
    )

    # The "...more" link shares .Button--tag with the real genre chips.
    genres = [
        text
        for el in soup.select(
            ".BookPageMetadataSection__genres .Button--tag, "
            '[data-testid="genresList"] .Button--tag'
        )
        if (text := el.get_text(strip=True))
        and text.lower().lstrip(".…").strip() != "more"
    ]

    raw_desc = book_node.get("description", "")
    if raw_desc:
        description = BeautifulSoup(raw_desc, "lxml").get_text(" ", strip=True)
        description = unescape(description)
    else:
        desc_tag = (
            soup.select_one(".BookPageMetadataSection__description span[aria-label]")
            or soup.select_one('[data-testid="description"] span')
            or soup.select_one('[data-testid="description"]')
        )
        description = (
            desc_tag.get_text(" ", strip=True) if desc_tag
            else ld.get("description", "")
        )

    page_count = _parse_int(
        book_node.get("details", {}).get("numPages")
        or ld.get("numberOfPages")
        or ""
    )
    if not page_count:
        pt = _text(soup, '[data-testid="pagesFormat"]')
        m = re.search(r"(\d[\d,]*)\s*pages", pt, re.I)
        if m:
            page_count = _parse_int(m.group(1))

    series = series_number = ""
    series_tag = (
        soup.select_one('[data-testid="seriesName"]')
        or soup.select_one("h3.Text__title3 a[href*='/series/']")
        or soup.select_one("h3 a[href*='/series/']")
    )
    if series_tag:
        # Join on a space: the label is split across nodes, and strip=True alone would yield "Name#1".
        raw = re.sub(r"\s+", " ", series_tag.get_text(" ", strip=True)).strip()
        # Unwrap only when both ends match; .strip("()") would eat a paren that ends the name.
        if raw.startswith("(") and raw.endswith(")"):
            raw = raw[1:-1].strip()
        # \S+ allows "#1.5" and "#1-3"; anchoring to the end keeps a "#" inside the name intact.
        m = re.match(r'^(.+?),?\s*#\s*(\S+)$', raw)
        if m:
            series        = m.group(1).strip()
            series_number = m.group(2).strip()
        else:
            series = raw

    return Book(
        uid=uid,
        title=title or "",
        author=author or "",
        image_url=image_url or "",
        avg_rating=avg_rating,
        rating_count=rating_count,
        review_count=review_count,
        genres=genres,
        description=description,
        page_count=page_count,
        series=series,
        series_number=series_number,
        similar_book_ids=[],   # filled in by GraphQL call
        scraped_at=_now(),
    ), kca_id


def scrape_book_page(url: str, *, headed: bool = False, include_similar: bool = True) -> Optional[Book]:
    with sync_playwright() as pw:
        browser, page = make_browser_context(pw, headed=headed)
        try:
            print("@@STAGE@@ fetching_page", flush=True)
            _get_appsync_config(page)
            html = fetch_page(url, page)
            if not html:
                return None
            result = parse_book(html, url)
            if not result:
                return None
            book, kca_id = result
            if include_similar:
                print("@@STAGE@@ fetching_similar", flush=True)
                limiter = RateLimiter()
                limiter.wait()
                book.similar_book_ids = fetch_similar_books(kca_id, page, limiter.wait)
            return book
        finally:
            browser.close()


def _text(soup: BeautifulSoup, selector: str) -> str:
    el = soup.select_one(selector)
    return el.get_text(strip=True) if el else ""

def _og(soup: BeautifulSoup, prop: str) -> str:
    tag = soup.find("meta", property=prop)
    return tag.get("content", "") if tag else ""

def _parse_int(value) -> int:
    try:
        return int(re.sub(r"[^\d]", "", str(value)))
    except (ValueError, TypeError):
        return 0

def _safe_int(value) -> int:
    try:
        return int(value)
    except (ValueError, TypeError):
        return 0

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def save_book(book: Book) -> None:
    """Write a scraped book through the app's upsert, which only touches the keys present."""
    upsert_book(PROJECT_ROOT, asdict(book))


def already_scraped(uid: str) -> bool:
    return bool(uid) and resolve_book(PROJECT_ROOT, uid) is not None


# Playwright's browser cache lives outside the app and can go missing, so repair it in place.
BROWSER_INSTALL_TIMEOUT = 900

# One attempt per process, so a broken install surfaces the real launch error.
_browser_install_attempted = False


def _is_missing_browser(error: Exception) -> bool:
    text = str(error)
    return "Executable doesn't exist" in text or "playwright install" in text


def _install_chromium() -> bool:
    """Download Playwright's pinned Chromium. Output is captured to keep the stdout protocol clean."""
    print("@@STAGE@@ installing_browser", flush=True)
    print("Chromium is missing — downloading it (one-time, ~150MB)…", flush=True)

    try:
        result = subprocess.run(
            [sys.executable, "-m", "playwright", "install", "chromium"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=BROWSER_INSTALL_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        print(f"Chromium download timed out after {BROWSER_INSTALL_TIMEOUT}s.", flush=True)
        return False
    except OSError as error:
        print(f"Could not start the Chromium download: {error}", flush=True)
        return False

    if result.returncode != 0:
        for line in (result.stdout or "").strip().splitlines()[-5:]:
            print(f"playwright install: {line}", flush=True)
        return False

    print("Chromium ready.", flush=True)
    return True


def make_browser_context(playwright, headed: bool = False) -> tuple:
    """Return (browser, page), installing Chromium if missing unless BOOKSCAPE_AUTO_INSTALL_BROWSER=0."""
    global _browser_install_attempted

    try:
        browser = playwright.chromium.launch(headless=not headed)
    except PlaywrightError as error:
        if (
            _browser_install_attempted
            or os.getenv("BOOKSCAPE_AUTO_INSTALL_BROWSER", "1") == "0"
            or not _is_missing_browser(error)
        ):
            raise
        _browser_install_attempted = True
        if not _install_chromium():
            raise
        browser = playwright.chromium.launch(headless=not headed)

    context = browser.new_context(
        user_agent=USER_AGENT,
        viewport={"width": 1280, "height": 900},
        locale="en-US",
    )
    page = context.new_page()
    return browser, page


def run(
    frontier: Frontier,
    limiter: RateLimiter,
    max_depth: Optional[int] = None,
    headed: bool = False,
):
    """Drain the frontier into bookscape.db; max_depth caps similar-book recursion (None is unlimited)."""
    scraped_count = 0
    shutdown = {"requested": False}

    def _handle_signal(sig, frame):
        print("\n🛑 Shutdown signal — finishing current book then stopping …")
        shutdown["requested"] = True

    signal.signal(signal.SIGINT,  _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    with sync_playwright() as pw:
        browser, page = make_browser_context(pw, headed=headed)

        try:
            _get_appsync_config(page)

            while not shutdown["requested"]:
                item = frontier.next()
                if item is None:
                    print("✅ Frontier empty — nothing left to scrape.")
                    break
                url, depth = item

                stats = frontier.stats()
                print(
                    f"\n[scraped={scraped_count} | "
                    f"pending={stats.get('pending', 0)} | "
                    f"done={stats.get('done', 0)} | "
                    f"failed={stats.get('failed', 0)}]"
                )
                print(f"  → {url}  (depth={depth})")

                uid_match = re.search(r"/book/show/(\d+)", url)
                if uid_match and already_scraped(uid_match.group(1)):
                    print(f"  ⏭️  Already scraped — skipping")
                    frontier.mark_done(url)
                    continue

                limiter.wait()

                try:
                    html = fetch_page(url, page)
                except FatalHTTPError as e:
                    print(f"\n🚨 {e}")
                    browser.close()
                    sys.exit(1)

                if html is None:
                    frontier.mark_failed(url)
                    continue

                result = parse_book(html, url)
                if result is None:
                    print("  ⚠️  Parse failed — skipping")
                    frontier.mark_failed(url)
                    continue

                book, kca_id = result

                if not book.uid:
                    print("  ⚠️  No UID — skipping")
                    frontier.mark_failed(url)
                    continue

                try:
                    similar_ids = fetch_similar_books(kca_id, page, limiter.wait)
                    book.similar_book_ids = similar_ids
                except FatalHTTPError as e:
                    print(f"\n🚨 {e}")
                    browser.close()
                    sys.exit(1)

                save_book(book)
                scraped_count += 1
                frontier.mark_done(url)

                print(
                    f"  ✅ [{book.uid}] {book.title!r} — {book.author}"
                    + (f"  ({book.series} #{book.series_number})" if book.series else "")
                )
                print(
                    f"     ★{book.avg_rating}  "
                    f"{book.rating_count:,} ratings  "
                    f"{book.review_count:,} reviews  "
                    f"{book.page_count}pp"
                )
                if book.genres:
                    print(f"     genres: {', '.join(book.genres[:5])}")
                if book.similar_book_ids:
                    print(f"     🔗 {len(book.similar_book_ids)} similar books")
                else:
                    print("     ⚠️  No similar books retrieved")

                child_depth = depth + 1
                if book.similar_book_ids:
                    if max_depth is None or child_depth <= max_depth:
                        new_urls = [
                            f"https://www.goodreads.com/book/show/{bid}"
                            for bid in book.similar_book_ids
                        ]
                        frontier.add_many(new_urls, depth=child_depth)
                    else:
                        print(
                            f"     🔚 depth limit ({max_depth}) reached — "
                            f"not enqueuing {len(book.similar_book_ids)} similar books"
                        )
        finally:
            browser.close()

    final = frontier.stats()
    print(
        f"\n🏁 Session complete.  "
        f"scraped={scraped_count}  "
        f"pending={final.get('pending', 0)}  "
        f"done={final.get('done', 0)}"
    )


def main():
    p = argparse.ArgumentParser(description="Goodreads book scraper (Playwright)")
    p.add_argument("--seed",      metavar="URL",  help="Add one book URL and run (recursive crawl)")
    p.add_argument("--seed-file", metavar="FILE", help="Seed multiple book URLs from file, one per line (recursive crawl)")
    p.add_argument("--single",    metavar="URL",  help="Scrape ONE seed book plus its similar books to ONE level only, then stop")
    p.add_argument("--import-one", metavar="URL", help="Scrape ONE book, save it to the catalog, and stop")
    p.add_argument("--parse-one", metavar="URL",  help="Fetch and parse a single URL, print result, do not save or enqueue")
    p.add_argument("--fetch-one", metavar="URL",  help="Fetch+parse ONE book with similar books, emit machine-readable progress/result markers, do not save")
    p.add_argument("--stats",     action="store_true", help="Print frontier stats and exit")
    p.add_argument("--headed",    action="store_true", help="Show the browser window (useful for debugging WAF challenges)")
    args = p.parse_args()

    # --fetch-one runs on every "Add Book", so these modes must not open or create a database.
    if args.parse_one:
        url = args.parse_one
        print(f"\n📖 Parsing single book: {url}\n")
        book = scrape_book_page(url, headed=args.headed, include_similar=True)
        if not book:
            print("❌  Could not fetch or parse page")
            return
        print(json.dumps(asdict(book), indent=2, ensure_ascii=False))
        return

    if args.fetch_one:
        url = args.fetch_one
        try:
            book = scrape_book_page(url, headed=args.headed, include_similar=True)
        except FatalHTTPError as e:
            print(f"@@ERROR@@ Goodreads is rate-limiting requests (HTTP {e.status_code}). Please wait a few minutes and try again.", flush=True)
            sys.exit(1)
        except Exception as e:
            print(f"@@ERROR@@ Unexpected error while fetching the book page: {e}", flush=True)
            sys.exit(1)
        if not book:
            print("@@ERROR@@ Could not load or parse that page. Make sure the link points to a real Goodreads book page.", flush=True)
            sys.exit(1)
        if not book.uid:
            print("@@ERROR@@ The page loaded, but no book ID could be found on it.", flush=True)
            sys.exit(1)
        print("@@RESULT@@ " + json.dumps(asdict(book), ensure_ascii=False), flush=True)
        return

    if args.stats:
        print(json.dumps(Frontier().stats(), indent=2))
        return

    init_app_db(PROJECT_ROOT)
    frontier = Frontier()
    limiter  = RateLimiter()

    if args.import_one:
        url = args.import_one
        print(f"\n📥 Importing single book: {url}\n")
        book = scrape_book_page(url, headed=args.headed, include_similar=False)
        if not book:
            print("❌  Could not fetch or parse page")
            return
        if not book.uid:
            print("❌  Parsed book has no UID")
            return
        if already_scraped(book.uid):
            print(f"⏭️  Already imported: {book.uid}")
            return
        save_book(book)
        print(f"✅ Imported {book.uid}: {book.title!r}")
        return

    if args.single:
        frontier.add(args.single, depth=0)
        print(f"Seeded (single-book mode, depth-limited to 1): {args.single}")
        run(frontier, limiter, max_depth=1, headed=args.headed)
        return

    if args.seed:
        frontier.add(args.seed, depth=0)
        print(f"Seeded: {args.seed}")

    if args.seed_file:
        with open(args.seed_file) as f:
            urls = [line.strip() for line in f if line.strip()]
        frontier.add_many(urls, depth=0)
        print(f"Seeded {len(urls)} URLs from {args.seed_file}")

    run(frontier, limiter, max_depth=None, headed=args.headed)


if __name__ == "__main__":
    main()
