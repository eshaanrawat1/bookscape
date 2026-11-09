from __future__ import annotations

import math
from datetime import date

MY_RATING_MAX = 5.0


# Date Parsing

def parse_iso_date(value: object) -> date | None:
    raw = str(value or "").strip()
    try:
        return date.fromisoformat(raw[:10]) if raw else None
    except Exception:
        return None

def parse_iso_date_string(value: object) -> str:
    d = parse_iso_date(value)
    return d.isoformat() if d else ""


def clamp_my_rating(value: object) -> float:
    """Coerce a score to 0-5 with two decimals; anything unreadable is 0 ("not rated yet")."""
    try:
        rating = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(rating):
        return 0.0
    return round(min(MY_RATING_MAX, max(0.0, rating)), 2)
