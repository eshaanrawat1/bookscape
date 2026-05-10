#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description="Standalone reading snapshot job for cron/launchd.")
    ap.add_argument("--mode", choices=["login-backup", "nightly-finalize"], required=True)
    ap.add_argument("--root", default=str(Path(__file__).resolve().parents[1]), help="Atlas repo root")
    ap.add_argument("--force", action="store_true", help="Force finalize overwrite for nightly mode")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    # Ensure repo-local imports work when launched from cron/launchd.
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from api.app.obsidian_sync import load_obsidian_progress_entries
    from api.app.reading_stats import ReadingDailyStatsStore

    store = ReadingDailyStatsStore(root)
    entries, source = load_obsidian_progress_entries()

    if args.mode == "login-backup":
        out = store.run_login_backup(entries)
    else:
        out = store.run_nightly_finalize(entries, force=args.force)

    print(json.dumps({"ok": True, "mode": args.mode, "source": source, "result": out}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
