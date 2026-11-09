from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from ..db import transaction

router = APIRouter()

# Per-year key so 1 January starts clean rather than inheriting last year's target.
READING_GOAL_KEY_PREFIX = "reading_goal:"
# Typo guard, not a real ceiling.
MAX_READING_GOAL = 1000


class ReadingGoalIn(BaseModel):
    # 0 clears the goal, so removal is just a save.
    target: int = Field(ge=0, le=MAX_READING_GOAL)
    year: int = Field(ge=1900, le=3000)


# Read count is deliberately absent: the client counts it from the finished books it draws.
@router.get("/settings/reading-goal")
def get_reading_goal(year: int = Query(ge=1900, le=3000)) -> dict:
    with transaction() as conn:
        row = conn.execute(
            "SELECT value FROM app_settings WHERE key = ?", (f"{READING_GOAL_KEY_PREFIX}{year}",)
        ).fetchone()
    try:
        target = max(0, min(MAX_READING_GOAL, int(row["value"]))) if row else 0
    except ValueError:
        # A malformed stored value reads as "no goal".
        target = 0
    return {"year": year, "target": target}


@router.put("/settings/reading-goal")
def set_reading_goal(payload: ReadingGoalIn) -> dict:
    with transaction() as conn:
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (
                f"{READING_GOAL_KEY_PREFIX}{payload.year}",
                str(payload.target) if payload.target > 0 else "",
            ),
        )
    return {"year": payload.year, "target": payload.target}
