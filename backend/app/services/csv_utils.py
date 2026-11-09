from __future__ import annotations

import math

from ..utils import clamp_my_rating, parse_iso_date
from .catalog import VALID_STATUSES

LIST_SEPARATOR = ";"


def parse_non_negative_int(raw: str) -> int:
    value = int(raw)
    if value < 0:
        raise ValueError
    return value


def parse_non_negative_float(raw: str) -> float:
    value = float(raw)
    if not math.isfinite(value) or value < 0:
        raise ValueError
    return value


def parse_list(raw: str) -> list[str]:
    return [item.strip() for item in raw.split(LIST_SEPARATOR) if item.strip()]


def parse_date(raw: str) -> str:
    parsed = parse_iso_date(raw)
    if not parsed:
        raise ValueError
    return parsed.isoformat()


def parse_status(raw: str) -> str:
    status = raw.lower()
    if status not in VALID_STATUSES:
        raise ValueError
    return status


def parse_my_rating(raw: str) -> float:
    return clamp_my_rating(parse_non_negative_float(raw))
