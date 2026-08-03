# Scripts

Command-line tooling for building out the catalog. All are run by hand, with
two exceptions noted below: the app shells out to `scraper.py --fetch-one`, and
`gradient.py` is now a front end for a service the app also runs on its own.

All resolve their paths relative to `backend/data/`, so they can be run from
any directory, and all write straight into `bookscape.db` through the same
`upsert_book()` / repository the API uses. There is no intermediate file: the
database is the single source of truth.

```
python backend/scripts/scraper.py               --seed <url>
python backend/scripts/gradient.py              --limit 25
python backend/scripts/backfill_reading_days.py --apply
```

`scraper.py` requires `playwright install chromium` once.

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

**You do not normally need to run this.** The logic lives in
[`app/services/covers.py`](../app/services/covers.py), and the API runs it
continuously on a background thread — a book imported through the app gets its
color within a few seconds. This script is the same code with a terminal in
front of it, for draining a large backlog faster than an idle desktop app will
and for reviewing what went wrong.

There is no input file to keep in sync — the work list *is* a query:

```sql
SELECT uid, title, image_url FROM books
WHERE color = '' AND image_url != ''
  AND uid NOT IN (SELECT uid FROM cover_attempts)
ORDER BY updated_at DESC
```

Newest first, so books just added by the app or the crawler get a color before
the long tail of the back catalog. Each color is committed the moment it is
found, so a run is resumable: interrupt it whenever, re-run, and it picks up
where it stopped.

| Flag | What it does |
|---|---|
| `--limit N` | Attempt at most N books. Every one costs 8–14s of rate limiting, so a few hundred is an overnight job. |
| `--status` | Print queue depth and failure count, then exit. |
| `--retry-failed` | Forget every recorded failure so those books queue again. |

### Attempted exactly once

`cover_attempts` holds one row per book we have tried, and its `PRIMARY KEY` is
what makes "once" a constraint rather than a convention. A runner *claims* a
book by inserting `pending` there before downloading, so the background worker
and a hand-run `gradient.py` can never pick the same book, and a process killed
mid-fetch leaves a visible claim instead of quietly redoing the work. Claims
older than an hour are assumed abandoned and released at startup.

Failures split two ways, and the split is the whole point:

| Outcome | Meaning | Result |
|---|---|---|
| `ok` | Color extracted | recorded, book leaves the queue |
| `http_status` | Cover URL returned 404/403/… | recorded `failed`, never retried |
| `decode_error` | ColorThief cannot read the bytes | recorded `failed`, never retried |
| `empty_image` | Book has no cover URL | recorded `failed`, never retried |
| `rate_limited` | HTTP 429 / 502 / 503 | **claim released**, worker backs off 10 min |
| `network_error` | Connection failed | **claim released**, retried later |

The first four are attributable to the book and will not change on a retry. The
last two are about us, not the cover — recording those as terminal would
permanently un-color every book that happened to be in flight during a
rate-limit window.

### Reviewing failures

Every attempt, from both the script and the app, is appended to
`backend/data/logs/covers.jsonl` (rotating, 2 MB × 3):

```bash
jq 'select(.status == "failed")' backend/data/logs/covers.jsonl
```

All attempts are logged rather than just failures, because a failures-only file
cannot answer "what is the failure rate" — and those counters are already being
kept in-process by
[`app/observability.py`](../app/observability.py), ready to be exposed at
`/metrics` when that is wanted. Once a cause is fixed, `--retry-failed` puts
the affected books back in the queue.

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
