"""
observability.py
────────────────
Logging and metrics wiring, in one place.

Two rules shape this module:

  1. Library code never configures logging. Every other module does
     `logger = logging.getLogger(__name__)` and nothing else; handlers are
     attached exactly once, by whichever entry point is running — the FastAPI
     app in `main.py`, or `gradient.py`'s `main()`. That is what keeps the same
     service code usable from both without either fighting the other's config.

  2. Metric call sites are written for a backend that does not exist yet. The
     registry below is a dict of counters with a Prometheus-shaped API, so
     swapping it for `prometheus_client` later is a change to this file and
     nothing else. See `MetricsRegistry` for the cardinality rule that makes
     that swap safe.
"""

from __future__ import annotations

import json
import logging
import logging.handlers
import threading
from pathlib import Path

LOG_DIRNAME = "logs"
COVER_LOG_FILENAME = "covers.jsonl"

MAX_LOG_BYTES = 2 * 1024 * 1024
LOG_BACKUP_COUNT = 3

# Our own namespace. Configuring this rather than the root logger leaves
# uvicorn's and httpx's handlers untouched.
ROOT_LOGGER_NAME = "backend"

# Attributes the logging module puts on every record. Anything else present on
# a record arrived through `extra=` and is therefore part of the event payload.
_RESERVED_RECORD_KEYS = frozenset({
    "args", "asctime", "created", "exc_info", "exc_text", "filename",
    "funcName", "levelname", "levelno", "lineno", "message", "module",
    "msecs", "msg", "name", "pathname", "process", "processName",
    "relativeCreated", "stack_info", "taskName", "thread", "threadName",
})

_configured = False
_configure_lock = threading.Lock()


def log_dir(root: Path) -> Path:
    path = root / "backend" / "data" / LOG_DIRNAME
    path.mkdir(parents=True, exist_ok=True)
    return path


class JsonLinesFormatter(logging.Formatter):
    """One JSON object per line: standard fields, then the `extra=` payload
    merged in at the top level.

    Flat on purpose. `jq 'select(.status == "failed")'` and every log shipper
    worth using both expect top-level keys, and nesting the payload under a
    "fields" object buys nothing but an extra path segment in every query.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload: dict = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "event": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _RESERVED_RECORD_KEYS and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class MetricsRegistry:
    """In-process counters, shaped like the Prometheus client that will replace
    them.

    The cardinality rule, which is the whole reason this is not just a dict:
    label values must come from a bounded set. `status` and `reason` are enums
    with a handful of members, so `covers_attempts_total` tops out at a few
    dozen series. A uid or a title as a label value would mint a new series per
    book and eventually take the scrape down with it — those belong in the
    JSONL log, which is built for exactly that kind of high-cardinality detail.

    When this becomes real: replace the body with `prometheus_client.Counter`
    objects and mount `make_asgi_app()` at /metrics. Call sites do not change.
    """

    def __init__(self) -> None:
        self._counters: dict[tuple[str, tuple[tuple[str, str], ...]], int] = {}
        self._lock = threading.Lock()

    def increment(self, name: str, amount: int = 1, **labels: str) -> None:
        key = (name, tuple(sorted((k, str(v)) for k, v in labels.items())))
        with self._lock:
            self._counters[key] = self._counters.get(key, 0) + amount


metrics = MetricsRegistry()


def configure_logging(root: Path, *, console_level: int = logging.WARNING) -> None:
    """Attach handlers to the `backend` logger. Idempotent — calling it twice
    (app import plus a stray script import) will not double every line.

    Console gets WARNING and up so failures land next to uvicorn's own output
    where they will actually be noticed; the JSONL file gets everything from
    INFO, because a failures-only record cannot answer "what is the failure
    rate", and that ratio is the first thing worth graphing.
    """
    global _configured
    with _configure_lock:
        if _configured:
            return

        logger = logging.getLogger(ROOT_LOGGER_NAME)
        logger.setLevel(logging.INFO)
        # Ours are the only handlers that should see these records; letting them
        # bubble to the root logger duplicates every line under uvicorn.
        logger.propagate = False

        console = logging.StreamHandler()
        console.setLevel(console_level)
        console.setFormatter(logging.Formatter("[%(name)s] %(levelname)s %(message)s"))
        logger.addHandler(console)

        events = logging.handlers.RotatingFileHandler(
            log_dir(root) / COVER_LOG_FILENAME,
            maxBytes=MAX_LOG_BYTES,
            backupCount=LOG_BACKUP_COUNT,
            encoding="utf-8",
        )
        events.setLevel(logging.INFO)
        events.setFormatter(JsonLinesFormatter())
        logger.addHandler(events)

        _configured = True
