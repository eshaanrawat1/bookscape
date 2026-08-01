# Scripts

Standalone tooling for building out the catalog. Neither script is imported by
the app — both are run by hand from the command line, with one exception noted
below.

Both resolve their paths relative to `backend/data/`, so they can be run from
any directory, and both write straight into `bookscape.db` through the same
`upsert_book()` the API uses. There is no intermediate file: the database is
the single source of truth.

```
python backend/scripts/scraper.py  --seed <url>
python backend/scripts/gradient.py --limit 25
```

Requires `playwright install chromium` once.

---

## scraper.py

Scrapes Goodreads book pages. Drives real Chromium via Playwright because
Goodreads sits behind an AWS WAF JavaScript challenge that plain HTTP clients
cannot pass — only a browser that executes the challenge gets through.

Data is read from the rendered page in order of preference: `apolloState` JSON
(embedded in `__NEXT_DATA__`) → JSON-LD → OpenGraph meta tags → DOM selectors.
Similar books come from Goodreads' internal AppSync GraphQL endpoint, called
in-page via `page.evaluate()` so the request carries the same cookies and
fingerprint that solved the challenge.

### Modes

| Mode | What it does |
|---|---|
| `--fetch-one <url>` | Scrape one book, emit `@@STAGE@@` / `@@RESULT@@` / `@@ERROR@@` markers on stdout. **Saves nothing.** |
| `--import-one <url>` | Scrape one book and save it to the catalog. |
| `--seed <url>` | Add a URL to the queue and crawl recursively. |
| `--seed-file <file>` | Same, seeded from a file of URLs (one per line). |
| `--single <url>` | One seed plus its similar books, depth-limited to 1. |
| `--parse-one <url>` | Fetch, parse, pretty-print. Saves nothing, enqueues nothing. |
| `--stats` | Print frontier queue stats and exit. |
| `--headed` | Show the browser window (useful for debugging WAF challenges). |

`--fetch-one` is the one mode the app itself invokes — the "Add Book" dialog
shells out to it from [`routes/scraper.py`](../app/routes/scraper.py), streams
the staged progress markers to the UI, and persists the result itself once the
user confirms. Because it is on that hot path it is deliberately free of side
effects: it opens no database and creates no queue.

### The crawl queue

`--seed`, `--seed-file` and `--single` drain a frontier stored in
`backend/data/frontier.db`. It survives restarts and tracks each URL's depth,
which is what lets `--single` stop after one level. Books already in the
catalog are skipped on sight, so re-running a seed is cheap.

Each book is committed as it is scraped. A rate-limit shutdown (HTTP 429 / 502 /
503 triggers an immediate stop) therefore loses nothing — just run it again.

Scraping is slow on purpose: 12–20s between every outbound request, applied
uniformly to page loads and GraphQL calls alike.

### Cover colors

The scraper does not extract colors — it leaves `color` empty and
`gradient.py` fills it in later. That split is intentional, and safe because
`upsert_book()` only writes the keys it is given: re-scraping a book updates
its metadata without clobbering a color already found.

---

## gradient.py

Extracts one dominant color per cover via ColorThief and writes it to the
book's `color` column as `rgb(r, g, b)`. The frontend uses it to build the
glow behind each cover; books without one fall back to a neutral tint.

There is no input file to keep in sync — the work list *is* a query:

```sql
SELECT uid, title, image_url FROM books
WHERE color = '' AND image_url != ''
ORDER BY updated_at DESC
```

Newest first, so books just added by the app or the crawler get a color before
the long tail of the back catalog. Each color is committed the moment it is
found, and a colored book drops out of the query, so the run is resumable and
idempotent: interrupt it whenever, re-run, and it picks up exactly where it
stopped.

`--limit N` caps a single pass. Worth using — every book costs 8–14s of rate
limiting, so a few hundred uncolored books is an overnight job.

Like the scraper, it hard-stops on HTTP 429 / 502 / 503 rather than hammering a
host that is already pushing back.
