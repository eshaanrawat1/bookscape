from __future__ import annotations

from dataclasses import asdict
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.csv_transfer import export_books_csv, import_books_csv

router = APIRouter()


class CsvPathIn(BaseModel):
    path: str


def _csv_path(raw: str) -> Path:
    path = Path(raw.strip()).expanduser()
    if not path.is_absolute() or path.suffix.lower() != ".csv":
        raise HTTPException(status_code=400, detail=f"Expected an absolute path to a .csv file: {raw}")
    return path


@router.post("/csv/export")
def export_csv(payload: CsvPathIn) -> dict:
    path = _csv_path(payload.path)
    try:
        return {"exported": export_books_csv(path)}
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"Could not write {path}: {e.strerror}") from e


@router.post("/csv/import")
def import_csv(payload: CsvPathIn) -> dict:
    path = _csv_path(payload.path)
    try:
        return asdict(import_books_csv(path))
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"Could not read {path}: {e.strerror}") from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
