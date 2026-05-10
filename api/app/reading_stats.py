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

    def run_snapshot(
        self,
        entries: dict[str, dict],
        *,
        run_date: date | None = None,
        force: bool = False,
        mode: str = "manual",
    ) -> SnapshotRunResult:
        tz = ZoneInfo(self.tz)
        now_dt = datetime.now(tz)
        day = run_date or now_dt.date()
        day_str = day.isoformat()
        payload = self._read()
        meta = payload.setdefault("meta", {})
        if mode == "scheduled" and not force and meta.get("last_processed_date") == day_str:
            return SnapshotRunResult(
                date=day_str,
                mode=mode,
                pages_read=0,
                books_completed=0,
                books_touched=0,
                skipped=True,
                reason="already_processed",
                last_run_at=str(meta.get("last_run_at") or ""),
            )

        snapshot = payload.setdefault("snapshot", {})
        daily = payload.setdefault("daily", {})
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

        pages_delta = 0
        books_completed = 0
        books_touched = 0

        for book_id, cur in current.items():
            prev = snapshot.get(book_id, {}) if isinstance(snapshot.get(book_id), dict) else {}
            prev_page = _to_int(prev.get("current_page"), default=0)
            delta = max(0, cur["current_page"] - prev_page)
            if delta > 0:
                pages_delta += delta
                books_touched += 1

            prev_status = str(prev.get("status") or "not_started").strip().lower()
            done_transition = prev_status != "done" and cur["status"] == "done"
            done_on_day = prev_status != "done" and cur["finish_date"] == day_str
            if done_transition or done_on_day:
                books_completed += 1

        existing = daily.get(day_str, {}) if isinstance(daily.get(day_str), dict) else {}
        daily[day_str] = {
            "pages_read": _to_int(existing.get("pages_read"), default=0) + pages_delta,
            "books_completed": _to_int(existing.get("books_completed"), default=0) + books_completed,
            "books_touched": _to_int(existing.get("books_touched"), default=0) + books_touched,
            "updated_at": now_dt.isoformat(timespec="seconds"),
        }
        payload["snapshot"] = current
        meta["last_run_at"] = now_dt.isoformat(timespec="seconds")
        meta["last_processed_date"] = day_str
        meta["timezone"] = self.tz
        meta["version"] = 1
        payload["meta"] = meta
        self._write(payload)
        return SnapshotRunResult(
            date=day_str,
            mode=mode,
            pages_read=pages_delta,
            books_completed=books_completed,
            books_touched=books_touched,
            skipped=False,
            reason="ok",
            last_run_at=str(meta.get("last_run_at") or ""),
        )

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

    def run_login_backup(self, entries: dict[str, dict], *, run_date: date | None = None) -> dict:
        """
        Called at first machine-open/login run for a day.
        - Finalizes previous day with fallback reserve snapshot if nightly was missed.
        - Stores today's reserve snapshot (once).
        """
        tz = ZoneInfo(self.tz)
        now_dt = datetime.now(tz)
        day = run_date or now_dt.date()
        day_str = day.isoformat()
        prev_day_str = (day - timedelta(days=1)).isoformat()
        payload = self._read()
        snapshot = payload.setdefault("snapshot", {})
        reserve = payload.setdefault("reserve", {})
        daily = payload.setdefault("daily", {})

        # Fallback finalize for missed nightly run (yesterday only).
        fallback_applied = False
        if prev_day_str not in daily and isinstance(reserve.get(prev_day_str), dict):
            prev_res = reserve.get(prev_day_str, {})
            reserve_snapshot = prev_res.get("snapshot", {})
            if isinstance(reserve_snapshot, dict):
                delta = self._compute_delta(snapshot if isinstance(snapshot, dict) else {}, reserve_snapshot, prev_day_str)
                daily[prev_day_str] = {
                    **delta,
                    "updated_at": now_dt.isoformat(timespec="seconds"),
                    "source": "fallback_login",
                }
                payload["snapshot"] = reserve_snapshot
                fallback_applied = True

        if day_str not in reserve:
            curr_snapshot = self._normalize_entries(entries)
            reserve[day_str] = {
                "snapshot": curr_snapshot,
                "taken_at": now_dt.isoformat(timespec="seconds"),
            }

        payload["reserve"] = reserve
        payload["daily"] = daily
        meta = payload.setdefault("meta", {})
        meta["last_run_at"] = now_dt.isoformat(timespec="seconds")
        meta["timezone"] = self.tz
        payload["meta"] = meta
        self._write(payload)
        return {
            "date": day_str,
            "mode": "login_backup",
            "fallback_applied": fallback_applied,
            "reserve_taken": True,
        }

    def run_nightly_finalize(self, entries: dict[str, dict], *, run_date: date | None = None, force: bool = False) -> dict:
        """
        Finalize today's daily record from reserve(start-of-day) -> current(end-of-day).
        """
        tz = ZoneInfo(self.tz)
        now_dt = datetime.now(tz)
        day = run_date or now_dt.date()
        day_str = day.isoformat()
        payload = self._read()
        snapshot = payload.setdefault("snapshot", {})
        reserve = payload.setdefault("reserve", {})
        daily = payload.setdefault("daily", {})

        if day_str in daily and not force:
            return {"date": day_str, "mode": "nightly_finalize", "skipped": True, "reason": "already_finalized"}

        current = self._normalize_entries(entries)
        baseline = snapshot if isinstance(snapshot, dict) else {}
        if isinstance(reserve.get(day_str), dict):
            reserve_snap = reserve.get(day_str, {}).get("snapshot", {})
            if isinstance(reserve_snap, dict):
                baseline = reserve_snap

        delta = self._compute_delta(baseline, current, day_str)
        daily[day_str] = {
            **delta,
            "updated_at": now_dt.isoformat(timespec="seconds"),
            "source": "nightly_finalize",
        }
        payload["snapshot"] = current
        if day_str in reserve:
            del reserve[day_str]
        payload["reserve"] = reserve
        payload["daily"] = daily
        meta = payload.setdefault("meta", {})
        meta["last_run_at"] = now_dt.isoformat(timespec="seconds")
        meta["last_processed_date"] = day_str
        meta["timezone"] = self.tz
        payload["meta"] = meta
        self._write(payload)
        return {"date": day_str, "mode": "nightly_finalize", "skipped": False, **delta}


