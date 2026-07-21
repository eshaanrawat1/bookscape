from __future__ import annotations

from datetime import date

from .utils import parse_iso_date, to_int


def compute_reading_stats(entries: dict[str, dict], today: date | None = None) -> dict:
    now = today or date.today()

    rows = []
    for row in entries.values():
        finish = parse_iso_date(row.get("finish_date"))
        status = str(row.get("status") or "").strip().lower()
        if status != "done" or not finish:
            continue

        pages = to_int(row.get("total_pages"))
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