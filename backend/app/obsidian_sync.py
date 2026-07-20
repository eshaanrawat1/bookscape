from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

import numpy as np
import yaml

from .data_repository import DataRepository
from .reading_stats import compute_reading_stats

try:
    from pipeline.embed_books import generate_embeddings  # type: ignore[import]
except ModuleNotFoundError:
    def generate_embeddings(books: list[dict], dim: int = 64) -> tuple:  # type: ignore[misc]
        import hashlib

        embs = []
        for b in books:
            seed = (str(b.get("title", "")) + str(b.get("author", ""))).encode()
            h = hashlib.sha256(seed).digest()
            vec = np.array([((h[i % len(h)] / 255.0) * 2 - 1) for i in range(dim)], dtype=np.float32)
            norm = float(np.linalg.norm(vec)) or 1.0
            embs.append(vec / norm)
        ids = [str(b.get("id", i)) for i, b in enumerate(books)]
        return np.array(embs, dtype=np.float32), ids, "hash_fallback"


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


def _resolve_vault_path(root: Path | None = None) -> Path:
    env_value = os.getenv("OBSIDIAN_VAULT_PATH", "").strip()
    if env_value:
        return Path(env_value).expanduser()

    if root is not None:
        repo = DataRepository(root)
        snapshot_path = str(repo.read_obsidian_books_snapshot().get("vault_path") or "").strip()
        if snapshot_path:
            return Path(snapshot_path).expanduser()

    return DEFAULT_OBSIDIAN_VAULT.expanduser()


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


def _extract_book(path: Path, fm: dict) -> dict:
    uid = str(fm.get("uid") or "").strip()
    title = _normalize_name(fm.get("title") or path.stem)
    author = _normalize_name(fm.get("author") or "")

    total_pages = _to_int(fm.get("total_pages"))
    current_page = _to_int(fm.get("current_page"))

    finish_date = _parse_date_str(fm.get("completed_date") or fm.get("finish_date"))
    start_date = _parse_date_str(fm.get("start_date"))

    status = _normalize_status(fm.get("status"))
    if status == "not_started":
        if finish_date:
            status = "done"
        elif current_page > 0 or start_date:
            status = "reading"

    if status == "done" and total_pages > 0:
        current_page = total_pages
    elif total_pages > 0:
        current_page = min(current_page, total_pages)

    genres_raw = fm.get("genres") or ""
    if isinstance(genres_raw, list):
        genres = [_normalize_name(g) for g in genres_raw if _normalize_name(g)]
    else:
        genres = [g.strip() for g in str(genres_raw).split(",") if g.strip()]

    description = str(fm.get("description") or "").strip()
    if not description:
        try:
            md_text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            md_text = ""
        description = _extract_description(md_text)

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


def _load_existing_embeddings(root: Path) -> tuple[np.ndarray | None, list[str]]:
    emb_path = root / "data" / "runtime" / "vector" / "embeddings.npy"
    ids_path = root / "data" / "runtime" / "vector" / "book_ids.npy"
    if not emb_path.exists() or not ids_path.exists():
        return None, []
    try:
        embs = np.load(emb_path).astype(np.float32)
        ids = np.load(ids_path, allow_pickle=True).tolist()
        return embs, [str(x) for x in ids]
    except Exception:
        return None, []


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


def load_obsidian_progress_entries(root: Path | None = None) -> tuple[dict[str, dict], dict]:
    vault_path = _resolve_vault_path(root)
    if not vault_path.exists():
        raise FileNotFoundError(f"Obsidian vault not found at: {vault_path}")

    entries: dict[str, dict] = {}
    scanned_files = 0
    parsed_books = 0
    for md in vault_path.rglob("*.md"):
        scanned_files += 1
        text = md.read_text(encoding="utf-8", errors="ignore")
        fm = _parse_frontmatter(text)
        if not fm or not fm.get("uid"):
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
    vault_path = _resolve_vault_path(root)
    if not vault_path.exists():
        raise FileNotFoundError(f"Obsidian vault not found at: {vault_path}")

    repo = DataRepository(root)
    user_dir = root / "user_data"
    user_dir.mkdir(parents=True, exist_ok=True)
    preview_path = user_dir / "obsidian_sync_preview.json"

    existing_snapshot = repo.read_obsidian_books_snapshot()
    existing_snapshot_books = existing_snapshot.get("books", {})
    if not isinstance(existing_snapshot_books, dict):
        existing_snapshot_books = {}

    user_state = repo.load_user_state()
    progress_entries = user_state.setdefault("reading_progress", {})

    scanned_files = 0
    parsed_books = 0
    created_books = 0
    updated_books = 0
    updated_progress_entries = 0
    all_synced_books_map: dict[str, dict] = {}

    for md in vault_path.rglob("*.md"):
        scanned_files += 1
        text = md.read_text(encoding="utf-8", errors="ignore")
        fm = _parse_frontmatter(text)
        if not fm or not fm.get("uid"):
            continue

        book = _extract_book(md, fm)
        parsed_books += 1
        book_id = book["id"]

        progress_row = {
            "status": book["status"],
            "total_pages": int(book["total_pages"] or 0),
            "current_page": int(book["current_page"] or 0),
            "start_date": book["start_date"],
            "finish_date": book["finish_date"],
            "notes": "",
        }
        progress_entries[book_id] = progress_row
        updated_progress_entries += 1

        prior_snapshot_row = existing_snapshot_books.get(book_id, {})
        if not isinstance(prior_snapshot_row, dict):
            prior_snapshot_row = {}

        synced_row = {**book}
        all_synced_books_map[book_id] = synced_row

        if book_id in existing_snapshot_books:
            updated_books += 1
        else:
            created_books += 1

    preview_payload = {
        "dry_run": dry_run,
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "vault_path": str(vault_path),
        "summary": {
            "scanned_files": scanned_files,
            "parsed_books": parsed_books,
            "created_books": created_books,
            "updated_books": updated_books,
            "updated_progress_entries": updated_progress_entries,
        },
    }
    with preview_path.open("w", encoding="utf-8") as f:
        json.dump(preview_payload, f, indent=2)

    all_books_payload = {
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "vault_path": str(vault_path),
        "books": all_synced_books_map,
        "count": len(all_synced_books_map),
    }
    repo.write_obsidian_books_snapshot(all_books_payload)

    if not dry_run:
        repo.save_user_state(user_state)

    return SyncResult(
        scanned_files=scanned_files,
        parsed_books=parsed_books,
        created_books=created_books,
        updated_books=updated_books,
        updated_progress_entries=updated_progress_entries,
        removed_bracket_author_entries=0,
        vault_path=str(vault_path),
        preview_path=str(preview_path),
        dry_run=dry_run,
        proposed_books=[],
        periods=compute_reading_stats(progress_entries),
    )


