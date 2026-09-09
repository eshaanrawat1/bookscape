from __future__ import annotations

from datetime import date
from fastapi import APIRouter, HTTPException, Query
from pathlib import Path
from pydantic import BaseModel, Field

from ..repository import DataRepository
from ..services.obsidian.vault import validate_vault_path

VAULT_PATH_KEY = "obsidian_vault_path"

# One key per year rather than one key overall: a target is a promise about a
# particular year, so 1 January starts clean instead of quietly inheriting last
# year's number and reporting you 0% of the way through a goal you never set.
READING_GOAL_KEY_PREFIX = "reading_goal:"
# Not a real ceiling on anyone's reading — just the point past which the field
# is more likely holding a typo than an intention.
MAX_READING_GOAL = 1000


class VaultPathIn(BaseModel):
    path: str


class ReadingGoalIn(BaseModel):
    # 0 clears the goal, so the dialog's "Remove goal" is a save of nothing
    # rather than a second endpoint doing almost the same write.
    target: int = Field(ge=0, le=MAX_READING_GOAL)
    year: int | None = Field(default=None, ge=1900, le=3000)


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

    # How many books have actually been read is deliberately not returned here:
    # the client counts it from the finished books it already holds, which are
    # the same books the goal card draws covers from. Two sources for one number
    # would eventually disagree, and the card would show a count that its own
    # row of covers contradicts.
    @router.get("/settings/reading-goal")
    def get_reading_goal(year: int | None = Query(default=None, ge=1900, le=3000)) -> dict:
        target_year = year or date.today().year
        raw = repo.get_setting(f"{READING_GOAL_KEY_PREFIX}{target_year}", "")
        try:
            target = max(0, min(MAX_READING_GOAL, int(raw)))
        except ValueError:
            # A key written by hand or left behind by an older shape reads as
            # "no goal" rather than taking the endpoint down with it.
            target = 0
        return {"year": target_year, "target": target}

    @router.put("/settings/reading-goal")
    def set_reading_goal(payload: ReadingGoalIn) -> dict:
        target_year = payload.year or date.today().year
        repo.set_setting(
            f"{READING_GOAL_KEY_PREFIX}{target_year}",
            str(payload.target) if payload.target > 0 else "",
        )
        return {"year": target_year, "target": payload.target}

    return router
