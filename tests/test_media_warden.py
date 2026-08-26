import importlib.util
import importlib.machinery
import time
import unittest
from pathlib import Path


PATH = Path(__file__).parents[1] / "provision/bin/media-warden"
SPEC = importlib.util.spec_from_loader(
    "media_warden", importlib.machinery.SourceFileLoader("media_warden", str(PATH))
)
warden = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(warden)


class DecisionTests(unittest.TestCase):
    def test_watermarks(self):
        self.assertEqual(warden.storage_action(79.99), "hold")
        self.assertEqual(warden.storage_action(80), "pressure")
        self.assertEqual(warden.storage_action(64.99), "relaxed")
        self.assertEqual(warden.storage_action(65), "hold")

    def test_size_limits(self):
        self.assertEqual(warden.size_limit("Standard", "movie", 1080), 15 * warden.GIB)
        self.assertEqual(warden.size_limit("Cinema", "episode", 2160), 12 * warden.GIB)
        self.assertIsNone(warden.size_limit("Standard", "movie", 720))

    def test_seed_policy(self):
        now = int(time.time())
        self.assertTrue(warden.torrent_seed_satisfied({"ratio": 1}, now))
        self.assertTrue(warden.torrent_seed_satisfied({"ratio": 0, "completion_on": now - warden.SEVEN_DAYS}, now))
        self.assertFalse(warden.torrent_seed_satisfied({"ratio": 0.9, "completion_on": now - 60}, now))

    def test_queue_download_ids_are_normalized(self):
        records = [{"downloadId": "ABC123"}, {"downloadId": ""}, {}]
        self.assertEqual(warden.queue_download_ids(records), {"abc123"})

    def test_only_active_downloads_are_owned_for_pause(self):
        self.assertTrue(warden.torrent_is_active_download({"progress": 0.5, "state": "downloading"}))
        self.assertTrue(warden.torrent_is_active_download({"progress": 0, "state": "queuedDL"}))
        self.assertTrue(warden.torrent_is_active_download({"progress": 0.5, "state": "checkingResumeData"}))
        self.assertFalse(warden.torrent_is_active_download({"progress": 0.5, "state": "stoppedDL"}))
        self.assertFalse(warden.torrent_is_active_download({"progress": 1, "state": "uploading"}))

    def test_release_safeguards(self):
        limit = 10_000
        good = {"quality": {"quality": {"resolution": 1080}}, "seeders": 3, "size": limit, "rejections": []}
        self.assertTrue(warden.release_is_safe(good, limit))
        for field, value in (("seeders", 2), ("size", limit + 1), ("rejections", ["bad"])):
            candidate = dict(good)
            candidate[field] = value
            self.assertFalse(warden.release_is_safe(candidate, limit))
        low_resolution = dict(good, quality={"quality": {"resolution": 720}})
        self.assertFalse(warden.release_is_safe(low_resolution, limit))

    def test_release_choice_prefers_seeders_then_size(self):
        releases = [
            {"quality": {"resolution": 1080}, "seeders": 3, "size": 500, "rejections": []},
            {"quality": {"resolution": 1080}, "seeders": 5, "size": 900, "rejections": []},
            {"quality": {"resolution": 1080}, "seeders": 5, "size": 700, "rejections": []},
        ]
        self.assertEqual(warden.choose_release(releases, 1000)["size"], 700)

    def test_media_path_guard_rejects_traversal(self):
        root = Path("/srv/media")
        self.assertTrue(warden.path_within(root / "library/movie.mkv", root))
        self.assertFalse(warden.path_within(root / "library/../../etc/passwd", root))
        self.assertFalse(warden.path_within(Path("relative/movie.mkv"), root))


if __name__ == "__main__":
    unittest.main()
