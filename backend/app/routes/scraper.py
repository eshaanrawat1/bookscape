from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pathlib import Path
from pydantic import BaseModel, ConfigDict, Field

from ..services.catalog import resolve_book, upsert_book
from ..urls import canonical_book_url


class ScrapeBookIn(BaseModel):
    url: str
    force: bool = False


class ScrapedBookIn(BaseModel):
    """One scraped book for import; `extra="forbid"` and length caps guard this direct catalog write."""

    model_config = ConfigDict(extra="forbid")

    uid: str = Field(pattern=r"^\d{1,20}$")
    title: str = Field(default="", max_length=1000)
    author: str = Field(default="", max_length=1000)
    image_url: str = Field(default="", max_length=2000)
    avg_rating: float = Field(default=0.0, ge=0, le=5)
    rating_count: int = Field(default=0, ge=0)
    review_count: int = Field(default=0, ge=0)
    genres: list[str] = Field(default_factory=list, max_length=100)
    description: str = Field(default="", max_length=50_000)
    page_count: int = Field(default=0, ge=0)
    series: str = Field(default="", max_length=500)
    series_number: str = Field(default="", max_length=50)
    similar_book_ids: list[str] = Field(default_factory=list, max_length=100)
    scraped_at: str = Field(default="", max_length=64)


class ConfirmBookIn(BaseModel):
    book: ScrapedBookIn


router = APIRouter()
SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"

STAGE_MESSAGES = {
    "installing_browser": "Setting up the browser (one-time download)…",
    "fetching_page": "Fetching book info…",
    "fetching_similar": "Fetching similar books…",
}


@router.post("/scrape-book/preview")
def scrape_book_preview(payload: ScrapeBookIn) -> StreamingResponse:
    # Rebuilt from the parsed id since it goes to a real browser: Goodreads host only, no query or fragment.
    try:
        book_id, url = canonical_book_url(payload.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    if not payload.force:
        existing = resolve_book(book_id)
        if existing:
            def duplicate_stream():
                yield json.dumps({
                    "stage": "duplicate",
                    "book": {
                        "uid": existing.get("id"),
                        "title": existing.get("title"),
                        "author": existing.get("author"),
                        "image_url": existing.get("image_url"),
                    },
                }) + "\n"

            return StreamingResponse(duplicate_stream(), media_type="application/x-ndjson")

    scraper_timeout = int(os.getenv("SCRAPER_TIMEOUT_SECONDS", "180"))
    install_timeout = int(os.getenv("SCRAPER_BROWSER_INSTALL_TIMEOUT_SECONDS", "900"))

    def run_stream():
        env = {**os.environ, "PYTHONUNBUFFERED": "1"}
        try:
            proc = subprocess.Popen(
                [sys.executable, str(SCRIPTS_DIR / "scraper.py"), "--fetch-one", url],
                cwd=SCRIPTS_DIR,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                env=env,
            )
        except Exception as e:
            yield json.dumps({"stage": "error", "message": f"Failed to start the scraper: {e}"}) + "\n"
            return

        timed_out = {"flag": False}

        def _kill():
            timed_out["flag"] = True
            proc.kill()

        timer = threading.Timer(scraper_timeout, _kill)
        timer.start()

        result_book: dict | None = None
        error_message: str | None = None
        installing = {"flag": False}
        try:
            for raw_line in proc.stdout:
                line = raw_line.rstrip("\n")
                if line.startswith("@@STAGE@@ "):
                    stage = line[len("@@STAGE@@ "):].strip()
                    if stage == "installing_browser":
                        # Chromium is downloading (~150MB); restart the clock with room for it and the scrape.
                        installing["flag"] = True
                        timer.cancel()
                        timer = threading.Timer(install_timeout + scraper_timeout, _kill)
                        timer.start()
                    yield json.dumps({
                        "stage": stage,
                        "message": STAGE_MESSAGES.get(stage, stage),
                    }) + "\n"
                elif line.startswith("@@RESULT@@ "):
                    try:
                        result_book = json.loads(line[len("@@RESULT@@ "):])
                    except Exception:
                        error_message = "The scraper returned an unreadable result."
                elif line.startswith("@@ERROR@@ "):
                    error_message = line[len("@@ERROR@@ "):].strip()
                elif line.strip():
                    # Non-protocol log line: console only, not the client.
                    print(f"[scraper] {line}")
        finally:
            proc.wait()
            timer.cancel()

        if timed_out["flag"]:
            message = (
                "Downloading the browser took too long. Check your connection and try again."
                if installing["flag"]
                else f"Goodreads timed out after {scraper_timeout}s. Please try again."
            )
            yield json.dumps({"stage": "error", "message": message}) + "\n"
            return
        if result_book:
            yield json.dumps({"stage": "preview", "book": result_book}) + "\n"
            return
        if error_message:
            yield json.dumps({"stage": "error", "message": error_message}) + "\n"
            return
        yield json.dumps({
            "stage": "error",
            "message": f"The scraper exited unexpectedly (code {proc.returncode}).",
        }) + "\n"

    return StreamingResponse(run_stream(), media_type="application/x-ndjson")

@router.post("/scrape-book/confirm")
def scrape_book_confirm(payload: ConfirmBookIn) -> dict:
    book = payload.book.model_dump()
    uid = book["uid"]

    upsert_book(book)
    saved = resolve_book(uid)
    if not saved:
        raise HTTPException(status_code=500, detail="Book was saved but could not be reloaded.")
    return {"ok": True, "book": saved}
