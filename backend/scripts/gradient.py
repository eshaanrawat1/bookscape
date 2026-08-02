"""
gradient.py
────────────────
Command-line front end for the cover-color extractor.

The work itself lives in `backend/app/services/covers.py`, which the API's
background worker also runs — one implementation, two entry points, so a book
coloured by hand and a book coloured by the app go through exactly the same
code and land in exactly the same log.

Nothing here needs to be run for normal use: the app's worker picks up new
books on its own. This is for draining a large backlog faster than an idle
desktop app will, and for reviewing what failed.

Every attempt — success or failure — is recorded in `cover_attempts`, so a book
is tried exactly once and a dead cover URL never comes back around. Failures
are reviewable in `backend/data/logs/covers.jsonl`:

    jq 'select(.status == "failed")' backend/data/logs/covers.jsonl

and can be re-queued in bulk with `--retry-failed` once the cause is fixed.

Reads and writes backend/data/bookscape.db regardless of the cwd it is run from.

Usage:
    python3 backend/scripts/gradient.py
    python3 backend/scripts/gradient.py --limit 25
    python3 backend/scripts/gradient.py --status
    python3 backend/scripts/gradient.py --retry-failed
"""

import argparse
import logging
import sys
from pathlib import Path

# This script lives in backend/scripts/; the app package lives alongside it at
# backend/app/. Put the repo root on sys.path so the shared service layer —
# and with it the same upsert, the same rate limiter and the same log file the
# app uses — is importable.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.db import init_app_db                      # noqa: E402
from backend.app.observability import configure_logging     # noqa: E402
from backend.app.services import covers                     # noqa: E402
from backend.app.services.covers import Outcome             # noqa: E402


def print_status() -> None:
    print(f"📋  {covers.queue_depth(PROJECT_ROOT)} book(s) waiting for a color")
    print(f"🚫  {covers.failed_count(PROJECT_ROOT)} book(s) recorded as failed")


def drain(limit: int | None) -> int:
    """Colour books until the queue empties, the limit is hit, or the host
    starts pushing back. Returns a process exit code."""
    limiter = covers.RateLimiter()
    processed = 0
    found = 0

    with covers.new_session() as session:
        while limit is None or processed < limit:
            result = covers.process_one(PROJECT_ROOT, session, limiter)

            if result is None:
                print("✅  Every book with a cover has now been tried.")
                break

            processed += 1
            label = f"[{processed}] {result.uid}  {result.title!r}"

            if result.outcome is Outcome.OK:
                found += 1
                print(f"{label}\n  🎨 {result.color}")
            elif result.terminal:
                print(f"{label}\n  ⚠️  {result.outcome}: {result.detail} — recorded, will not retry")
            else:
                # Transient: the claim was released, so the book is still queued.
                print(f"{label}\n  🚨 {result.outcome}: {result.detail}")
                print(f"\n  💾 {found} color(s) committed — re-run to continue")
                return 1

    print(f"\n🏁 Done. {found}/{processed} attempted book(s) got a color")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Cover color extractor for the Bookscape catalog",
    )
    parser.add_argument(
        "--limit", type=int, metavar="N",
        help="Attempt at most N books this run (each one costs 8-14s of rate limiting)",
    )
    parser.add_argument(
        "--status", action="store_true",
        help="Print queue depth and failure count, then exit",
    )
    parser.add_argument(
        "--retry-failed", action="store_true",
        help="Forget every recorded failure so those books are queued again",
    )
    args = parser.parse_args()

    init_app_db(PROJECT_ROOT)
    # This script is its own presentation layer — it prints a readable line per
    # book below, so the console handler stays quiet to avoid saying everything
    # twice. Both still land in covers.jsonl, identically to the app's.
    configure_logging(PROJECT_ROOT, console_level=logging.ERROR)

    if args.status:
        print_status()
        return

    if args.retry_failed:
        cleared = covers.clear_failed(PROJECT_ROOT)
        print(f"♻️   {cleared} failed book(s) returned to the queue")
        return

    released = covers.clear_stale_claims(PROJECT_ROOT)
    if released:
        print(f"♻️   {released} abandoned claim(s) released")

    if covers.queue_depth(PROJECT_ROOT) == 0:
        print("✅  Every book with a cover already has a color or a recorded failure.")
        return

    print_status()
    print()
    sys.exit(drain(args.limit))


if __name__ == "__main__":
    main()
