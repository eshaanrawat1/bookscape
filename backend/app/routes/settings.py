from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pathlib import Path
from pydantic import BaseModel

from ..repository import DataRepository
from ..services.obsidian.vault import validate_vault_path

VAULT_PATH_KEY = "obsidian_vault_path"


class VaultPathIn(BaseModel):
    path: str


def create_router(root: Path, repo: DataRepository) -> APIRouter:
    router = APIRouter()

    @router.get("/settings/vault-path")
    def get_vault_path() -> dict:
        return {"vault_path": repo.get_setting(VAULT_PATH_KEY, "")}

    @router.put("/settings/vault-path")
    def set_vault_path(payload: VaultPathIn) -> dict:
        # Deliberately no existence check here: a path on a currently-unmounted
        # drive or a not-yet-downloaded iCloud folder must still be saveable.
        # Existence/emptiness is validated at Pull/Push time instead.
        #
        # Where the path *points*, though, is checked now rather than at sync
        # time, so a bad one is rejected while the user is still looking at the
        # folder picker instead of failing later against a half-run Push.
        clean = payload.path.strip()
        if clean:
            try:
                validate_vault_path(Path(clean).expanduser().resolve())
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e)) from e
        repo.set_setting(VAULT_PATH_KEY, clean)
        return {"vault_path": clean}

    return router