def _append_raw_dataset_row(root: Path, book: dict) -> None:
    raw_jsonl = root / "data" / "raw" / "books_from_csv.jsonl"
    raw_jsonl.parent.mkdir(parents=True, exist_ok=True)
    row = {
        "id": str(book.get("id") or ""),
        "title": str(book.get("title") or ""),
        "author": str(book.get("author") or ""),
        "description": str(book.get("description") or ""),
        "genres": book.get("genres") or [str(book.get("genre") or "unknown")],
        "book_pages": int(book.get("total_pages") or 0),
        "book_rating": float(book.get("book_rating") or 0) if str(book.get("book_rating") or "").strip() else None,
        "book_rating_count": int(book.get("book_rating_count") or 0) if str(book.get("book_rating_count") or "").strip() else None,
        "book_review_count": int(book.get("book_review_count") or 0) if str(book.get("book_review_count") or "").strip() else None,
        "image_url": str(book.get("image_url") or ""),
    }
    with raw_jsonl.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _rebuild_status_path(root: Path) -> Path:
    return root / "user_data" / "dataset_rebuild_status.json"


def _is_pid_running(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except Exception:
        return False


def _run_full_rebuild_async(root: Path, *, requested_by_book_id: str) -> dict:
    status_path = _rebuild_status_path(root)
    if status_path.exists():
        try:
            existing = json.loads(status_path.read_text(encoding="utf-8"))
        except Exception:
            existing = {}
        existing_pid = int(existing.get("pid") or 0)
        if str(existing.get("status") or "") == "running" and _is_pid_running(existing_pid):
            return {"status": "running", "pid": existing_pid, "started_at": existing.get("started_at", "")}

    log_path = root / "user_data" / "dataset_rebuild.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        "scripts/rebuild_dashboard_data.py",
        "--input",
        "data/raw/books_from_csv.jsonl",
    ]
    with log_path.open("ab") as logf:
        proc = subprocess.Popen(
            cmd,
            cwd=root,
            stdout=logf,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    payload = {
        "status": "running",
        "pid": int(proc.pid),
        "started_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "requested_by_book_id": requested_by_book_id,
        "log_path": str(log_path),
    }
    status_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def add_snapshot_book_to_dataset(root: Path, book_id: str) -> dict:
    repo = DataRepository(root)
    payload = repo.read_obsidian_books_snapshot()
    books = payload.get("books", {})
    if not isinstance(books, dict) or book_id not in books or not isinstance(books.get(book_id), dict):
        raise FileNotFoundError(f"Snapshot book not found: {book_id}")

    book = books[book_id]
    _append_raw_dataset_row(root, book)
    rebuild = _run_full_rebuild_async(root, requested_by_book_id=book_id)
    books[book_id] = book
    payload["books"] = books
    repo.write_obsidian_books_snapshot(payload)
    return {"book_id": book_id, "rebuild": rebuild}


def merge_snapshot_book_with_dataset(root: Path, snapshot_book_id: str, uid: str) -> dict:
    repo = DataRepository(root)
    payload = repo.read_obsidian_books_snapshot()
    books = payload.get("books", {})
    if not isinstance(books, dict) or snapshot_book_id not in books or not isinstance(books.get(snapshot_book_id), dict):
        raise FileNotFoundError(f"Snapshot book not found: {snapshot_book_id}")
    row = books[snapshot_book_id]
    books[snapshot_book_id] = row
    payload["books"] = books
    repo.write_obsidian_books_snapshot(payload)
    return {"book_id": snapshot_book_id, "uid": uid}


def unlink_snapshot_book_from_dataset(root: Path, snapshot_book_id: str) -> dict:
    repo = DataRepository(root)
    payload = repo.read_obsidian_books_snapshot()
    books = payload.get("books", {})
    if not isinstance(books, dict) or snapshot_book_id not in books or not isinstance(books.get(snapshot_book_id), dict):
        raise FileNotFoundError(f"Snapshot book not found: {snapshot_book_id}")
    row = books[snapshot_book_id]
    books[snapshot_book_id] = row
    payload["books"] = books
    repo.write_obsidian_books_snapshot(payload)
    return {"book_id": snapshot_book_id}