"""
backfill_reading_days.py
────────────────────────
Seeds `reading_days` from the books already marked finished.

The heatmap is written forward from now on — every page edit records the day it
happened — which leaves a real problem on an existing library: nothing before
today exists, so the calendar renders empty for months and reads as broken
rather than new.

What we do have for finished books is `start_date`, `finish_date` and
`total_pages`, so this spreads each book's pages evenly across the days it was
open. That is invented detail, and it is marked as such: every row is written
with `source = 'backfill'`, so it can be styled differently, audited, or
deleted wholesale later:

    DELETE FROM reading_days WHERE source = 'backfill';

Books that already have day history are skipped, so this never overwrites a
real, recorded day with a guess. Re-running it is therefore a no-op — pass
`--force` to reconsider books that already have rows.

Prints what it would do and changes nothing unless `--apply` is given.

Reads and writes backend/data/bookscape.db regardless of the cwd it is run from.

Usage:
    python3 backend/scripts/backfill_reading_days.py
    python3 backend/scripts/backfill_reading_days.py --apply
    python3 backend/scripts/backfill_reading_days.py --apply --force
"""

import argparse
import sys
from datetime import timedelta
from pathlib import Path

# This script lives in backend/scripts/; the app package lives alongside it at
# backend/app/. Put the repo root on sys.path so the write goes through the same
# repository the API uses, into the same table, with the same upsert semantics.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.db import init_app_db              # noqa: E402
from backend.app.repository import DataRepository   # noqa: E402
from backend.app.utils import parse_iso_date        # noqa: E402


def spread(uid: str, total: int, start, finish) -> list[tuple[str, str, int, int]]:
    """Distribute `total` pages across [start, finish] as (uid, day, pages, last_page).

    The remainder from the integer division goes onto the earliest days rather
    than being dropped, so the rows still sum to exactly `total` and the book's
    final `last_page` matches its page count.
    """
    span = (finish - start).days + 1
    base, extra = divmod(total, span)

    rows: list[tuple[str, str, int, int]] = []
    running = 0
    for offset in range(span):
        pages = base + (1 if offset < extra else 0)
        if pages <= 0:
            continue
        running += pages
        rows.append((uid, (start + timedelta(days=offset)).isoformat(), pages, running))
    return rows


def plan(repo: DataRepository, force: bool) -> tuple[list[tuple[str, str, int, int]], dict[str, int]]:
    """Build the full row list, plus counts of why books were left out."""
    already = set() if force else repo.books_with_reading_days()
    tally = {"books": 0, "skipped_tracked": 0, "skipped_no_dates": 0, "skipped_no_pages": 0}
    rows: list[tuple[str, str, int, int]] = []

    for uid, state in repo.list_book_states().items():
        if str(state.get("status") or "").strip().lower() != "done":
            continue
        if uid in already:
            tally["skipped_tracked"] += 1
            continue

        total = int(state.get("total_pages") or 0)
        if total <= 0:
            tally["skipped_no_pages"] += 1
            continue

        finish = parse_iso_date(state.get("finish_date"))
        start = parse_iso_date(state.get("start_date"))
        if not finish:
            # Without a finish date there is no day to attribute anything to;
            # a start date alone cannot say when the reading ended.
            tally["skipped_no_dates"] += 1
            continue
        if not start or start > finish:
            # One credible day beats a fabricated range: put it on the finish.
            start = finish

        tally["books"] += 1
        rows.extend(spread(uid, total, start, finish))

    return rows, tally


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="Write the rows (default is a dry run)")
    parser.add_argument(
        "--force", action="store_true",
        help="Also backfill books that already have day history, adding to their existing days",
    )
    args = parser.parse_args()

    init_app_db(PROJECT_ROOT)
    repo = DataRepository(PROJECT_ROOT)
    rows, tally = plan(repo, args.force)

    print(f"📚  {tally['books']} finished book(s) to backfill")
    print(f"📅  {len(rows)} reading-day row(s) over {len({r[1] for r in rows})} distinct day(s)")
    print(f"📖  {sum(r[2] for r in rows)} page(s) total")
    if tally["skipped_tracked"]:
        print(f"⏭️   {tally['skipped_tracked']} skipped — already have real day history")
    if tally["skipped_no_dates"]:
        print(f"⏭️   {tally['skipped_no_dates']} skipped — no finish date to attribute pages to")
    if tally["skipped_no_pages"]:
        print(f"⏭️   {tally['skipped_no_pages']} skipped — no page count")

    if not rows:
        print("\n✅  Nothing to do.")
        return
    if not args.apply:
        print("\n🔍  Dry run — nothing written. Re-run with --apply to commit.")
        return

    written = repo.add_reading_days(rows)
    print(f"\n✅  Wrote {written} row(s) with source='backfill'.")
    print("    Undo with: DELETE FROM reading_days WHERE source = 'backfill';")


if __name__ == "__main__":
    main()
