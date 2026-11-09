# Bookscape

A local-first desktop reading tracker. Tauri shell, React frontend, FastAPI
backend, all running on your own machine — no accounts, no server.

https://github.com/user-attachments/assets/59140fa7-9576-4428-9930-c8c0e3efb3e3


## Structure

- `src-tauri/` — Rust/Tauri desktop shell; launches and supervises the backend
- `frontend/` — React + Vite UI
- `backend/app/` — FastAPI service (routes, services, SQLite persistence)
- `backend/data/` — runtime data only (`bookscape.db`)
- `backend/scripts/` — standalone scraper tooling (`scraper.py`)

## Quickstart

1. Create the virtualenv and install backend deps:
   - `python3 -m venv backend/.venv && source backend/.venv/bin/activate`
   - `pip install -r backend/requirements.txt`
   - Optionally `playwright install chromium` — the scraper downloads it on
     first use if it is missing, so this only front-loads the wait
2. Install frontend deps:
   - `npm --prefix frontend install`
3. Run the desktop app (starts Vite and the backend for you):
   - `npm run dev`

To run the pieces separately during development:

- Backend: `uvicorn backend.app.main:app --host 127.0.0.1 --port 9876 --reload`
- Frontend: `npm --prefix frontend run dev`

## Data

- `backend/data/bookscape.db` — SQLite database: the scraped Goodreads catalog
  (`books`), your personal reading state (`user_book_state`: status, progress,
  rating, notes), collections (`collections`/`collection_books`), and highlights
  (`highlights`: a passage, its page, and your note on it).

There is no auth and no cloud sync; everything is local-only. Collection
membership and highlights are Bookscape-only concepts and never leave the
database.

## CSV import and export

The upload and download icons in the top bar (or the command palette) import
from and export to a CSV file, one row per book, with these columns:

`uid`, `title`, `author`, `series`, `series_number`, `genres`, `description`,
`page_count`, `avg_rating`, `rating_count`, `review_count`, `image_url`,
`similar_book_ids`, `status`, `current_page`, `total_pages`, `start_date`,
`finish_date`, `my_rating`, `notes`

- Export writes the whole catalog. Books you have never tracked have blank
  reading columns.
- Import matches rows on `uid`, which is the only required column, and a book
  not already in the catalog also needs a `title`. A blank cell or absent column
  leaves the stored value alone, and importing never deletes anything.
- `genres` and `similar_book_ids` are `;`-separated. `status` is `not_started`,
  `want`, `reading`, `done`, or `dnf`. Dates are `YYYY-MM-DD`.
- A row with an invalid value is skipped and reported; the rest still import.

## Scraper

`backend/scripts/scraper.py` scrapes Goodreads via Playwright and writes
straight into `bookscape.db` — there is no intermediate file.

The app's "Add Book" dialog shells out to `scraper.py --fetch-one`, which
prints the book and saves nothing; the API persists the result itself.
Everything else is run by hand.

See [`backend/scripts/README.md`](backend/scripts/README.md) for the full mode
list and the crawl queue.
