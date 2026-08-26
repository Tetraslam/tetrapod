import importlib.machinery
import importlib.util
import pathlib
import unittest
from collections import namedtuple


SCRIPT = pathlib.Path(__file__).parents[1] / "bin" / "storage-telemetry"
loader = importlib.machinery.SourceFileLoader("storage_telemetry", str(SCRIPT))
spec = importlib.util.spec_from_loader(loader.name, loader)
telemetry = importlib.util.module_from_spec(spec)
loader.exec_module(telemetry)


class MathTests(unittest.TestCase):
    def test_percent_is_rounded_and_handles_edge_cases(self):
        self.assertEqual(telemetry.percent(1, 3), 33.3)
        self.assertEqual(telemetry.percent(200, 100), 200.0)
        self.assertEqual(telemetry.percent(-1, 100), 0.0)
        self.assertEqual(telemetry.percent(1, 0), 0.0)

    def test_forecast_adds_remaining_bytes_and_reports_over_capacity(self):
        self.assertEqual(telemetry.forecast(60, 100, 15), (75, 75.0))
        self.assertEqual(telemetry.forecast(90, 100, 50), (140, 140.0))
        self.assertEqual(telemetry.forecast(60, 100, None), (None, None))

    def test_download_math_uses_amount_left_or_total_minus_completed(self):
        original = telemetry.fetch_json
        telemetry.fetch_json = lambda _url: [
            {"name": "secret", "hash": "secret", "amount_left": 12},
            {"path": "/secret", "total_size": 20, "completed": 5},
            {"name": "finished", "amount_left": 0, "progress": 1},
            {"name": "metadata", "amount_left": 0, "progress": 0},
            "invalid",
        ]
        try:
            self.assertEqual(telemetry.fetch_downloads(), (3, None))
        finally:
            telemetry.fetch_json = original

    def test_download_math_is_known_when_every_size_is_available(self):
        original = telemetry.fetch_json
        telemetry.fetch_json = lambda _url: [
            {"amount_left": 12, "progress": 0.4},
            {"amount_left": 0, "total_size": 20, "completed": 5, "progress": 0.25},
        ]
        try:
            self.assertEqual(telemetry.fetch_downloads(), (2, 27))
        finally:
            telemetry.fetch_json = original


class SortingTests(unittest.TestCase):
    def test_largest_titles_combines_arrs_sorts_and_limits(self):
        series = [{"title": f"Series {i}", "statistics": {"sizeOnDisk": i}} for i in range(7)]
        movies = [{"title": "Movie", "statistics": {"sizeOnDisk": 100}}]
        result = telemetry.largest_titles(("series", series), ("movie", movies))
        self.assertEqual([item["title"] for item in result], ["Movie", "Series 6", "Series 5", "Series 4", "Series 3"])
        self.assertEqual(result[0], {"title": "Movie", "type": "movie", "size_bytes": 100})

    def test_sorting_is_stable_for_ties_and_ignores_bad_records(self):
        records = [
            {"title": "zeta", "statistics": {"sizeOnDisk": 10}},
            {"title": "Alpha", "statistics": {"sizeOnDisk": 10}},
            {"title": ""},
            {"title": "bad", "statistics": {"sizeOnDisk": "ten"}},
        ]
        self.assertEqual([x["title"] for x in telemetry.largest_titles(("series", records))], ["Alpha", "zeta"])


class CacheTests(unittest.TestCase):
    def test_reuses_collection_within_thirty_seconds(self):
        calls = []

        def collector():
            calls.append(True)
            return {"call": len(calls)}, 200

        cache = telemetry.TelemetryCache(30, collector)
        self.assertIs(cache.get()[0], cache.get()[0])
        self.assertEqual(len(calls), 1)


class PartialFailureTests(unittest.TestCase):
    Disk = namedtuple("Disk", "total used free")

    @staticmethod
    def fail():
        raise RuntimeError("secret api key / torrent name")

    def test_arr_partial_failure_keeps_download_and_other_arr_data(self):
        payload, status = telemetry.collect(
            disk_usage=lambda _path: self.Disk(100, 40, 60),
            downloads=lambda: (2, 10),
            sonarr=self.fail,
            radarr=lambda: [{"title": "Movie", "statistics": {"sizeOnDisk": 20}}],
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["forecast"], {"used_bytes": 50, "used_percent": 50.0})
        self.assertEqual(payload["warnings"], ["sonarr_unavailable"])
        self.assertEqual(payload["largest_titles"][0]["title"], "Movie")
        self.assertNotIn("secret", str(payload))

    def test_download_failure_makes_forecast_unknown(self):
        payload, status = telemetry.collect(
            disk_usage=lambda _path: self.Disk(100, 40, 60),
            downloads=self.fail,
            sonarr=lambda: [],
            radarr=lambda: [],
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["downloads"], {"incomplete_count": None, "pending_bytes": None})
        self.assertEqual(payload["forecast"], {"used_bytes": None, "used_percent": None})
        self.assertEqual(payload["warnings"], ["downloads_unavailable"])

    def test_storage_failure_is_sanitized_and_returns_unavailable(self):
        payload, status = telemetry.collect(
            disk_usage=lambda _path: self.fail(),
            downloads=lambda: (1, 10),
            sonarr=lambda: [],
            radarr=lambda: [],
        )
        self.assertEqual(status, 503)
        self.assertEqual(payload["storage"]["total_bytes"], None)
        self.assertEqual(payload["warnings"], ["storage_unavailable"])
        self.assertNotIn("RuntimeError", str(payload))

    def test_all_upstream_failures_still_have_stable_schema(self):
        payload, status = telemetry.collect(
            disk_usage=lambda _path: self.Disk(100, 25, 75),
            downloads=self.fail,
            sonarr=self.fail,
            radarr=self.fail,
        )
        self.assertEqual(status, 200)
        self.assertEqual(set(payload), {"version", "generated_at", "storage", "downloads", "forecast", "largest_titles", "warnings"})
        self.assertEqual(payload["warnings"], ["downloads_unavailable", "radarr_unavailable", "sonarr_unavailable"])


if __name__ == "__main__":
    unittest.main()
