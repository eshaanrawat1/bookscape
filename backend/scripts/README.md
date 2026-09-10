# Scripts

Command-line tooling for building out the catalog. All are run by hand, with
one exception noted below: the app shells out to `scraper.py --fetch-one`.

All resolve their paths relative to `backend/data/`, so they can be run from
any directory, and all write straight into `bookscape.db` through the same
`upsert_book()` / repository the API uses. There is no intermediate file: the
database is the single source of truth.

```
python backend/scripts/scraper.py               --seed <url>
python backend/scripts/backfill_reading_days.py --apply
```

`scraper.py` needs a Chromium that Playwright can drive, and installs one itself
on first use if the per-user browser cache is empty or has drifted out of sync
with the installed `playwright` version. Run `playwright install chromium` by
hand to front-load that download, or set `BOOKSCAPE_AUTO_INSTALL_BROWSER=0` to
turn the automatic install off and get the launch error instead.

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

---

## backfill_reading_days.py

Seeds `reading_days` — the table behind the stats heatmap — from books already
marked finished.

Reading is recorded forward from the moment of the edit: every write that moves
a book's `current_page` also writes a row for that local calendar day, so the
delta is captured where it is actually known rather than reconstructed later.
That is the right mechanism and it has one obvious gap — on an existing library
it knows nothing about the past, so the calendar renders empty for months and
looks broken rather than new.

For finished books we do have `start_date`, `finish_date` and `total_pages`, so
this spreads each book's pages evenly across the days it was open. That is
invented detail, and it is labelled as such: every row is written with
`source = 'backfill'`, so it can be styled differently in the UI, audited, or
removed wholesale.

```sql
DELETE FROM reading_days WHERE source = 'backfill';
```

| Flag | What it does |
|---|---|
| *(none)* | Dry run — prints the plan and writes nothing |
| `--apply` | Commit the rows |
| `--force` | Also backfill books that already have day history |

Books that already have rows are skipped, so a guess never overwrites a real
recorded day and re-running is a no-op. Books without a finish date or a page
count are skipped and counted in the summary — there is no day to attribute
their pages to, and inventing one would be a lie the heatmap can't distinguish
from data.
