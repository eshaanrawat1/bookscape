from __future__ import annotations

import json
import re
import unicodedata
from datetime import date
from pathlib import Path


# JSON

def read_json(path: Path, default: dict | list | None = None) -> dict | list:
    if not path.exists():
        return default if default is not None else {}
    try:
        with path.open("r", encoding="utf-8") as f:
            payload = json.load(f)
        return payload if isinstance(payload, (dict, list)) else (default if default is not None else {})
    except Exception:
        return default if default is not None else {}


def write_json(path: Path, payload: dict | list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)



# Text Normalization from obsidian fields

def normalize_text(value: object) -> str:
    """Normalize text by removing unicode combining marks and special characters."""
    text = str(value or "").strip()
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^\w\s]", " ", text)
    return " ".join(text.lower().split())


def normalize_author(value: object) -> str:
    """Normalize author name for comparison/search."""
    return normalize_text(value)


def split_author_field(value: object) -> list[str]:
    """Split author field by common separators (&, and, with, x, ;, /)."""
    raw = str(value or "").strip()
    if not raw:
        return []
    parts = re.split(r"\s+(?:&|and|with|x)\s+|[;/]", raw, flags=re.IGNORECASE)
    return [p.strip() for p in parts if p.strip()] or [raw]


# Date Parsing

def parse_iso_date(value: object) -> date | None:
    """Parse ISO date string (YYYY-MM-DD) to date object."""
    raw = str(value or "").strip()
    try:
        return date.fromisoformat(raw[:10]) if raw else None
    except Exception:
        return None


def parse_iso_date_string(value: object) -> str:
    """Parse ISO date string"""
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        return date.fromisoformat(raw).isoformat()
    except Exception:
        return ""



# Integer Parsing

def to_int(value: object, default: int = 0) -> int:
    """Safely convert value to int"""
    if value is None:
        return default
    
    raw = str(value).strip().replace(",", "")
    digits = "".join(ch for ch in raw if ch.isdigit())
    return max(0, int(digits)) if digits else default
