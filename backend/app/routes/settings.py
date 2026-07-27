from __future__ import annotations

from fastapi import APIRouter
from pathlib import Path
from pydantic import BaseModel

from ..repository import DataRepository

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
        clean = payload.path.strip()
        repo.set_setting(VAULT_PATH_KEY, clean)
        return {"vault_path": clean}

    return router
