from __future__ import annotations

import math
import re
import unicodedata
from datetime import date

MY_RATING_MAX = 5.0


def normalize_text(value: object) -> str:
    """Normalize text by removing unicode combining marks and special characters."""
    text = str(value or "").strip()
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^\w\s]", " ", text)
    return " ".join(text.lower().split())


def split_author_field(value: object) -> list[str]:
    """Split author field by common separators (&, and, with, x, ;, /)."""
    raw = str(value or "").strip()
    if not raw:
        return []
    parts = re.split(r"\s+(?:&|and|with|x)\s+|[;/]", raw, flags=re.IGNORECASE)
    return [p.strip() for p in parts if p.strip()] or [raw]


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
