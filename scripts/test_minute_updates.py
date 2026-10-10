from datetime import datetime, timezone
import unittest
from unittest.mock import patch

import minute_updates as updates


class MinuteUpdateTests(unittest.TestCase):
    def test_exact_prague_midnight_cutoff(self):
        self.assertTrue(updates.active(datetime(2026, 10, 10, 21, 59, 59, tzinfo=timezone.utc)))
        self.assertFalse(updates.active(datetime(2026, 10, 10, 22, tzinfo=timezone.utc)))
        self.assertFalse(updates.active(datetime(2027, 10, 10, 15, tzinfo=timezone.utc)))
        self.assertFalse(updates.active(datetime(2026, 10, 10, 11, tzinfo=timezone.utc)))

    def test_dispatches_when_idle(self):
        with patch.object(updates, "api", side_effect=[
            {"workflow_runs": [{"status": "completed"}]}, {},
        ]) as api:
            updates.tick()
        self.assertEqual(api.call_count, 2)
        self.assertEqual(api.call_args.args, (
            "actions/workflows/publish.yml/dispatches", {"ref": "main"},
        ))

    def test_does_not_queue_behind_active_publication(self):
        for status in ("queued", "in_progress", "waiting", "pending"):
            with self.subTest(status=status):
                with patch.object(updates, "api", return_value={
                    "workflow_runs": [{"status": status}],
                }) as api:
                    updates.tick()
                self.assertEqual(api.call_count, 1)


if __name__ == "__main__":
    unittest.main()
