# Bookscape

A local-first desktop reading tracker. Tauri shell, React frontend, FastAPI
backend, all running on your own machine — no accounts, no server.

## Structure

- `src-tauri/` — Rust/Tauri desktop shell; launches and supervises the backend
- `frontend/` — React + Vite UI
- `backend/app/` — FastAPI service (routes, services, JSON-file persistence)
- `backend/data/` — runtime JSON only (`books.json` catalog, `user_state.json`)
- `backend/scripts/` — standalone scraper tooling (`scraper.py`, `gradient.py`)

## Quickstart

1. Create the virtualenv and install backend deps:
   - `python3 -m venv .venv && source .venv/bin/activate`
   - `pip install -r requirements.txt`
2. Install frontend deps:
   - `npm --prefix frontend install`
3. Run the desktop app (starts Vite and the backend for you):
   - `npm run dev`

To run the pieces separately during development:

- Backend: `uvicorn backend.app.main:app --host 127.0.0.1 --port 9876 --reload`
- Frontend: `npm --prefix frontend run dev`

## Data

- `backend/data/books.json` — scraped Goodreads catalog, keyed by `uid`
- `backend/data/user_state.json` — your reading progress, lists, and notes

Both are plain JSON on disk. There is no auth and no sync; state is local-only.

## Obsidian sync

`POST /api/sync/obsidian` scans a vault folder of `.md` files with book
frontmatter and merges them into `user_state.json`. Personal fields (notes,
liked, want-to-read, lists) are preserved across syncs. Point it at your vault
with the `OBSIDIAN_VAULT_PATH` environment variable, or the
`obsidian_vault_path` key in `user_state.json`.

## Scraper

`backend/scripts/scraper.py` drives real Chromium via Playwright (Goodreads
sits behind an AWS WAF JS challenge that plain HTTP clients cannot pass). Both
scripts resolve their data paths relative to `backend/data/`, so they can be
run from any directory.

- `python backend/scripts/scraper.py --import-one <url>` — scrape one book
  (what the app's "Add Book" dialog shells out to)
- `python backend/scripts/scraper.py --seed <url>` — recursive crawl from a seed
- `python backend/scripts/scraper.py --stats` — frontier queue stats

Requires `playwright install chromium` once. `backend/scripts/gradient.py` runs
a separate rate-limited pass to extract dominant cover colors into `books.json`.
