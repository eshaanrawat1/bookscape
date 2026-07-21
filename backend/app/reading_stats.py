from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo


def _to_int(value: object, default: int = 0) -> int:
    if value is None:
        return default
    if isinstance(value, int):
        return max(0, value)
    raw = str(value).strip().replace(",", "")
    digits = "".join(ch for ch in raw if ch.isdigit())
    if not digits:
        return default
    return max(0, int(digits))


def _parse_date_str(value: object) -> str:
    if value is None:
        return ""
    s = str(value).strip()
    if not s:
        return ""
    try:
        return date.fromisoformat(s).isoformat()
    except ValueError:
        return ""


def compute_reading_stats(entries: dict[str, dict], today: date | None = None) -> dict:
    now = today or date.today()
    rows = []
    for row in entries.values():
        finish = _parse_date_str((row or {}).get("finish_date"))
        status = str((row or {}).get("status") or "").strip().lower()
        if status != "done" or not finish:
            continue
        finish_d = date.fromisoformat(finish)
        pages = _to_int((row or {}).get("total_pages"), default=_to_int((row or {}).get("current_page"), default=0))
        rows.append({"finish_date": finish_d, "pages": pages})

    def for_period(period: str) -> tuple[list[dict], int]:
        if period == "daily":
            picked = [r for r in rows if r["finish_date"] == now]
            return picked, 1
        if period == "monthly":
            picked = [r for r in rows if r["finish_date"].year == now.year and r["finish_date"].month == now.month]
            return picked, now.day
        if period == "yearly":
            picked = [r for r in rows if r["finish_date"].year == now.year]
            return picked, now.timetuple().tm_yday
        picked = list(rows)
        if not picked:
            return picked, 1
        earliest = min(r["finish_date"] for r in picked)
        return picked, max(1, (now - earliest).days + 1)

    completion_days = sorted({r["finish_date"] for r in rows})
    streak = 0
    if completion_days:
        day = completion_days[-1]
        day_set = set(completion_days)
        streak = 1
        while (day - timedelta(days=1)) in day_set:
            day = day - timedelta(days=1)
            streak += 1

    out = {}
    for period in ("daily", "monthly", "yearly", "all"):
        picked, days_passed = for_period(period)
        unique_days = len({r["finish_date"] for r in picked})
        out[period] = {
            "totalBooksRead": len(picked),
            "totalPagesRead": sum(r["pages"] for r in picked),
            "daysReadStreak": streak,
            "daysRead": unique_days,
            "daysPassed": days_passed,
        }
    return out


def _default_daily_payload(timezone: str) -> dict:
    return {
        "snapshot": {},
        "reserve": {},
        "daily": {},
        "meta": {
            "version": 1,
            "timezone": timezone,
            "last_run_at": "",
            "last_processed_date": "",
        },
    }


@dataclass
class SnapshotRunResult:
    date: str
    mode: str
    pages_read: int
    books_completed: int
    books_touched: int
    skipped: bool
    reason: str
    last_run_at: str


class ReadingDailyStatsStore:
    def __init__(self, root: Path, timezone: str | None = None) -> None:
        tz = timezone or os.getenv("READING_SNAPSHOT_TIMEZONE", "America/Los_Angeles")
        self.tz = tz
        self.path = root / "user_data" / "reading_daily_stats.json"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self._write(_default_daily_payload(self.tz))

    def _read(self) -> dict:
        try:
            with self.path.open("r", encoding="utf-8") as f:
                payload = json.load(f) or {}
            if not isinstance(payload, dict):
                return _default_daily_payload(self.tz)
            payload.setdefault("snapshot", {})
            payload.setdefault("reserve", {})
            payload.setdefault("daily", {})
            payload.setdefault("meta", {})
            payload["meta"].setdefault("timezone", self.tz)
            payload["meta"].setdefault("version", 1)
            payload["meta"].setdefault("last_run_at", "")
            payload["meta"].setdefault("last_processed_date", "")
            return payload
        except Exception:
            return _default_daily_payload(self.tz)

    def _write(self, payload: dict) -> None:
        with self.path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)

    def list_daily(self) -> dict[str, dict]:
        payload = self._read()
        raw = payload.get("daily", {})
        if not isinstance(raw, dict):
            return {}
        out: dict[str, dict] = {}
        for k, row in raw.items():
            if not isinstance(row, dict):
                continue
            out[str(k)] = row
        return out
        

    @staticmethod
    def _normalize_entries(entries: dict[str, dict]) -> dict[str, dict]:
        current: dict[str, dict] = {}
        for book_id, row in (entries or {}).items():
            if not book_id or not isinstance(row, dict):
                continue
            current[str(book_id)] = {
                "current_page": _to_int(row.get("current_page"), default=0),
                "total_pages": _to_int(row.get("total_pages"), default=0),
                "status": str(row.get("status") or "not_started").strip().lower(),
                "finish_date": _parse_date_str(row.get("finish_date")),
            }
        return current

    @staticmethod
    def _compute_delta(prev_snapshot: dict[str, dict], curr_snapshot: dict[str, dict], day_str: str) -> dict:
        pages_delta = 0
        books_completed = 0
        books_touched = 0
        for book_id, cur in curr_snapshot.items():
            prev = prev_snapshot.get(book_id, {}) if isinstance(prev_snapshot.get(book_id), dict) else {}
            prev_page = _to_int(prev.get("current_page"), default=0)
            delta = max(0, _to_int(cur.get("current_page"), default=0) - prev_page)
            if delta > 0:
                pages_delta += delta
                books_touched += 1
            prev_status = str(prev.get("status") or "not_started").strip().lower()
            cur_status = str(cur.get("status") or "not_started").strip().lower()
            cur_finish = _parse_date_str(cur.get("finish_date"))
            done_transition = prev_status != "done" and cur_status == "done"
            done_on_day = prev_status != "done" and cur_finish == day_str
            if done_transition or done_on_day:
                books_completed += 1
        return {
            "pages_read": pages_delta,
            "books_completed": books_completed,
            "books_touched": books_touched,
        }


def build_activity_payload(daily_rows: dict[str, dict], today: date | None = None, lookback_days: int = 366) -> dict:
    now = today or date.today()
    start = now - timedelta(days=lookback_days - 1)
    dates = [start + timedelta(days=i) for i in range(lookback_days)]

    pages, completed, touched = [], [], []

    for d in dates:
        row = daily_rows.get(d.isoformat(), {}) if isinstance(daily_rows.get(d.isoformat()), dict) else {}
        pages.append(_to_int(row.get("pages_read"), default=0))
        completed.append(_to_int(row.get("books_completed"), default=0))
        touched.append(_to_int(row.get("books_touched"), default=0))

    days = [
        {
            "date": d.isoformat(),
            "pagesRead": pages[i],
            "booksCompleted": completed[i],
            "booksTouched": touched[i]
        }
        for i, d in enumerate(dates)
    ]

    total_pages_year = sum(pages)
    return {
        "days": days,
        "summary": {
            "totalPagesYear": total_pages_year,
        },
    }
