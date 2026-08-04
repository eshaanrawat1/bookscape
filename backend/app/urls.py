from __future__ import annotations

import re
from urllib.parse import ParseResult, urlparse

GOODREADS_HOSTS = frozenset({"goodreads.com", "www.goodreads.com"})

# Every cover in the catalog is served by Amazon's media CDN today; the
# gr-assets names are Goodreads' older cover domains, kept because links stored
# by earlier scrapes still point at them.
COVER_HOSTS = frozenset({
    "m.media-amazon.com",
    "images-na.ssl-images-amazon.com",
    "i.gr-assets.com",
    "s.gr-assets.com",
    "images.gr-assets.com",
})

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


def is_allowed_cover_url(raw: object) -> bool:
    """Whether the color extractor may fetch this cover.

    Cover URLs arrive from the scraper and from Obsidian frontmatter, neither of
    which is a trusted source of hostnames, and the extractor runs unattended in
    a background worker — so a hostile one would be fetched with nobody
    watching. https only: a cover is not worth a cleartext request.
    """
    parsed = _parse(raw)
    if parsed is None or parsed.scheme != "https":
        return False
    return _hostname(parsed) in COVER_HOSTS
