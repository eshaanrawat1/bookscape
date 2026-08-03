"""
covers.py
─────────
Cover-color extraction: download a book's cover, pull one dominant color out of
it, write it to `books.color`.

The work list is a query, not a file — books with a cover and no color yet,
minus anything already attempted. `gradient.py` and the background worker are
both thin loops over `process_one()` below, so there is exactly one
implementation of "sample a cover" no matter which one is running.

Failure is split two ways, and the split is the point:

  * Terminal — the *book* is the problem. A 404 cover URL will still be 404
    next week, and bytes ColorThief cannot decode will not become decodable.
    Recorded as `failed`; the book never comes back around.

  * Transient — *we* are the problem. A 429 says the host is pushing back and
    a connection reset says the network blinked; neither is evidence about the
    cover. The claim is released and the book returns to the queue.

Collapsing those two would mean a single rate-limit window permanently
un-coloring every book that happened to be in flight during it.
"""

from __future__ import annotations

import io
import logging
import random
import time
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

import httpx
from colorthief import ColorThief

from ..db import transaction
from ..observability import metrics
from .catalog import upsert_book

logger = logging.getLogger(__name__)


MIN_DELAY = 8.0
MAX_DELAY = 14.0

RATE_LIMIT_STATUS_CODES = {429, 502, 503}

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
]

# A claim can only be lost to another runner, and losing it means some *other*
# book is now next. A couple of retries covers the worker racing a hand-run
# gradient.py; beyond that the queue is busy enough to leave alone.
CLAIM_ATTEMPTS = 3

# How long a 'pending' claim may sit before it is assumed to belong to a runner
# that died rather than one still working.
STALE_CLAIM_MINUTES = 60


class Outcome(StrEnum):
    """Every way one cover can end. `StrEnum` so it drops straight into a log
    payload, a metric label and a TEXT column without conversion."""

    OK = "ok"
    # Terminal — attributable to the book.
    HTTP_STATUS = "http_status"
    DECODE_ERROR = "decode_error"
    EMPTY_IMAGE = "empty_image"
    # Transient — attributable to the network or the host.
    RATE_LIMITED = "rate_limited"
    NETWORK_ERROR = "network_error"


TERMINAL_OUTCOMES = frozenset({
    Outcome.OK,
    Outcome.HTTP_STATUS,
    Outcome.DECODE_ERROR,
    Outcome.EMPTY_IMAGE,
})


class RateLimiter:
    """Spaces outbound cover fetches by 8–14s.

    One instance per runner, and the runners are meant to be singular: the
    worker is a single thread and `gradient.py` a single process. Two limiters
    running at once is two unthrottled clients as far as the host is concerned,
    which is why claiming is a database constraint rather than an honour system.
    """

    def __init__(self) -> None:
        self._last = 0.0

    def wait(self) -> None:
        elapsed = time.monotonic() - self._last
        delay = random.uniform(MIN_DELAY, MAX_DELAY)
        remaining = delay - elapsed
        if remaining > 0:
            time.sleep(remaining)
        self._last = time.monotonic()


# ── Extraction ────────────────────────────────────────────────────────────────

def extract_color(image_url: str, session: httpx.Client) -> tuple[str, Outcome, str]:
    """Download one cover and reduce it to a single dominant color.

    Returns `(color, outcome, detail)` where color is `"rgb(r, g, b)"` on
    success and `""` otherwise. Outcomes are returned rather than raised —
    a rate limit is an ordinary result here, and both callers need to branch on
    it rather than unwind.
    """
    if not image_url:
        return "", Outcome.EMPTY_IMAGE, "book has no cover image url"

    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Referer": "https://www.goodreads.com/",
    }

    try:
        response = session.get(image_url, headers=headers, timeout=15)
    except httpx.RequestError as error:
        return "", Outcome.NETWORK_ERROR, f"{type(error).__name__}: {error}"

    if response.status_code in RATE_LIMIT_STATUS_CODES:
        return "", Outcome.RATE_LIMITED, f"HTTP {response.status_code}"
    if response.status_code != 200:
        return "", Outcome.HTTP_STATUS, f"HTTP {response.status_code}"

    try:
        thief = ColorThief(io.BytesIO(response.content))
        red, green, blue = thief.get_color(quality=1)
    except Exception as error:
        return "", Outcome.DECODE_ERROR, f"{type(error).__name__}: {error}"

    return f"rgb({red}, {green}, {blue})", Outcome.OK, ""


# ── Queue ─────────────────────────────────────────────────────────────────────

# Newest first, so a book just added through the app gets its color before the
# long tail of the back catalog.
_NEXT_BOOK_SQL = """
SELECT uid, title, image_url FROM books
WHERE color = '' AND image_url != ''
  AND uid NOT IN (SELECT uid FROM cover_attempts)
ORDER BY updated_at DESC
LIMIT 1
"""


def claim_next_book(root: Path) -> dict | None:
    """Take the next book needing a color, marking it claimed in the same
    transaction. Returns None when the queue is empty.

    `INSERT OR IGNORE` plus a rowcount check is what makes this safe against a
    second runner: whoever inserts the row owns the book, and the loser simply
    asks for the next one.
    """
    for _ in range(CLAIM_ATTEMPTS):
        with transaction(root) as conn:
            row = conn.execute(_NEXT_BOOK_SQL).fetchone()
            if row is None:
                return None
            claimed = conn.execute(
                "INSERT OR IGNORE INTO cover_attempts (uid, status) VALUES (?, 'pending')",
                (row["uid"],),
            )
            if claimed.rowcount == 1:
                return dict(row)
    return None


