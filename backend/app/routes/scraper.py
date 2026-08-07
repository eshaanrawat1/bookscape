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

from ..services.catalog import get_book_with_similar as load_book_with_similar
from ..services.catalog import resolve_book, upsert_book
from ..services.cover_worker import poke_worker
from ..urls import canonical_book_url


class ScrapeBookIn(BaseModel):
    url: str
    force: bool = False


class ScrapedBookIn(BaseModel):
    """One book as the scraper emitted it, handed back for import.

    Mirrors the `Book` dataclass in backend/scripts/scraper.py. Typed rather
    than a bare dict because this is the one route that writes straight into the
    catalog: `extra="forbid"` turns a payload carrying unexpected fields into a
    422 instead of a silent partial write, and the length caps stop a single
    import from parking megabytes in the database.

    `color` is absent on purpose — the scraper never sets it, and the cover
    worker owns that column.
    """

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
    source_url: str = Field(default="", max_length=2000)
    scraped_at: str = Field(default="", max_length=64)


class ConfirmBookIn(BaseModel):
    book: ScrapedBookIn


STAGE_MESSAGES = {
    "installing_browser": "Setting up the browser (one-time download)…",
    "fetching_page": "Fetching book info…",
    "fetching_similar": "Fetching similar books…",
}


def create_router(root: Path) -> APIRouter:
    router = APIRouter()

    @router.post("/scrape-book/preview")
    def scrape_book_preview(payload: ScrapeBookIn) -> StreamingResponse:
        # `url` is rebuilt from the parsed id rather than taken as given: it is
        # about to be handed to a real browser, so the host has to be Goodreads
        # and nothing else may ride along in the query or fragment.
        try:
            book_id, url = canonical_book_url(payload.url)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        if not payload.force:
            existing = resolve_book(root, book_id)
            if existing:
                def duplicate_stream():
                    yield json.dumps({
                        "stage": "duplicate",
                        "book": {
                            "uid": existing.get("uid"),
                            "title": existing.get("title"),
                            "author": existing.get("author"),
                            "image_url": existing.get("image_url"),
                        },
                    }) + "\n"

                return StreamingResponse(duplicate_stream(), media_type="application/x-ndjson")

        scraper_timeout = int(os.getenv("SCRAPER_TIMEOUT_SECONDS", "180"))
        install_timeout = int(os.getenv("SCRAPER_BROWSER_INSTALL_TIMEOUT_SECONDS", "900"))
        scripts_dir = root / "backend" / "scripts"

        def run_stream():
            env = {**os.environ, "PYTHONUNBUFFERED": "1"}
            try:
                proc = subprocess.Popen(
                    [sys.executable, str(scripts_dir / "scraper.py"), "--fetch-one", url],
                    cwd=scripts_dir,
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
                            # The scraper found no Chromium and is fetching one.
                            # A ~150MB download does not fit in a budget sized
                            # for a page load, so restart the clock with room
                            # for the download *and* the scrape that follows.
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
                        # Non-machine-readable scraper log line — surface it to the
                        # server console for debugging, not to the client.
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

        upsert_book(root, book)
        # The scraper leaves `color` empty on purpose; wake the extractor so the
        # new book gets one now rather than at the worker's next idle poll.
        poke_worker()
        saved = load_book_with_similar(root, uid)
        if not saved:
            raise HTTPException(status_code=500, detail="Book was saved but could not be reloaded.")
        return {"ok": True, "book": saved}

    return router
