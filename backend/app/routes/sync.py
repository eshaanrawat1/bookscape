from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pathlib import Path

from ..services.obsidian import (
    EmptyVaultScanError,
    FilenameCollisionError,
    pull_one,
    push_one,
    run_obsidian_pull,
    run_obsidian_push,
)


def create_router(root: Path) -> APIRouter:
    router = APIRouter()

    @router.post("/sync/obsidian")
    def sync_obsidian_pull(dry_run: bool = Query(default=False)) -> dict:
        try:
            res = run_obsidian_pull(root, dry_run=dry_run)
        except EmptyVaultScanError as e:
            raise HTTPException(status_code=409, detail=f"Scanned 0 files at {e} — check the vault is mounted") from e
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        except ValueError as e:
            # A configured path that fails validation — saved before the rule
            # existed, or via the env var, which never passes through Settings.
            raise HTTPException(status_code=400, detail=str(e)) from e
        return {
            "ok": True,
            "dry_run": res.dry_run,
            "vault_path": res.vault_path,
            "scanned_files": res.scanned_files,
            "imported": res.imported,
            "skipped": res.skipped,
        }

    @router.post("/sync/obsidian/push")
    def sync_obsidian_push(dry_run: bool = Query(default=False)) -> dict:
        try:
            res = run_obsidian_push(root, dry_run=dry_run)
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        return {
            "ok": True,
            "dry_run": res.dry_run,
            "vault_path": res.vault_path,
            "written": res.written,
            "deleted": res.deleted,
            "skipped_collisions": res.skipped_collisions,
        }

    @router.post("/sync/obsidian/pull/{uid}")
    def sync_obsidian_pull_one(uid: str, dry_run: bool = Query(default=False)) -> dict:
        try:
            res = pull_one(root, uid=uid, dry_run=dry_run)
        except EmptyVaultScanError as e:
            raise HTTPException(status_code=409, detail=str(e)) from e
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        return {"ok": True, **res}

    @router.post("/sync/obsidian/push/{uid}")
    def sync_obsidian_push_one(uid: str, dry_run: bool = Query(default=False)) -> dict:
        try:
            res = push_one(root, uid, dry_run=dry_run)
        except FilenameCollisionError as e:
            raise HTTPException(status_code=409, detail=str(e)) from e
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        return {"ok": True, **res}

    return router
