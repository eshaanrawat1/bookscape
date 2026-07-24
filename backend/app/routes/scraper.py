from __future__ import annotations

import os
import re
import subprocess
import sys
from fastapi import APIRouter, HTTPException
from pathlib import Path
from pydantic import BaseModel

from ..services.catalog import get_book_with_similar as load_book_with_similar


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
            data_dir = root / "backend" / "data"
            res = subprocess.run(
                [sys.executable, str(data_dir / "scraper.py"), "--import-one", url],
                cwd=data_dir, capture_output=True, text=True, timeout=scraper_timeout,
            )
            if res.returncode != 0:
                raise HTTPException(status_code=500, detail=f"Scraper error: {res.stderr or res.stdout or 'unknown'}")
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail=f"Scraper timed out after {scraper_timeout}s")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to run scraper: {e}") from e

        book = load_book_with_similar(root, book_id)
        if not book:
            warnings = [ln.strip() for ln in res.stdout.splitlines() if any(tok in ln for tok in ("⚠️", "🚨", "error"))]
            detail = "Scraper completed but book not found in dataset."
            if warnings:
                detail += f" Details: {' | '.join(warnings)}"
            raise HTTPException(status_code=404, detail=detail)
        return {"ok": True, "book": book}

    return router
