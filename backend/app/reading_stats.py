from __future__ import annotations

from datetime import date


def _to_int(value: object) -> int:
    if value is None:
        return default

    raw = str(value).strip().replace(",", "")
    digits = "".join(ch for ch in raw if ch.isdigit())
    return max(0, int(digits)) if digits else 0


def _parse_date(value: object) -> date | None:
    try:
        s = str(value).strip()
        return date.fromisoformat(s) if s else None
    except Exception:
        return None


def compute_reading_stats(entries: dict[str, dict], today: date | None = None) -> dict:
    now = today or date.today()

    rows = []
    for row in entries.values():
        finish = _parse_date(row.get("finish_date"))
        status = str(row.get("status") or "").strip().lower()
        if status != "done" or not finish:
            continue

        pages = _to_int(row.get("total_pages"))
        rows.append({"finish_date": finish, "pages": pages})

    def for_period(period: str) -> tuple[list[dict], int]:
        if period == "daily":
            return [r for r in rows if r["finish_date"] == now], 1

        if period == "monthly":
            picked = [r for r in rows if r["finish_date"].year == now.year and r["finish_date"].month == now.month]
            return picked, now.day

        if period == "yearly":
            picked = [r for r in rows if r["finish_date"].year == now.year]
            return picked, now.timetuple().tm_yday

        if not rows:
            return [], 1

        earliest = min(r["finish_date"] for r in rows)
        return rows, max(1, (now - earliest).days + 1)

    out = {}
    for period in ("daily", "monthly", "yearly", "all"):
        picked, days_passed = for_period(period)
        out[period] = {
            "totalBooksRead": len(picked),
            "totalPagesRead": sum(r["pages"] for r in picked),
            "daysRead": len({r["finish_date"] for r in picked}),
            "daysPassed": days_passed,
        }
    return out