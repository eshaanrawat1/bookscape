# Bookscape

A local-first desktop reading tracker. Tauri shell, React frontend, FastAPI
backend, all running on your own machine — no accounts, no server.

## Structure

- `src-tauri/` — Rust/Tauri desktop shell; launches and supervises the backend
- `frontend/` — React + Vite UI
- `backend/app/` — FastAPI service (routes, services, SQLite persistence)
- `backend/data/` — runtime data only (`bookscape.db`)
- `backend/scripts/` — standalone scraper tooling (`scraper.py`, `gradient.py`)

## Quickstart

1. Create the virtualenv and install backend deps:
   - `python3 -m venv backend/.venv && source backend/.venv/bin/activate`
   - `pip install -r backend/requirements.txt`
   - `playwright install chromium`
2. Install frontend deps:
   - `npm --prefix frontend install`
3. Run the desktop app (starts Vite and the backend for you):
   - `npm run dev`

To run the pieces separately during development:

- Backend: `uvicorn backend.app.main:app --host 127.0.0.1 --port 9876 --reload`
- Frontend: `npm --prefix frontend run dev`

## Data

- `backend/data/bookscape.db` — SQLite database: the scraped Goodreads catalog
  (`books`, `genres`/`book_genres`), your personal reading state
  (`user_book_state`: status, progress, notes, liked, want-to-read), and
  collections (`collections`/`collection_books`).

There is no auth and no cloud sync; everything is local-only. `liked`,
`want_to_read`, and collection membership are Bookscape-only concepts and
never leave the database.

## Obsidian vault

Point Bookscape at any folder — via the file icon in the top bar (native
folder picker) or `PUT /api/settings/vault-path` — and Push/Pull your
reading/finished books as `.md` notes, at either the whole-vault level or a
single book at a time:

- `POST /api/sync/obsidian` / `POST /api/sync/obsidian/pull/{uid}` — import
  notes from the vault. Only books with `status: reading` or `status: done`
  are imported; a scan of 0 files is treated as an error (protects against an
  unmounted drive), and importing never deletes existing Bookscape state.
- `POST /api/sync/obsidian/push` / `POST /api/sync/obsidian/push/{uid}` —
  export reading/finished books to the vault, full-regenerated each time.
  Filenames are derived from the title and reused thereafter; a title
  collision between two books is skipped (not fatal) and reported back for
  manual resolution in Obsidian. Notes round-trip like status/progress/dates —
  whichever direction (Push or Pull) ran most recently wins.

All of the above accept `?dry_run=true` to preview without writing.

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
