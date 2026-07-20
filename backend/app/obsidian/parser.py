from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
import yaml


def _normalize_name(value: object) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\[\[|\]\]", "", text).strip()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace(";", " ")
    text = text.replace("-", " ")
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


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


def _normalize_status(value: object) -> str:
    raw = re.sub(r"[\s_-]+", " ", str(value or "").strip().lower())
    raw = raw.replace("to read", "want to read")
    if raw in {"done", "finished", "finish", "completed", "complete", "read", "finished reading"}:
        return "done"
    if raw in {"reading", "continue reading", "in progress", "in progress reading", "currently reading", "continue", "ongoing", "progress"}:
        return "reading"
    if raw in {"want to read", "to read", "tbr", "not started", "notstarted", "not_started"}:
        return "not_started"
    return "not_started"


def _parse_frontmatter(md_text: str) -> dict:
    if not md_text.startswith("---"):
        return {}
    parts = md_text.split("---", 2)
    if len(parts) < 3:
        return {}
    raw_yaml = parts[1]
    try:
        out = yaml.safe_load(raw_yaml) or {}
    except Exception:
        return {}
    return out if isinstance(out, dict) else {}


def _extract_description(md_text: str) -> str:
    m = re.search(r"(?im)^##\s+Description\s*$", md_text)
    if not m:
        return ""
    rest = md_text[m.end():]
    next_heading = re.search(r"(?im)^##\s+", rest)
    block = rest[: next_heading.start()] if next_heading else rest
    lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
    return "\n".join(lines).strip()


def parse_book(path: Path) -> dict | None:
    """Parse a .md file into a book dict. Returns None if the file has no uid field."""
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return None

    fm = _parse_frontmatter(text)
    if not fm or not fm.get("uid"):
        return None

    uid = str(fm.get("uid") or "").strip()
    title = _normalize_name(fm.get("title") or path.stem)
    author = _normalize_name(fm.get("author") or "")

    total_pages = int(fm.get("total_pages") or 0)
    current_page = int(fm.get("current_page") or 0)

    finish_date = _parse_date_str(fm.get("finish_date"))
    start_date = _parse_date_str(fm.get("start_date"))

    status = _normalize_status(fm.get("status"))

    genres_raw = fm.get("genres") or ""
    if isinstance(genres_raw, list):
        genres = [_normalize_name(g) for g in genres_raw if _normalize_name(g)]
    else:
        genres = [g.strip() for g in str(genres_raw).split(",") if g.strip()]

    description = str(fm.get("description") or "").strip()
    if not description:
        description = _extract_description(text)

    return {
        "id": uid,
        "uid": uid,
        "title": title,
        "author": author,
        "status": status,
        "total_pages": total_pages,
        "current_page": current_page,
        "start_date": start_date,
        "finish_date": finish_date,
        "image_url": str(fm.get("image") or "").strip(),
        "book_rating": str(fm.get("rating_value") or "").strip(),
        "book_rating_count": str(fm.get("rating_count") or "").strip(),
        "book_review_count": str(fm.get("review_count") or "").strip(),
        "genres": genres,
        "genre": genres[0] if genres else "unknown",
        "description": description,
        "source_path": str(path),
        "updated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }
