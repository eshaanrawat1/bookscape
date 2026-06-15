from __future__ import annotations

import difflib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "data" / "books.json"
TARGET_PATHS = [
    ROOT / "user_data" / "all_books.json",
    ROOT / "user_data" / "obsidian_books.json",
]


def _normalize_text(value: object) -> str:
    return " ".join(re.sub(r"[^\w\s]", " ", str(value or "").strip().lower()).split())


def _load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        payload = json.load(f)
    return payload if isinstance(payload, dict) else {}


def _write_json(path: Path, payload: dict) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


@dataclass(frozen=True)
class CatalogIndex:
    by_uid: dict[str, dict]
    by_title_author: dict[tuple[str, str], dict]
    by_title: dict[str, list[dict]]


def _load_catalog_index() -> CatalogIndex:
    if not CATALOG_PATH.exists():
        return CatalogIndex({}, {}, {})

    with CATALOG_PATH.open("r", encoding="utf-8") as f:
        payload = json.load(f)
    if isinstance(payload, dict):
        rows = list(payload.values())
    elif isinstance(payload, list):
        rows = payload
    else:
        rows = []

    by_uid: dict[str, dict] = {}
    by_title_author: dict[tuple[str, str], dict] = {}
    by_title: dict[str, list[dict]] = {}

    for row in rows:
        if not isinstance(row, dict):
            continue
        uid = str(row.get("uid") or "").strip()
        if not uid:
            continue
        by_uid[uid] = row
        title_key = _normalize_text(row.get("title"))
        author_key = _normalize_text(row.get("author"))
        if title_key and author_key:
            by_title_author[(title_key, author_key)] = row
        if title_key:
            by_title.setdefault(title_key, []).append(row)

    return CatalogIndex(by_uid, by_title_author, by_title)


def _resolve_catalog_uid(row: dict, catalog: CatalogIndex) -> tuple[str, str]:
    catalog_uid = str(row.get("catalog_uid") or "").strip()
    dataset_book_id = str(row.get("dataset_book_id") or "").strip()

    if catalog_uid and catalog_uid in catalog.by_uid:
        return catalog_uid, "catalog_uid"
    if dataset_book_id and dataset_book_id in catalog.by_uid:
        return dataset_book_id, "dataset_book_id"

    title_key = _normalize_text(row.get("title"))
    author_key = _normalize_text(row.get("author"))
    if title_key and author_key:
        match = catalog.by_title_author.get((title_key, author_key))
        if match:
            return str(match["uid"]), "exact_title_author"

    if not title_key:
        return "", "unlinked"

    candidates = catalog.by_title.get(title_key, [])
    if not candidates:
        candidates = list(catalog.by_uid.values())

    best_uid = ""
    best_score = 0.0
    for candidate in candidates:
        candidate_title = _normalize_text(candidate.get("title"))
        candidate_author = _normalize_text(candidate.get("author"))
        title_score = difflib.SequenceMatcher(None, title_key, candidate_title).ratio()
        author_score = difflib.SequenceMatcher(None, author_key, candidate_author).ratio() if author_key and candidate_author else 0.0
        combined = (title_score * 0.82) + (author_score * 0.18)

        strong_title = title_score >= 0.965
        strong_pair = title_score >= 0.91 and (not author_key or author_score >= 0.86)
        if not (strong_title or strong_pair):
            continue
        if combined > best_score:
            best_score = combined
            best_uid = str(candidate.get("uid") or "")

    if best_uid:
        return best_uid, "fuzzy_title_author"

    return "", "unlinked"


def _migrate_payload(payload: dict, catalog: CatalogIndex) -> dict:
    books = payload.get("books", {})
    if not isinstance(books, dict):
        return payload

    migrated: dict[str, dict] = {}
    counts = {"catalog_uid": 0, "dataset_book_id": 0, "exact_title_author": 0, "fuzzy_title_author": 0, "unlinked": 0}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    for book_id, row in books.items():
        if not isinstance(row, dict):
            continue
        next_row = dict(row)
        resolved_uid, method = _resolve_catalog_uid(next_row, catalog)
        counts[method] = counts.get(method, 0) + 1

        if resolved_uid:
            next_row["catalog_uid"] = resolved_uid
            next_row["dataset_book_id"] = resolved_uid if not str(next_row.get("dataset_book_id") or "").strip() else str(next_row.get("dataset_book_id") or "").strip()
            next_row["dataset_link_type"] = str(next_row.get("dataset_link_type") or "backfilled").strip() or "backfilled"
            next_row["dataset_linked_at"] = str(next_row.get("dataset_linked_at") or now).strip() or now
        else:
            next_row["catalog_uid"] = ""
            next_row["dataset_book_id"] = ""
            next_row["dataset_link_type"] = ""
            next_row["dataset_linked_at"] = ""
            counts["unlinked"] += 1

        migrated[str(book_id)] = next_row

    payload["books"] = migrated
    payload["count"] = len(migrated)
    payload.setdefault("generated_at", now)
    payload["migrated_at"] = now
    payload["schema_version"] = 2
    payload["migration_summary"] = counts
    return payload


def main() -> int:
    catalog = _load_catalog_index()
    if not catalog.by_uid:
        raise SystemExit(f"Catalog not found or empty: {CATALOG_PATH}")

    for path in TARGET_PATHS:
        if not path.exists():
            print(f"skip {path}: missing")
            continue
        payload = _load_json(path)
        migrated = _migrate_payload(payload, catalog)
        _write_json(path, migrated)
        summary = migrated.get("migration_summary", {})
        print(
            f"migrated {path.name}: "
            f"linked={summary.get('catalog_uid', 0) + summary.get('dataset_book_id', 0) + summary.get('exact_title_author', 0) + summary.get('fuzzy_title_author', 0)}, "
            f"unlinked={summary.get('unlinked', 0)}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
