from __future__ import annotations

import re
import unicodedata
from pathlib import Path
import yaml

from ...utils import parse_iso_date_string


def _normalize_name(value: object) -> str:
    """Strip Obsidian wiki-link brackets and normalize unicode (preserve casing
    and punctuation — titles/authors round-trip through Push, so periods,
    apostrophes, and hyphens must survive a parse, not just accented letters)."""
    text = str(value or "").strip()
    text = re.sub(r"\[\[|\]\]", "", text).strip()
    # Normalize unicode but preserve original casing
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", text).strip()


def _parse_frontmatter(md_text: str) -> dict:
    if not md_text.startswith("---"):
        return {}
    parts = md_text.split("---", 2)
    if len(parts) < 3:
        return {}
    try:
        out = yaml.safe_load(parts[1]) or {}
    except Exception:
        return {}
    return out if isinstance(out, dict) else {}


def _extract_section(md_text: str, heading: str) -> str:
    m = re.search(rf"(?im)^##\s+{heading}\s*$", md_text)
    if not m:
        return ""
    rest = md_text[m.end():]
    next_heading = re.search(r"(?im)^##\s+", rest)
    block = rest[: next_heading.start()] if next_heading else rest
    return "\n".join(ln.strip() for ln in block.splitlines() if ln.strip()).strip()


def _extract_description(md_text: str) -> str:
    return _extract_section(md_text, "Description")


def _extract_notes(md_text: str) -> str:
    return _extract_section(md_text, "Notes")


def parse_book(path: Path) -> dict | None:
    """Parse a single Obsidian .md file into a book dict."""
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return None

    fm = _parse_frontmatter(text)
    if not fm or not fm.get("uid"):
        return None

    genres_raw = fm.get("genres") or ""
    genres = (
        [_normalize_name(g) for g in genres_raw if _normalize_name(g)]
        if isinstance(genres_raw, list)
        else [g.strip() for g in str(genres_raw).split(",") if g.strip()]
    )

    return {
        "uid":              str(fm["uid"]),
        "title":            _normalize_name(fm.get("title") or path.stem),
        "author":           _normalize_name(fm.get("author") or ""),
        "status":           str(fm.get("status") or "not_started"),
        "total_pages":      int(fm.get("total_pages") or 0),
        "current_page":     int(fm.get("current_page") or 0),
        "start_date":       parse_iso_date_string(fm.get("start_date")),
        "finish_date":      parse_iso_date_string(fm.get("completed_date")),
        "image_url":        str(fm.get("image") or "").strip(),
        "rating":           float(fm.get("rating_value") or 0),
        "rating_count":     int(fm.get("rating_count") or 0),
        "review_count":     int(fm.get("review_count") or 0),
        "genres":           genres,
        "genre":            genres[0] if genres else "unknown",
        "description":      str(fm.get("description") or "").strip() or _extract_description(text),
        "notes":            _extract_notes(text),
    }