def _intensity_levels(values: list[int]) -> list[int]:
    non_zero = sorted([v for v in values if v > 0])
    if not non_zero:
        return [0 for _ in values]
    p25 = non_zero[max(0, int(len(non_zero) * 0.25) - 1)]
    p50 = non_zero[max(0, int(len(non_zero) * 0.50) - 1)]
    p75 = non_zero[max(0, int(len(non_zero) * 0.75) - 1)]
    p90 = non_zero[max(0, int(len(non_zero) * 0.90) - 1)]
    out = []
    for v in values:
        if v <= 0:
            out.append(0)
        elif v <= p25:
            out.append(1)
        elif v <= p50:
            out.append(2)
        elif v <= p75:
            out.append(3)
        elif v <= p90:
            out.append(4)
        else:
            out.append(5)
    return out


def build_activity_payload(daily_rows: dict[str, dict], today: date | None = None, lookback_days: int = 366) -> dict:
    now = today or date.today()
    start = now - timedelta(days=lookback_days - 1)
    dates = [start + timedelta(days=i) for i in range(lookback_days)]
    pages = []
    completed = []
    touched = []
    for d in dates:
        row = daily_rows.get(d.isoformat(), {}) if isinstance(daily_rows.get(d.isoformat()), dict) else {}
        pages.append(_to_int(row.get("pages_read"), default=0))
        completed.append(_to_int(row.get("books_completed"), default=0))
        touched.append(_to_int(row.get("books_touched"), default=0))
    levels = _intensity_levels(pages)
    days = [
        {
            "date": d.isoformat(),
            "pagesRead": pages[i],
            "booksCompleted": completed[i],
            "booksTouched": touched[i],
            "intensityLevel": levels[i],
        }
        for i, d in enumerate(dates)
    ]

    active_days = sum(1 for x in pages if x > 0)
    day_set = {d for i, d in enumerate(dates) if pages[i] > 0}
    cur_streak = 0
    probe = now
    while probe in day_set:
        cur_streak += 1
        probe = probe - timedelta(days=1)
    longest = 0
    run = 0
    for d in dates:
        if d in day_set:
            run += 1
            longest = max(longest, run)
        else:
            run = 0
    total_pages_year = sum(pages)
    return {
        "days": days,
        "summary": {
            "activeDays": active_days,
            "currentStreak": cur_streak,
            "longestStreak": longest,
            "totalPagesYear": total_pages_year,
        },
    }