def release_claim(root: Path, uid: str) -> None:
    """Put a book back in the queue after a transient failure. Scoped to
    'pending' so it can never erase a recorded verdict."""
    with transaction(root) as conn:
        conn.execute(
            "DELETE FROM cover_attempts WHERE uid = ? AND status = 'pending'",
            (uid,),
        )


def record_result(root: Path, uid: str, outcome: Outcome, detail: str) -> None:
    """Settle a claim as 'ok' or 'failed'. Terminal outcomes only — a transient
    one goes through `release_claim` instead."""
    status = "ok" if outcome is Outcome.OK else "failed"
    with transaction(root) as conn:
        conn.execute(
            "UPDATE cover_attempts SET status = ?, reason = ?, detail = ?, "
            "attempted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE uid = ?",
            (status, str(outcome), detail, uid),
        )


def queue_depth(root: Path) -> int:
    """Books still waiting for a first attempt. A gauge, once there is a
    /metrics endpoint to hang it on."""
    with transaction(root) as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM books "
            "WHERE color = '' AND image_url != '' "
            "AND uid NOT IN (SELECT uid FROM cover_attempts)"
        ).fetchone()
    return int(row["n"])


def failed_count(root: Path) -> int:
    with transaction(root) as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM cover_attempts WHERE status = 'failed'"
        ).fetchone()
    return int(row["n"])


def clear_failed(root: Path) -> int:
    """Forget every recorded failure so those books re-enter the queue. Backs
    `gradient.py --retry-failed`, for when the cause was on our end after all."""
    with transaction(root) as conn:
        cursor = conn.execute("DELETE FROM cover_attempts WHERE status = 'failed'")
        return cursor.rowcount


def clear_stale_claims(root: Path, max_age_minutes: int = STALE_CLAIM_MINUTES) -> int:
    """Release claims left 'pending' by a runner that died mid-fetch.

    Age-gated rather than unconditional: a hand-run `gradient.py` may be
    holding a legitimate claim at the moment the app starts, and clearing that
    would hand its book to the worker as well. Nothing takes an hour to sample
    a single cover, so anything older than that is genuinely abandoned.

    `attempted_at` is fixed-width ISO-8601, so a string comparison against the
    same format orders correctly.
    """
    with transaction(root) as conn:
        cursor = conn.execute(
            "DELETE FROM cover_attempts WHERE status = 'pending' "
            "AND attempted_at < strftime('%Y-%m-%dT%H:%M:%fZ','now',?)",
            (f"-{int(max_age_minutes)} minutes",),
        )
        return cursor.rowcount


# ── One unit of work ──────────────────────────────────────────────────────────

@dataclass(frozen=True)
class AttemptResult:
    """What one cover attempt did. Returned so callers can report it without
    re-querying — the CLI prints it, the worker branches on `outcome`."""

    uid: str
    title: str
    outcome: Outcome
    detail: str
    color: str
    duration_ms: int

    @property
    def terminal(self) -> bool:
        return self.outcome in TERMINAL_OUTCOMES


def new_session() -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": random.choice(USER_AGENTS)},
        timeout=20,
        follow_redirects=True,
    )


def process_one(root: Path, session: httpx.Client, limiter: RateLimiter) -> AttemptResult | None:
    """Claim one book, sample its cover, settle the claim. Returns the result,
    or None when there was nothing to do.

    The single place a cover attempt is logged and counted, which is what keeps
    the CLI and the worker reporting identically.
    """
    # Spacing first, then claim. A claim held across the 8-14s sleep would be
    # stranded by any shutdown landing in that window — which is most of them,
    # the sleep being an order of magnitude longer than the fetch. Waiting first
    # costs nothing when the queue is empty: the limiter only sleeps if a fetch
    # went out recently.
    limiter.wait()

    book = claim_next_book(root)
    if book is None:
        return None

    uid = book["uid"]

    started = time.monotonic()
    color, outcome, detail = extract_color(book["image_url"], session)
    duration_ms = round((time.monotonic() - started) * 1000)

    if outcome is Outcome.OK:
        # Only the color key is passed, so every scraper-owned field on the row
        # survives untouched.
        upsert_book(root, {"uid": uid, "color": color})

    if outcome in TERMINAL_OUTCOMES:
        record_result(root, uid, outcome, detail)
    else:
        release_claim(root, uid)

    status = "ok" if outcome is Outcome.OK else "failed"
    metrics.increment("covers_attempts_total", status=status, reason=str(outcome))
    metrics.increment("covers_fetch_duration_ms_total", amount=duration_ms, reason=str(outcome))

    logger.log(
        logging.INFO if outcome is Outcome.OK else logging.WARNING,
        "cover.attempt",
        extra={
            "uid": uid,
            "title": book["title"],
            "image_url": book["image_url"],
            "status": status,
            "reason": str(outcome),
            "detail": detail,
            "color": color,
            "terminal": outcome in TERMINAL_OUTCOMES,
            "duration_ms": duration_ms,
        },
    )
    return AttemptResult(
        uid=uid,
        title=book["title"],
        outcome=outcome,
        detail=detail,
        color=color,
        duration_ms=duration_ms,
    )
