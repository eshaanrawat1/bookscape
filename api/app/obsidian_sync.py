from __future__ import annotations

import json
import os
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np
import yaml

from pipeline.embed_books import build_text_block, generate_embeddings

DEFAULT_OBSIDIAN_VAULT = Path("~/Obsidian/Books")


@dataclass
class SyncResult:
    scanned_files: int
    parsed_books: int
    created_books: int
    updated_books: int
    updated_progress_entries: int
    removed_bracket_author_entries: int
    vault_path: str
    preview_path: str
    dry_run: bool
    proposed_books: list[dict]
    periods: dict


def _ignored_path(root: Path) -> Path:
    return root / "user_data" / "obsidian_sync_ignored.json"


def _load_ignored_keys(root: Path) -> set[str]:
    path = _ignored_path(root)
    if not path.exists():
        return set()
    try:
        with path.open("r", encoding="utf-8") as f:
            payload = json.load(f) or {}
        keys = payload.get("keys", [])
        if not isinstance(keys, list):
            return set()
        return {str(k) for k in keys if str(k).strip()}
    except Exception:
        return set()


def _save_ignored_keys(root: Path, keys: set[str]) -> None:
    path = _ignored_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"keys": sorted(keys), "updated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z"}
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


def _slugify(text: str) -> str:
    s = (text or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s or "book"


def _normalize_name(value: object) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\[\[|\]\]", "", text).strip()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace(";", " ")
    text = text.replace("-", " ")
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    text = re.sub(r"\s+", " ", text)
    return text


def _norm_key(title: object, author: object) -> str:
    t = re.sub(r"\s+", " ", _normalize_name(title).lower())
    a = re.sub(r"\s+", " ", _normalize_name(author).lower())
    return f"{t}::{a}"


def _hamming_similarity(a: str, b: str) -> float:
    """
    Normalized Hamming similarity over padded strings.
    Returns 1.0 for exact match, 0.0 for total mismatch.
    """
    a = a or ""
    b = b or ""
    n = max(len(a), len(b))
    if n == 0:
        return 1.0
    pa = a.ljust(n)
    pb = b.ljust(n)
    mismatches = sum(1 for i in range(n) if pa[i] != pb[i])
    return max(0.0, 1.0 - (mismatches / n))


def _is_probable_duplicate(key: str, existing_keys: set[str], threshold: float = 0.95) -> bool:
    if key in existing_keys:
        return True
    for candidate in existing_keys:
        if _hamming_similarity(key, candidate) >= threshold:
            return True
    return False


def _to_int(value: object, default: int = 0) -> int:
    if value is None:
        return default
    if isinstance(value, int):
        return max(0, value)
    raw = str(value).strip().replace(",", "")
    m = re.search(r"\d+", raw)
    if not m:
        return default
    return max(0, int(m.group(0)))


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
    """
    Extract text under `## Description` until the next heading.
    """
    m = re.search(r"(?im)^##\s+Description\s*$", md_text)
    if not m:
        return ""
    rest = md_text[m.end():]
    next_heading = re.search(r"(?im)^##\s+", rest)
    block = rest[: next_heading.start()] if next_heading else rest
    lines = [ln.strip() for ln in block.splitlines()]
    lines = [ln for ln in lines if ln]
    return "\n".join(lines).strip()


def _extract_book(path: Path, fm: dict) -> dict:
    title = _normalize_name(fm.get("title") or path.stem)
    author = _normalize_name(fm.get("author"))
    book_id = _slugify(fm.get("id") or f"{title}-{author}")
    status_raw = str(fm.get("status") or "").strip().lower()
    if status_raw == "done":
        status = "done"
    elif status_raw == "reading":
        status = "reading"
    else:
        status = "not_started"

    total_pages = _to_int(fm.get("total_pages"), default=0)
    current_page = _to_int(fm.get("current_page"), default=0)
    if status == "done" and total_pages > 0:
        current_page = total_pages
    elif total_pages > 0:
        current_page = min(current_page, total_pages)

    start_date = _parse_date_str(fm.get("start_date"))
    finish_date = _parse_date_str(fm.get("completed_date") or fm.get("finish_date"))

    genres_raw = fm.get("genres") or ""
    if isinstance(genres_raw, list):
        genres = [_normalize_name(g) for g in genres_raw if _normalize_name(g)]
    else:
        genres = [_normalize_name(g) for g in str(genres_raw).split(",") if _normalize_name(g)]
    primary_genre = genres[0] if genres else "unknown"

    description = str(fm.get("description") or "").strip()
    if not description:
        try:
            md_text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            md_text = ""
        description = _extract_description(md_text)

    return {
        "id": book_id,
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
        "genre": primary_genre,
        "description": description,
        "source_path": str(path),
        "updated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }


def _load_existing_norm_keys(root: Path) -> set[str]:
    keys: set[str] = set()
    points_path = root / "artifacts" / "books_globe.json"
    if points_path.exists():
        try:
            with points_path.open("r", encoding="utf-8") as f:
                payload = json.load(f)
            for row in payload.get("points", []):
                keys.add(_norm_key(row.get("title"), row.get("author")))
        except Exception:
            pass
    obsidian_books_path = root / "user_data" / "obsidian_books.json"
    if obsidian_books_path.exists():
        try:
            with obsidian_books_path.open("r", encoding="utf-8") as f:
                payload = json.load(f) or {}
            books = payload.get("books", {})
            if isinstance(books, dict):
                for row in books.values():
                    if not isinstance(row, dict):
                        continue
                    keys.add(_norm_key(row.get("title"), row.get("author")))
        except Exception:
            pass
    all_books_path = root / "user_data" / "all_books.json"
    if all_books_path.exists():
        try:
            with all_books_path.open("r", encoding="utf-8") as f:
                payload = json.load(f) or {}
            books = payload.get("books", {})
            if isinstance(books, dict):
                for row in books.values():
                    if not isinstance(row, dict):
                        continue
                    keys.add(_norm_key(row.get("title"), row.get("author")))
        except Exception:
            pass
    return keys


def _load_existing_embeddings(root: Path) -> tuple[np.ndarray | None, list[str]]:
    emb_path = root / "artifacts" / "embeddings.npy"
    ids_path = root / "artifacts" / "book_ids.npy"
    if not emb_path.exists() or not ids_path.exists():
        return None, []
    try:
        embs = np.load(emb_path).astype(np.float32)
        ids = np.load(ids_path, allow_pickle=True).tolist()
        return embs, [str(x) for x in ids]
    except Exception:
        return None, []


def _load_book_by_id(root: Path) -> dict[str, dict]:
    out: dict[str, dict] = {}
    points_path = root / "artifacts" / "books_globe.json"
    if points_path.exists():
        try:
            with points_path.open("r", encoding="utf-8") as f:
                payload = json.load(f)
            for row in payload.get("points", []):
                book_id = row.get("id")
                if book_id:
                    out[str(book_id)] = row
        except Exception:
            pass
    obsidian_books_path = root / "user_data" / "obsidian_books.json"
    if obsidian_books_path.exists():
        try:
            with obsidian_books_path.open("r", encoding="utf-8") as f:
                payload = json.load(f) or {}
            books = payload.get("books", {})
            if isinstance(books, dict):
                for book_id, row in books.items():
                    if book_id and isinstance(row, dict):
                        out[str(book_id)] = row
        except Exception:
            pass
    all_books_path = root / "user_data" / "all_books.json"
    if all_books_path.exists():
        try:
            with all_books_path.open("r", encoding="utf-8") as f:
                payload = json.load(f) or {}
            books = payload.get("books", {})
            if isinstance(books, dict):
                for book_id, row in books.items():
                    if book_id and isinstance(row, dict):
                        out[str(book_id)] = row
        except Exception:
            pass
    return out


def _clean_bracket_author_entries(books_map: dict) -> tuple[dict, int]:
    cleaned = {}
    removed = 0
    for book_id, row in books_map.items():
        author = str((row or {}).get("author") or "")
        if author.strip().startswith("[[") and author.strip().endswith("]]"):
            removed += 1
            continue
        cleaned[book_id] = row
    return cleaned, removed


def load_obsidian_progress_entries() -> tuple[dict[str, dict], dict]:
    """
    Lightweight vault scan for scheduler snapshots.
    Reads markdown files, extracts progress fields, and returns by-book progress rows.
    """
    vault_path = Path(os.getenv("OBSIDIAN_VAULT_PATH", str(DEFAULT_OBSIDIAN_VAULT))).expanduser()
    if not vault_path.exists():
        raise FileNotFoundError(f"Obsidian vault not found at: {vault_path}")

    entries: dict[str, dict] = {}
    scanned_files = 0
    parsed_books = 0
    for md in vault_path.rglob("*.md"):
        scanned_files += 1
        text = md.read_text(encoding="utf-8", errors="ignore")
        fm = _parse_frontmatter(text)
        if not fm:
            continue
        if not (fm.get("author") or fm.get("total_pages") or fm.get("status")):
            continue
        book = _extract_book(md, fm)
        parsed_books += 1
        entries[book["id"]] = {
            "status": book["status"],
            "total_pages": int(book["total_pages"] or 0),
            "current_page": int(book["current_page"] or 0),
            "start_date": book["start_date"],
            "finish_date": book["finish_date"],
            "notes": "",
        }
    return entries, {"vault_path": str(vault_path), "scanned_files": scanned_files, "parsed_books": parsed_books}


def run_obsidian_sync(root: Path, *, dry_run: bool = True) -> SyncResult:
    vault_path = Path(os.getenv("OBSIDIAN_VAULT_PATH", str(DEFAULT_OBSIDIAN_VAULT))).expanduser()
    if not vault_path.exists():
        raise FileNotFoundError(f"Obsidian vault not found at: {vault_path}")

    user_dir = root / "user_data"
    user_dir.mkdir(parents=True, exist_ok=True)
    books_path = user_dir / "obsidian_books.json"
    progress_path = user_dir / "reading_progress.json"
    preview_path = user_dir / "obsidian_sync_preview.json"
    all_books_path = user_dir / "all_books.json"

    books_payload = {"books": {}}
    if books_path.exists():
        with books_path.open("r", encoding="utf-8") as f:
            books_payload = json.load(f) or {"books": {}}
    books_map = books_payload.setdefault("books", {})
    books_map, removed_bracket_author_entries = _clean_bracket_author_entries(books_map)
    books_payload["books"] = books_map

    progress_payload = {"entries": {}}
    if progress_path.exists():
        with progress_path.open("r", encoding="utf-8") as f:
            progress_payload = json.load(f) or {"entries": {}}
    progress_entries = progress_payload.setdefault("entries", {})

    existing_keys = _load_existing_norm_keys(root)
    ignored_keys = _load_ignored_keys(root)
    book_by_id = _load_book_by_id(root)
    base_embs, base_ids = _load_existing_embeddings(root)

    scanned_files = 0
    parsed_books = 0
    created_books = 0
    updated_books = 0
    updated_progress_entries = 0
    proposed_books: list[dict] = []
    all_synced_progress_entries: dict[str, dict] = {}
    all_synced_books_map: dict[str, dict] = {}

    for md in vault_path.rglob("*.md"):
        scanned_files += 1
        text = md.read_text(encoding="utf-8", errors="ignore")
        fm = _parse_frontmatter(text)
        if not fm:
            continue
        if not (fm.get("author") or fm.get("total_pages") or fm.get("status")):
            continue

        book = _extract_book(md, fm)
        parsed_books += 1

        progress_row = {
            "status": book["status"],
            "total_pages": int(book["total_pages"] or 0),
            "current_page": int(book["current_page"] or 0),
            "start_date": book["start_date"],
            "finish_date": book["finish_date"],
            "notes": "",
        }
        progress_entries[book["id"]] = progress_row
        all_synced_progress_entries[book["id"]] = progress_row
        all_synced_books_map[book["id"]] = {
            **book,
            "reading_status": progress_row["status"],
            "reading_total_pages": progress_row["total_pages"],
            "reading_current_page": progress_row["current_page"],
            "reading_start_date": progress_row["start_date"],
            "reading_finish_date": progress_row["finish_date"],
        }
        updated_progress_entries += 1

        key = _norm_key(book["title"], book["author"])
        if key in ignored_keys:
            continue
        if _is_probable_duplicate(key, existing_keys, threshold=0.95):
            continue

        existing = books_map.get(book["id"])
        if existing:
            updated_books += 1
        else:
            created_books += 1
        books_map[book["id"]] = book
        proposed_books.append(book)

    embedding_preview = []
    if proposed_books:
        new_embs, new_ids, method = generate_embeddings(proposed_books)
        for i, b in enumerate(proposed_books):
            emb = new_embs[i]
            similar = []
            if base_embs is not None and base_ids:
                sims = base_embs @ emb.reshape(-1, 1)
                order = np.argsort(-sims.squeeze())[:10]
                for idx in order.tolist():
                    base_id = base_ids[idx]
                    meta = book_by_id.get(base_id, {})
                    similar.append({
                        "id": base_id,
                        "title": meta.get("title", ""),
                        "author": meta.get("author", ""),
                        "score": float(sims.squeeze()[idx]),
                    })
            embedding_preview.append({
                "id": b["id"],
                "title": b["title"],
                "author": b["author"],
                "embedding_method": method,
                "embedding_dim": int(len(emb)),
                "embedding": emb.tolist(),
                "similar_books": similar,
            })

    preview_payload = {
        "dry_run": dry_run,
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "vault_path": str(vault_path),
        "removed_bracket_author_entries": removed_bracket_author_entries,
        "ignored_key_count": len(ignored_keys),
        "summary": {
            "scanned_files": scanned_files,
            "parsed_books": parsed_books,
            "created_books": created_books,
            "updated_books": updated_books,
            "updated_progress_entries": updated_progress_entries,
        },
        "proposed_books": proposed_books,
        "proposed_progress_entries": {k: progress_entries[k] for k in [b["id"] for b in proposed_books]},
        "all_synced_progress_entries": all_synced_progress_entries,
        "embedding_preview": embedding_preview,
    }
    with preview_path.open("w", encoding="utf-8") as f:
        json.dump(preview_payload, f, indent=2)

    # Persistent, idempotent snapshot for "All Books" independent of dataset-add flow.
    # Keyed by book id so repeated syncs overwrite rather than duplicate.
    all_books_payload = {
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "vault_path": str(vault_path),
        "books": all_synced_books_map,
        "count": len(all_synced_books_map),
    }
    with all_books_path.open("w", encoding="utf-8") as f:
        json.dump(all_books_payload, f, indent=2)

    if not dry_run:
        with books_path.open("w", encoding="utf-8") as f:
            json.dump(books_payload, f, indent=2)
        with progress_path.open("w", encoding="utf-8") as f:
            json.dump(progress_payload, f, indent=2)

    return SyncResult(
        scanned_files=scanned_files,
        parsed_books=parsed_books,
        created_books=created_books,
        updated_books=updated_books,
        updated_progress_entries=updated_progress_entries,
        removed_bracket_author_entries=removed_bracket_author_entries,
        vault_path=str(vault_path),
        preview_path=str(preview_path),
        dry_run=dry_run,
        proposed_books=proposed_books,
        periods=compute_reading_stats(progress_entries),
    )


def apply_sync_selection(root: Path, selected_book_ids: list[str]) -> dict:
    user_dir = root / "user_data"
    books_path = user_dir / "obsidian_books.json"
    progress_path = user_dir / "reading_progress.json"
    preview_path = user_dir / "obsidian_sync_preview.json"

    if not preview_path.exists():
        raise FileNotFoundError(f"Sync preview file not found: {preview_path}")

    with preview_path.open("r", encoding="utf-8") as f:
        preview = json.load(f) or {}

    proposed_books = preview.get("proposed_books", [])
    proposed_progress = preview.get("proposed_progress_entries", {})
    all_synced_progress = preview.get("all_synced_progress_entries", {})
    proposed_by_id = {str(b.get("id")): b for b in proposed_books if b.get("id")}

    selected_ids = [str(x) for x in selected_book_ids if str(x) in proposed_by_id]

    books_payload = {"books": {}}
    if books_path.exists():
        with books_path.open("r", encoding="utf-8") as f:
            books_payload = json.load(f) or {"books": {}}
    books_map = books_payload.setdefault("books", {})

    progress_payload = {"entries": {}}
    if progress_path.exists():
        with progress_path.open("r", encoding="utf-8") as f:
            progress_payload = json.load(f) or {"entries": {}}
    progress_entries = progress_payload.setdefault("entries", {})

    selected_books = [proposed_by_id[book_id] for book_id in selected_ids]
    for book in selected_books:
        books_map[str(book["id"])] = book
        if str(book["id"]) in proposed_progress:
            progress_entries[str(book["id"])] = proposed_progress[str(book["id"])]

    # Always sync reading progress for all parsed books, even if books are deselected/ignored for dataset add.
    if isinstance(all_synced_progress, dict):
        for book_id, row in all_synced_progress.items():
            if not book_id or not isinstance(row, dict):
                continue
            progress_entries[str(book_id)] = row

    with books_path.open("w", encoding="utf-8") as f:
        json.dump(books_payload, f, indent=2)
    with progress_path.open("w", encoding="utf-8") as f:
        json.dump(progress_payload, f, indent=2)

    # Once a proposed book is accepted, add it to ignore rules so it won't be re-suggested.
    if selected_books:
        ignored = _load_ignored_keys(root)
        for book in selected_books:
            ignored.add(_norm_key(book.get("title"), book.get("author")))
        _save_ignored_keys(root, ignored)

    if selected_books:
        new_embs, new_ids, _method = generate_embeddings(selected_books)
        base_embs, base_ids = _load_existing_embeddings(root)
        if base_embs is None:
            merged_embs = new_embs.astype(np.float32)
            merged_ids = list(new_ids)
        else:
            id_to_idx = {book_id: i for i, book_id in enumerate(base_ids)}
            merged_embs = base_embs.copy()
            merged_ids = list(base_ids)
            for i, book_id in enumerate(new_ids):
                emb = new_embs[i].astype(np.float32)
                if book_id in id_to_idx:
                    merged_embs[id_to_idx[book_id]] = emb
                else:
                    merged_embs = np.vstack([merged_embs, emb])
                    merged_ids.append(book_id)
                    id_to_idx[book_id] = len(merged_ids) - 1

        artifacts = root / "artifacts"
        artifacts.mkdir(parents=True, exist_ok=True)
        np.save(artifacts / "embeddings.npy", merged_embs.astype(np.float32))
        np.save(artifacts / "book_ids.npy", np.array(merged_ids, dtype=object))
        try:
            import faiss

            index = faiss.IndexFlatIP(int(merged_embs.shape[1]))
            index.add(merged_embs.astype(np.float32))
            faiss.write_index(index, str(artifacts / "books.faiss"))
        except Exception:
            pass

    return {
        "applied_count": len(selected_books),
        "applied_book_ids": [b["id"] for b in selected_books],
    }


def ignore_future_suggestion(root: Path, title: str, author: str) -> dict:
    key = _norm_key(title, author)
    ignored = _load_ignored_keys(root)
    already = key in ignored
    ignored.add(key)
    _save_ignored_keys(root, ignored)
    return {"ignored_key": key, "already_ignored": already, "ignored_count": len(ignored)}


def compute_reading_stats(entries: dict[str, dict], today: date | None = None) -> dict:
    now = today or date.today()
    rows = []
    for row in entries.values():
        finish = _parse_date_str((row or {}).get("finish_date"))
        status = str((row or {}).get("status") or "").strip().lower()
        if status != "done" or not finish:
            continue
        finish_d = date.fromisoformat(finish)
        pages = _to_int((row or {}).get("total_pages"), default=_to_int((row or {}).get("current_page"), default=0))
        rows.append({"finish_date": finish_d, "pages": pages})

    def for_period(period: str) -> tuple[list[dict], int]:
        if period == "daily":
            picked = [r for r in rows if r["finish_date"] == now]
            return picked, 1
        if period == "monthly":
            picked = [r for r in rows if r["finish_date"].year == now.year and r["finish_date"].month == now.month]
            return picked, now.day
        if period == "yearly":
            picked = [r for r in rows if r["finish_date"].year == now.year]
            return picked, now.timetuple().tm_yday
        picked = list(rows)
        if not picked:
            return picked, 1
        earliest = min(r["finish_date"] for r in picked)
        return picked, max(1, (now - earliest).days + 1)

    completion_days = sorted({r["finish_date"] for r in rows})
    streak = 0
    if completion_days:
        day = completion_days[-1]
        day_set = set(completion_days)
        streak = 1
        while (day - timedelta(days=1)) in day_set:
            day = day - timedelta(days=1)
            streak += 1

    out = {}
    for period in ("daily", "monthly", "yearly", "all"):
        picked, days_passed = for_period(period)
        unique_days = len({r["finish_date"] for r in picked})
        out[period] = {
            "totalBooksRead": len(picked),
            "totalPagesRead": sum(r["pages"] for r in picked),
            "daysReadStreak": streak,
            "daysRead": unique_days,
            "daysPassed": days_passed,
        }
    return out
