from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pathlib import Path

from ..services.obsidian import run_obsidian_sync


def create_router(root: Path) -> APIRouter:
    router = APIRouter()

    def _run_sync_obsidian(*, dry_run: bool = False) -> dict:
        try:
            res = run_obsidian_sync(root, dry_run=dry_run)
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"sync failed: {e}") from e

        return {
            "ok": True,
            "dry_run": res.dry_run,
            "vault_path": res.vault_path,
            "preview_path": res.preview_path,
            "scanned_files": res.scanned_files,
            "parsed_books": res.parsed_books,
            "created_books": res.created_books,
            "updated_books": res.updated_books,
            "updated_progress_entries": res.updated_progress_entries,
            "periods": res.periods,
        }

    @router.post("/sync/obsidian")
    def sync_obsidian(dry_run: bool = Query(default=False)) -> dict:
        return _run_sync_obsidian(dry_run=dry_run)

    return router
