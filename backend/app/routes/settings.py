from __future__ import annotations

from datetime import date
from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from ..repository import DataRepository

# Per-year key so 1 January starts clean rather than inheriting last year's target.
READING_GOAL_KEY_PREFIX = "reading_goal:"
# Typo guard, not a real ceiling.
MAX_READING_GOAL = 1000


class ReadingGoalIn(BaseModel):
    # 0 clears the goal, so removal is just a save.
    target: int = Field(ge=0, le=MAX_READING_GOAL)
    year: int | None = Field(default=None, ge=1900, le=3000)


def create_router(repo: DataRepository) -> APIRouter:
    router = APIRouter()

    # Read count is deliberately absent: the client counts it from the finished books it draws.
    @router.get("/settings/reading-goal")
    def get_reading_goal(year: int | None = Query(default=None, ge=1900, le=3000)) -> dict:
        target_year = year or date.today().year
        raw = repo.get_setting(f"{READING_GOAL_KEY_PREFIX}{target_year}", "")
        try:
            target = max(0, min(MAX_READING_GOAL, int(raw)))
        except ValueError:
            # A malformed stored value reads as "no goal".
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
