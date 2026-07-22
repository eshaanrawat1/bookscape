from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .repository import DataRepository
from .services.catalog import has_data
from .services.reading import ReadingListStore
from .routes.catalog import create_router as create_catalog_router
from .routes.books import create_router as create_books_router
from .routes.lists import create_router as create_lists_router
from .routes.stats import create_router as create_stats_router
from .routes.sync import create_router as create_sync_router
from .routes.scraper import create_router as create_scraper_router


# App setup
ROOT = Path(__file__).resolve().parents[2]
BACKEND_API_VERSION = 2

app = FastAPI(title="Atlas API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

repo = DataRepository(ROOT)
lists = ReadingListStore(ROOT)

# Create and include routers
api_router = create_catalog_router(ROOT)
api_router.include_router(create_books_router(ROOT, repo))
api_router.include_router(create_lists_router(ROOT, repo, lists))
api_router.include_router(create_stats_router(ROOT, repo))
api_router.include_router(create_sync_router(ROOT))
api_router.include_router(create_scraper_router(ROOT))

app.include_router(api_router, prefix="/api")


@app.get("/health")
@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "has_data": has_data(ROOT), "backend_api_version": BACKEND_API_VERSION}