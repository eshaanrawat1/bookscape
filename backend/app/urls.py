from __future__ import annotations

import re
from urllib.parse import ParseResult, urlparse

GOODREADS_HOSTS = frozenset({"goodreads.com", "www.goodreads.com"})

_BOOK_PATH = re.compile(r"^/book/show/(\d+)")


def _parse(raw: object) -> ParseResult | None:
    try:
        return urlparse(str(raw or "").strip())
    except ValueError:
        return None


def _hostname(parsed: ParseResult) -> str:
    """The host a request would actually be sent to, lowercased.

    Reads `.hostname` rather than `.netloc` deliberately: netloc carries
    userinfo, so `https://www.goodreads.com@evil.example/` contains the string
    "www.goodreads.com" while resolving to evil.example. `.hostname` is the part
    that decides where the bytes go.
    """
    try:
        host = parsed.hostname
    except ValueError:
        return ""
    return host.lower() if host else ""


def canonical_book_url(raw: object) -> tuple[str, str]:
    """Validate a pasted Goodreads book link -> (book_id, url_to_fetch).

    The returned URL is rebuilt from the parsed id rather than passed through,
    so nothing the caller wrote — query string, fragment, redirect parameters,
    embedded credentials — reaches the browser the scraper drives.

    Raises ValueError carrying a message meant for the user.
    """
    parsed = _parse(raw)
    if parsed is None or parsed.scheme not in {"http", "https"}:
        raise ValueError(
            "That doesn't look like a web link — paste the address of a "
            "goodreads.com book page."
        )

    if _hostname(parsed) not in GOODREADS_HOSTS:
        raise ValueError(
            "Bookscape only imports from goodreads.com — that link points "
            "somewhere else."
        )

    match = _BOOK_PATH.match(parsed.path)
    if not match:
        raise ValueError(
            "That link didn't resolve — check it points to a book page, not an "
            "author or a list."
        )

    book_id = match.group(1)
    return book_id, f"https://www.goodreads.com/book/show/{book_id}"
