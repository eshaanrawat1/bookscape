from __future__ import annotations

import os
import re
import subprocess
import sys
from fastapi import APIRouter, HTTPException
from pathlib import Path
from pydantic import BaseModel

from ..services.catalog import get_book_with_similar as load_book_with_similar
from ..services.catalog import upsert_book
from ..utils import read_json


class ScrapeBookIn(BaseModel):
    url: str


def create_router(root: Path) -> APIRouter:
    router = APIRouter()

    @router.post("/scrape-book")
    def scrape_book(payload: ScrapeBookIn) -> dict:
        url = payload.url.strip()
        uid_match = re.search(r"/book/show/(\d+)", url)
        if not uid_match:
            raise HTTPException(status_code=400, detail="Invalid Goodreads URL format")
        book_id = uid_match.group(1)
        scraper_timeout = int(os.getenv("SCRAPER_TIMEOUT_SECONDS", "180"))
        try:
            scripts_dir = root / "backend" / "scripts"
            res = subprocess.run(
                [sys.executable, str(scripts_dir / "scraper.py"), "--import-one", url],
                cwd=scripts_dir, capture_output=True, text=True, timeout=scraper_timeout,
            )
            if res.returncode != 0:
                raise HTTPException(status_code=500, detail=f"Scraper error: {res.stderr or res.stdout or 'unknown'}")
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail=f"Scraper timed out after {scraper_timeout}s")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to run scraper: {e}") from e

        # scraper.py (a standalone script, out of scope for the SQLite migration)
        # writes the freshly-scraped row to books.json only — bridge it into SQLite.
        catalog_payload = read_json(root / "backend" / "data" / "books.json", {})
        raw_row = catalog_payload.get(book_id) if isinstance(catalog_payload, dict) else None
        if isinstance(raw_row, dict):
            upsert_book(root, raw_row)

        book = load_book_with_similar(root, book_id)
        if not book:
            warnings = [ln.strip() for ln in res.stdout.splitlines() if any(tok in ln for tok in ("⚠️", "🚨", "error"))]
            detail = "Scraper completed but book not found in dataset."
            if warnings:
                detail += f" Details: {' | '.join(warnings)}"
            raise HTTPException(status_code=404, detail=detail)
        return {"ok": True, "book": book}

    return router
