from __future__ import annotations

import csv
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from ..db import transaction
from ..repository import VALID_STATUSES, DataRepository
from ..utils import clamp_my_rating, parse_iso_date
from .catalog import list_books, upsert_book

BOOK_FIELDS = (
    "title",
    "author",
    "series",
    "series_number",
    "genres",
    "description",
    "page_count",
    "avg_rating",
    "rating_count",
    "review_count",
    "image_url",
    "similar_book_ids",
)
STATE_FIELDS = (
    "status",
    "current_page",
    "total_pages",
    "start_date",
    "finish_date",
    "my_rating",
    "notes",
)
CSV_COLUMNS = ("uid", *BOOK_FIELDS, *STATE_FIELDS)

LIST_FIELDS = {"genres", "similar_book_ids"}
LIST_SEPARATOR = ";"

# Scraped text is third-party, and a spreadsheet would run a cell starting with these as a formula.
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


@dataclass
class ImportResult:
    imported: int
    skipped: list[dict] = field(default_factory=list)


def _escape_formula(value: object) -> object:
    return f"'{value}" if isinstance(value, str) and value.startswith(FORMULA_PREFIXES) else value


def _unescape_formula(value: str) -> str:
    return value[1:] if value.startswith("'") and value[1:].startswith(FORMULA_PREFIXES) else value


def _export_row(book: dict, tracked: bool) -> dict:
    row = {"uid": book["id"], **{name: book[name] for name in BOOK_FIELDS}}
    for name in LIST_FIELDS:
        row[name] = f"{LIST_SEPARATOR} ".join(str(item) for item in book[name])
    if tracked:
        row.update({name: book[name] for name in STATE_FIELDS})
    return {name: _escape_formula(value) for name, value in row.items()}


def export_books_csv(root: Path, path: Path) -> int:
    """Write every catalog book to `path`; books never tracked have blank reading columns."""
    states = DataRepository(root).list_book_states()
    books = sorted(list_books(root), key=lambda b: (b["title"].casefold(), b["id"]))
    rows = [_export_row(book, book["id"] in states) for book in books]

    # The BOM is what makes Excel read the file as UTF-8.
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)


def _non_negative_int(raw: str) -> int:
    value = int(raw)
    if value < 0:
        raise ValueError
    return value


def _non_negative_float(raw: str) -> float:
    value = float(raw)
    if not math.isfinite(value) or value < 0:
        raise ValueError
    return value


def _list(raw: str) -> list[str]:
    return [item.strip() for item in raw.split(LIST_SEPARATOR) if item.strip()]


def _date(raw: str) -> str:
    parsed = parse_iso_date(raw)
    if not parsed:
        raise ValueError
    return parsed.isoformat()


def _status(raw: str) -> str:
    status = raw.lower()
    if status not in VALID_STATUSES:
        raise ValueError
    return status


def _my_rating(raw: str) -> float:
    return clamp_my_rating(_non_negative_float(raw))


# Anything not listed is plain text.
PARSERS: dict[str, Callable[[str], object]] = {
    "genres": _list,
    "similar_book_ids": _list,
    "page_count": _non_negative_int,
    "avg_rating": _non_negative_float,
    "rating_count": _non_negative_int,
    "review_count": _non_negative_int,
    "status": _status,
    "current_page": _non_negative_int,
    "total_pages": _non_negative_int,
    "start_date": _date,
    "finish_date": _date,
    "my_rating": _my_rating,
}


def _parse_fields(row: dict[str, str], names: tuple[str, ...]) -> dict:
    """Parse the non-blank cells: a blank cell or absent column leaves the stored value alone."""
    parsed = {}
    for name in names:
        raw = _unescape_formula((row.get(name) or "").strip())
        if not raw:
            continue
        try:
            parsed[name] = PARSERS.get(name, str)(raw)
        except ValueError:
            raise ValueError(f"invalid {name}: {raw!r}") from None
    return parsed


def _read_rows(path: Path) -> list[tuple[int, dict[str, str]]]:
    """Rows keyed by lowercased column name, numbered as a spreadsheet shows them."""
    try:
        with path.open(encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f)
            header = [name.strip().lower() for name in next(reader, [])]
            if "uid" not in header:
                raise ValueError('The CSV needs a "uid" column.')
            return [
                (number, dict(zip(header, cells)))
                for number, cells in enumerate(reader, start=2)
                if any(cell.strip() for cell in cells)
            ]
    except UnicodeDecodeError as e:
        raise ValueError("The file is not UTF-8 text.") from e
    except csv.Error as e:
        raise ValueError(f"Could not parse the CSV: {e}") from e


def import_books_csv(root: Path, path: Path) -> ImportResult:
    """Upsert each row by uid; bad rows are skipped and reported, and nothing is ever deleted."""
    rows = _read_rows(path)
    repo = DataRepository(root)
    with transaction(root) as conn:
        known_uids = {row["uid"] for row in conn.execute("SELECT uid FROM books")}

    result = ImportResult(imported=0)
    for number, row in rows:
        uid = _unescape_formula((row.get("uid") or "").strip())
        try:
            if not uid:
                raise ValueError("missing uid")
            book = _parse_fields(row, BOOK_FIELDS)
            state = _parse_fields(row, STATE_FIELDS)
            if uid not in known_uids and not book.get("title"):
                raise ValueError("a new book needs a title")
        except ValueError as e:
            result.skipped.append({"row": number, "reason": str(e)})
            continue

        if book:
            upsert_book(root, {"uid": uid, **book})
        if state:
            repo.upsert_book_state(uid, **state)
        known_uids.add(uid)
        result.imported += 1

    return result
