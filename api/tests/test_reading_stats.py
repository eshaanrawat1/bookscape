from __future__ import annotations

import tempfile
import unittest
from datetime import date
from pathlib import Path

from api.app.reading_stats import ReadingDailyStatsStore, compute_reading_stats


class ReadingDailyStatsStoreTests(unittest.TestCase):
    def test_pages_delta_non_negative(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            store = ReadingDailyStatsStore(Path(td))
            entries = {"b1": {"current_page": 20, "total_pages": 100, "status": "reading", "finish_date": ""}}
            first = store.run_snapshot(entries, run_date=date(2026, 5, 8), mode="manual")
            self.assertEqual(first.pages_read, 20)
            second = store.run_snapshot({"b1": {"current_page": 15, "total_pages": 100, "status": "reading", "finish_date": ""}}, run_date=date(2026, 5, 8), mode="manual")
            self.assertEqual(second.pages_read, 0)

    def test_completion_only_once(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            store = ReadingDailyStatsStore(Path(td))
            store.run_snapshot({"b1": {"current_page": 40, "total_pages": 100, "status": "reading", "finish_date": ""}}, run_date=date(2026, 5, 8), mode="manual")
            first_done = store.run_snapshot({"b1": {"current_page": 100, "total_pages": 100, "status": "done", "finish_date": "2026-05-08"}}, run_date=date(2026, 5, 8), mode="manual")
            second_done = store.run_snapshot({"b1": {"current_page": 100, "total_pages": 100, "status": "done", "finish_date": "2026-05-08"}}, run_date=date(2026, 5, 8), mode="manual")
            self.assertEqual(first_done.books_completed, 1)
            self.assertEqual(second_done.books_completed, 0)

    def test_scheduled_idempotency(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            store = ReadingDailyStatsStore(Path(td))
            store.run_snapshot({"b1": {"current_page": 10, "total_pages": 100, "status": "reading", "finish_date": ""}}, run_date=date(2026, 5, 8), mode="scheduled")
            second = store.run_snapshot({"b1": {"current_page": 20, "total_pages": 100, "status": "reading", "finish_date": ""}}, run_date=date(2026, 5, 8), mode="scheduled")
            self.assertTrue(second.skipped)

    def test_login_backup_then_nightly_finalize(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            store = ReadingDailyStatsStore(Path(td))
            # Day 1 login reserve
            store.run_login_backup({"b1": {"current_page": 10, "total_pages": 100, "status": "reading", "finish_date": ""}}, run_date=date(2026, 5, 8))
            # Day 1 nightly finalize should use reserve->current (10 -> 40)
            out = store.run_nightly_finalize({"b1": {"current_page": 40, "total_pages": 100, "status": "reading", "finish_date": ""}}, run_date=date(2026, 5, 8))
            self.assertFalse(out.get("skipped", False))
            self.assertEqual(out["pages_read"], 30)

    def test_missed_nightly_uses_fallback_next_morning(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            store = ReadingDailyStatsStore(Path(td))
            # Reserve on day 1, skip nightly.
            store.run_login_backup({"b1": {"current_page": 12, "total_pages": 100, "status": "reading", "finish_date": ""}}, run_date=date(2026, 5, 8))
            # Next day login triggers fallback for previous day.
            out = store.run_login_backup({"b1": {"current_page": 20, "total_pages": 100, "status": "reading", "finish_date": ""}}, run_date=date(2026, 5, 9))
            self.assertTrue(out["fallback_applied"])
            rows = store.list_daily()
            self.assertIn("2026-05-08", rows)


class ComputeReadingStatsTests(unittest.TestCase):
    def test_yearly_monthly_daily_boundaries(self) -> None:
        entries = {
            "a": {"status": "done", "finish_date": "2024-01-01", "total_pages": 100, "current_page": 100},
            "b": {"status": "done", "finish_date": "2024-02-29", "total_pages": 200, "current_page": 200},
            "c": {"status": "done", "finish_date": "2023-12-31", "total_pages": 300, "current_page": 300},
        }
        out = compute_reading_stats(entries, today=date(2024, 2, 29))
        self.assertEqual(out["daily"]["totalBooksRead"], 1)
        self.assertEqual(out["monthly"]["totalBooksRead"], 1)
        self.assertEqual(out["yearly"]["totalBooksRead"], 2)
        self.assertEqual(out["all"]["totalBooksRead"], 3)


if __name__ == "__main__":
    unittest.main()
