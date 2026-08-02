from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pathlib import Path
from pydantic import BaseModel

from ..services.catalog import get_book_with_similar as load_book_with_similar
from ..services.catalog import resolve_book, upsert_book
from ..services.cover_worker import poke_worker


class ScrapeBookIn(BaseModel):
    url: str
    force: bool = False


class ConfirmBookIn(BaseModel):
    book: dict


STAGE_MESSAGES = {
    "fetching_page": "Fetching book info…",
    "fetching_similar": "Fetching similar books…",
}


def create_router(root: Path) -> APIRouter:
    router = APIRouter()

    @router.post("/scrape-book/preview")
    def scrape_book_preview(payload: ScrapeBookIn) -> StreamingResponse:
        url = payload.url.strip()
        uid_match = re.search(r"/book/show/(\d+)", url)
        if not uid_match:
            raise HTTPException(
                status_code=400,
                detail="That link didn't resolve — check it points to a book page, not an author or a list.",
            )
        book_id = uid_match.group(1)

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
            try:
                for raw_line in proc.stdout:
                    line = raw_line.rstrip("\n")
                    if line.startswith("@@STAGE@@ "):
                        stage = line[len("@@STAGE@@ "):].strip()
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
                yield json.dumps({
                    "stage": "error",
                    "message": f"Goodreads timed out after {scraper_timeout}s. Please try again.",
                }) + "\n"
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
        book = payload.book
        uid = str(book.get("uid") or "").strip()
        if not uid:
            raise HTTPException(status_code=400, detail="Missing book data to import.")

        upsert_book(root, book)
        # The scraper leaves `color` empty on purpose; wake the extractor so the
        # new book gets one now rather than at the worker's next idle poll.
        poke_worker()
        saved = load_book_with_similar(root, uid)
        if not saved:
            raise HTTPException(status_code=500, detail="Book was saved but could not be reloaded.")
        return {"ok": True, "book": saved}

    return router
