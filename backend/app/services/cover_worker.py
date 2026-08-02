"""
cover_worker.py
───────────────
A single background thread that keeps `books.color` filled in.

Runs inside the API process rather than shelling out to `gradient.py` per
import, for three reasons:

  * Rate limiting stays real. Every runner carries its own `RateLimiter`, so
    N concurrent subprocesses is N unthrottled clients pointed at the same
    host — exactly what the 8–14s spacing exists to prevent. One thread makes
    the throttle structural.
  * No orphans. A daemon thread dies with uvicorn; a subprocess spawned here
    would be a grandchild of the Tauri process, which shuts the backend down by
    killing whatever holds the port and would leave the extractor running.
  * No duplicated work. Two `--limit 1` runs both pick the same newest row.

The thread sleeps on an `Event`, so a freshly imported book is picked up the
moment `poke()` is called rather than at the next poll.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path

from . import covers
from .covers import Outcome

logger = logging.getLogger(__name__)


# Nothing arrives unannounced except a hand-run scraper, and the confirm route
# pokes us directly, so idle polling can be lazy.
IDLE_POLL_SECONDS = 300.0

# A 429 means back off for a good while — the whole point of hard-stopping in
# the CLI, expressed as a pause instead of an exit.
RATE_LIMIT_BACKOFF_SECONDS = 600.0

# A dropped connection is usually momentary; one extra beat is enough.
NETWORK_BACKOFF_SECONDS = 60.0


class CoverWorker:
    def __init__(self, root: Path) -> None:
        self._root = root
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._limiter = covers.RateLimiter()

    def start(self) -> None:
        if self._thread is not None:
            return
        released = covers.clear_stale_claims(self._root)
        if released:
            logger.warning(
                "cover.claims_released",
                extra={"count": released, "why": "stale claim from a previous run"},
            )
        self._thread = threading.Thread(
            target=self._run,
            name="cover-worker",
            daemon=True,
        )
        self._thread.start()
        logger.info(
            "cover.worker_started",
            extra={"queue_depth": covers.queue_depth(self._root)},
        )

    def poke(self) -> None:
        """Wake the worker now — a book was just added."""
        self._wake.set()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()

    def _sleep(self, seconds: float) -> None:
        """Interruptible pause. Returns early when poked or stopped."""
        self._wake.wait(seconds)
        self._wake.clear()

    def _run(self) -> None:
        session = covers.new_session()
        try:
            while not self._stop.is_set():
                try:
                    result = covers.process_one(self._root, session, self._limiter)
                except Exception:
                    # A bug in one attempt must not take the worker down for the
                    # rest of the session; log it with the traceback and pause.
                    logger.exception("cover.worker_error")
                    self._sleep(NETWORK_BACKOFF_SECONDS)
                    continue

                if result is None:
                    self._sleep(IDLE_POLL_SECONDS)
                elif result.outcome is Outcome.RATE_LIMITED:
                    logger.warning(
                        "cover.backoff",
                        extra={"reason": str(result.outcome), "seconds": RATE_LIMIT_BACKOFF_SECONDS},
                    )
                    self._sleep(RATE_LIMIT_BACKOFF_SECONDS)
                elif result.outcome is Outcome.NETWORK_ERROR:
                    self._sleep(NETWORK_BACKOFF_SECONDS)
                # Terminal outcomes fall through and take the next book
                # immediately — the RateLimiter supplies the spacing.
        finally:
            session.close()


_worker: CoverWorker | None = None
_lock = threading.Lock()


def start_worker(root: Path) -> CoverWorker:
    """Start the process-wide worker. Idempotent."""
    global _worker
    with _lock:
        if _worker is None:
            _worker = CoverWorker(root)
            _worker.start()
        return _worker


def poke_worker() -> None:
    """Nudge the worker if one is running. Safe to call when none is — the CLI
    imports the same service code with no worker behind it."""
    if _worker is not None:
        _worker.poke()
