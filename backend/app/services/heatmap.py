"""Shaping for the reading heatmap.

Everything here is pure: it works on the plain
`[{"date", "pages", "books", "book_ids"}]` list `DataRepository.reading_days()`
returns, so the calendar arithmetic and the bucketing can be exercised without
touching a database. The repository owns the SQL, the route owns the HTTP, and
the awkward parts — week alignment, quantiles, streaks — live here.
"""

from __future__ import annotations

from datetime import date, timedelta

DEFAULT_DAYS = 371  # 53 weeks, so a full year always fills the grid
LEVELS = 4


def window(end: date, days: int = DEFAULT_DAYS) -> tuple[date, date]:
    """Inclusive [start, end] spanning at least `days`, starting on a Sunday.

    The Sunday alignment is not cosmetic: the grid is laid out in columns of
    seven, so a start mid-week shifts every weekday into the wrong row and the
    horizontal day-of-week bands turn into noise.
    """
    start = end - timedelta(days=max(1, days) - 1)
    return start - timedelta(days=(start.weekday() + 1) % 7), end


def year_window(year: int) -> tuple[date, date]:
    """A full calendar year, padded out to whole Sunday–Saturday weeks.

    The grid's columns are weeks, so a year starting mid-week needs its leading
    and trailing partial weeks included: without the padding the first and last
    columns come up short and every row below shifts out of its weekday.
    """
    first, last = date(year, 1, 1), date(year, 12, 31)
    return (
        first - timedelta(days=(first.weekday() + 1) % 7),
        last + timedelta(days=(5 - last.weekday()) % 7),
    )


def thresholds(days: list[dict], levels: int = LEVELS) -> list[int]:
    """Quantile cut points over the days that had reading.

    Quantiles rather than fractions of the maximum, because one 600-page binge
    would otherwise push every ordinary 30-page day into the palest bucket and
    the whole year would render as though nothing happened.
    """
    counts = sorted(d["pages"] for d in days if d["pages"] > 0)
    if not counts or levels < 2:
        return []
    return [
        counts[min(len(counts) - 1, len(counts) * (i + 1) // levels)]
        for i in range(levels - 1)
    ]


def level(pages: int, cuts: list[int]) -> int:
    """1-based intensity bucket for a day; 0 means nothing was read."""
    if pages <= 0:
        return 0
    return 1 + sum(1 for cut in cuts if pages >= cut)


def streaks(days: list[dict], today: date) -> dict:
    """Longest and current runs of consecutive reading days.

    Both are measured inside the requested window, so a run that began before
    `start` is reported from `start`. The current streak counts a run ending
    yesterday as still live — otherwise it would read zero every morning until
    the day's first page was logged.
    """
    dates = sorted(date.fromisoformat(d["date"]) for d in days)
    if not dates:
        return {"current": 0, "longest": 0}

    longest = run = 1
    for previous, current in zip(dates, dates[1:]):
        run = run + 1 if (current - previous).days == 1 else 1
        longest = max(longest, run)

    return {"current": run if (today - dates[-1]).days <= 1 else 0, "longest": longest}


def build(days: list[dict], *, start: date, end: date, today: date, levels: int = LEVELS) -> dict:
    """Assemble the heatmap payload.

    `days` stays sparse — only days with reading are listed, and the client
    fills the empty cells from `start`/`end`. A dense year would be ~370
    mostly-zero objects for no benefit.
    """
    cuts = thresholds(days, levels)
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "days": [{**day, "level": level(day["pages"], cuts)} for day in days],
        "thresholds": cuts,
        "levels": levels,
        "total_pages": sum(day["pages"] for day in days),
        "days_read": len(days),
        "best_day": max(days, key=lambda day: day["pages"], default=None),
        "streak": streaks(days, today),
    }
