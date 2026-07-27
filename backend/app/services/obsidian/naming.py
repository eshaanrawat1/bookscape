from __future__ import annotations

import re

_INVALID_CHARS = re.compile(r'[\\/:*?"<>|]')
_WHITESPACE = re.compile(r"\s+")


def safe_filename(title: str) -> str:
    """Sanitize a book title into a filesystem-safe .md filename (used to derive
    a filename before one has ever been recorded for a book)."""
    clean = _INVALID_CHARS.sub("", str(title or "")).strip()
    clean = _WHITESPACE.sub(" ", clean)
    return f"{clean or 'Untitled'}.md"
