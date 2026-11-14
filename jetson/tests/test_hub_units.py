"""Run from jetson/:  .venv/bin/python -m unittest discover tests"""
import unittest

from marswalk.alerts import SuitTempAlert
from marswalk.intents import parse
from marswalk.speech import status_sentence, temp_words


class AlertTest(unittest.TestCase):
    def run_seq(self, temps):
        a = SuitTempAlert()
        return [m for t in temps for m in a.update(t)]

    def kinds(self, temps):
        return [(t, p.get("level")) for t, p in self.run_seq(temps)]

    def test_level_follows_the_temperature_down(self):
        # 33.9 is under the critical threshold by more than the margin: back to warn.
        # 28.9 is under the warn threshold by more than the margin: cleared.
        self.assertEqual(self.kinds([25, 30, 31, 35, 34.5, 33.9, 31, 29.5, 28.9, 26]),
                         [("alert.raise", "warn"), ("alert.raise", "critical"),
                          ("alert.raise", "warn"), ("alert.clear", None)])

    def test_alarm_does_not_outlast_the_temperature(self):
        # The fault seen on the hub: critical was still raised at 29 degrees after a peak of 36.
        a = SuitTempAlert()
        for t in [24, 36, 32.6]:
            a.update(t)
        self.assertEqual(a.level, "warn")
        a.update(28.5)
        self.assertIsNone(a.level)

    def test_straight_to_critical_and_straight_back(self):
        self.assertEqual(self.kinds([24, 36, 24]), [("alert.raise", "critical"), ("alert.clear", None)])

    def test_no_alert_below_the_threshold(self):
        self.assertEqual(self.kinds([24, 29.9, 29.5, 29.99, 28]), [])

    def test_hysteresis_no_flapping(self):
        # hovering around a threshold raises once and does not clear inside the margin
        self.assertEqual(self.kinds([30, 29.5, 30.2, 29, 30]), [("alert.raise", "warn")])
        self.assertEqual(self.kinds([35, 34.5, 35.2, 34, 35])[1:], [])

    def test_easing_message(self):
        msgs = self.run_seq([36, 33])
        self.assertEqual(msgs[1][1]["message"], "Suit temperature is high")

    def test_none_ignored(self):
        self.assertEqual(self.run_seq([None, None]), [])


class IntentTest(unittest.TestCase):
    CASES = {
        # short forms
        "Status.": ("status.report", {}),
        "Navigate": ("nav.start", {"targetId": "near"}),
        "Take me there": ("nav.start", {"targetId": "near"}),
        "Guide me to the nearby point": ("nav.start", {"targetId": "near"}),
        "base": ("nav.home", {}),
        "Stop.": ("nav.stop", {}),
        "Mark target": ("nav.mark", {}),
        "thermal": ("layer.show", {"id": "thermal"}),
        "Elevation.": ("layer.show", {"id": "topo"}),
        "confirm": ("alert.ack", {}),
        # full sentences still work
        "Take me to the survey site": ("nav.start", {"targetId": "site1"}),
        "Guide me to the sulfur rocks.": ("nav.start", {"targetId": "site1"}),
        "Go back to base": ("nav.home", {}),
        "Return to base.": ("nav.home", {}),
        "Stop navigation": ("nav.stop", {}),
        "Mark here.": ("nav.mark", {}),
        "Show the thermal map": ("layer.show", {"id": "thermal"}),
        "show the slope": ("layer.show", {"id": "slope"}),
        "Status report": ("status.report", {}),
        "Acknowledge alert": ("alert.ack", {}),
        # as the STT sometimes writes them
        "Show the thermo mat.": ("layer.show", {"id": "thermal"}),
        "takeme to the survey site": ("nav.start", {"targetId": "site1"}),
        "Statis.": ("status.report", {}),
        "Acknowlege": ("alert.ack", {}),
    }

    def test_examples(self):
        for text, (intent, slots) in self.CASES.items():
            with self.subTest(text=text):
                r = parse(text)
                self.assertIsNotNone(r)
                self.assertEqual((r["intent"], r["slots"]), (intent, slots))

    def test_wake_word(self):
        self.assertIsNone(parse("take me to the survey site", wake="helmet"))
        self.assertEqual(parse("Helmet, take me to the survey site.", wake="helmet")["intent"],
                         "nav.start")
        self.assertEqual(parse("Helmets status", wake="helmet")["intent"], "status.report")

    def test_unknown_dropped(self):
        # The last ones were commands until the list was pruned: ordinary words must do nothing.
        for text in ["what is for lunch today", "", "shop", "the", "bass", "Night mode", "copy that",
                     "let's go home", "take a photo", "Clear target", "what's the situation"]:
            with self.subTest(text=text):
                self.assertIsNone(parse(text))

    def test_custom_file_and_reload(self):
        import json, os, tempfile, time
        from marswalk.intents import CommandSet
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "c.json")
            def write(cmds):
                with open(path, "w") as f:
                    json.dump({"commands": cmds}, f)
            write([{"intent": "greet", "phrases": ["hello"], "reply": "Visor online"}])
            cs = CommandSet(path)
            r = cs.parse("Hello there")
            self.assertEqual((r["intent"], r["reply"]), ("greet", "Visor online"))
            self.assertIsNone(cs.parse("photograph"))
            write([{"intent": "camera.shot", "phrases": ["photograph", "take a picture"]}])
            os.utime(path, (time.time() + 5, time.time() + 5))   # make the change visible
            self.assertEqual(cs.parse("photograph")["intent"], "camera.shot")
            with open(path, "w") as f:
                f.write("{ not json")
            os.utime(path, (time.time() + 9, time.time() + 9))
            self.assertEqual(cs.parse("photograph")["intent"], "camera.shot")  # old set kept


class MenuTest(unittest.TestCase):
    def test_menu_is_short_and_carries_the_mode(self):
        from marswalk.intents import menu
        entries = menu()[1]
        self.assertEqual([e["say"] for e in entries],
                         ["Status", "Navigate", "Base", "Mark target", "Stop", "Confirm"])
        modes = {e["say"]: e.get("mode") for e in entries}
        self.assertEqual((modes["Base"], modes["Mark target"], modes["Stop"]), ("mars", "field", None))


class SpeechTest(unittest.TestCase):
    def test_numbers(self):
        self.assertEqual(temp_words(24.5), "twenty-four point five degrees")
        self.assertEqual(temp_words(30.0), "thirty degrees")
        self.assertEqual(temp_words(110.04), "one hundred ten degrees")
        self.assertEqual(temp_words(-3.2), "minus three point two degrees")
        self.assertEqual(temp_words(0), "zero degrees")
        self.assertEqual(temp_words(1), "one degree")

    def test_status(self):
        s = status_sentence(36.0, "arduino",
                            {"suit-temp": {"level": "critical"}}, {"navStatus": "ok"})
        self.assertEqual(s, "Suit temperature thirty-six degrees. One critical alert. "
                            "Route guidance active.")
        self.assertEqual(status_sentence(None, "arduino", {}, {}),
                         "Suit temperature sensor is not responding. No alerts.")


class MapStoreTest(unittest.TestCase):
    """The field map on disk, in tiles (marswalk/maps.py)."""

    def tile(self, x=0, z=0, obstacle_cells=3):
        # a 4 x 4 tile: `obstacle_cells` obstacles, then floor, then unseen
        return {"x": x, "z": z, "runs": [1, obstacle_cells, 0, 5, 255, 16 - 5 - obstacle_cells]}

    def payload(self, run="abc-0", tiles=None):
        return {"run": run, "cellSizeM": 0.1, "tileCells": 4,
                "tiles": [self.tile()] if tiles is None else tiles,
                "source": "room-scan+depth", "stats": {"obstacles": 3}}

    def test_a_run_is_one_file_holding_the_latest_of_each_tile(self):
        import json
        import tempfile
        from marswalk.maps import MapStore
        with tempfile.TemporaryDirectory() as d:
            store = MapStore(d)
            self.assertIsNone(store.latest)
            self.assertIsNone(store.stored())
            path = store.save(self.payload(tiles=[self.tile(0, 0, 3), self.tile(-1, 2, 1)]))
            # the next update brings one changed tile and one new one; the third is not in it
            self.assertEqual(store.save(self.payload(tiles=[self.tile(0, 0, 4), self.tile(5, -7, 2)])), path)
            data = json.loads(path.read_text())
            self.assertEqual(sorted(data["tiles"]), ["-1,2", "0,0", "5,-7"])
            self.assertEqual(data["tiles"]["0,0"][:2], [1, 4])     # replaced by the later update
            self.assertEqual(data["tiles"]["-1,2"][:2], [1, 1])    # kept from the first
            self.assertEqual((data["updates"], data["tileCells"], data["cellSizeM"]), (2, 4, 0.1))
            other = store.save(self.payload(run="abc-1"))
            self.assertNotEqual(other, path)                   # new coordinates: the old map is kept as it was
            self.assertEqual(len(list(path.parent.glob("field-*.json"))), 2)
            self.assertEqual(len(json.loads(path.read_text())["tiles"]), 3)

    def test_the_newest_run_is_handed_back_as_a_list_of_tiles(self):
        import tempfile
        from marswalk.maps import MapStore
        with tempfile.TemporaryDirectory() as d:
            store = MapStore(d)
            store.save(self.payload(run="old-0", tiles=[self.tile(9, 9)]))
            store.save(self.payload(tiles=[self.tile(0, 0, 3), self.tile(-1, 2, 1)]))
            store.save(self.payload(tiles=[self.tile(0, 0, 4)]))
            m = store.stored()
            self.assertEqual((m["run"], m["cellSizeM"], m["tileCells"], m["updates"]), ("abc-0", 0.1, 4, 2))
            self.assertEqual(sorted((t["x"], t["z"], t["runs"][1]) for t in m["tiles"]), [(-1, 2, 1), (0, 0, 4)])
            self.assertTrue(m["startedAt"] and m["savedAt"])
            self.assertEqual(sorted(m), ["cellSizeM", "run", "savedAt", "startedAt", "tileCells", "tiles", "updates"])

    def test_the_newest_run_survives_a_restart_and_goes_on_in_its_file(self):
        import json
        import tempfile
        from marswalk.maps import MapStore
        with tempfile.TemporaryDirectory() as d:
            store = MapStore(d)
            store.save(self.payload(run="abc-0", tiles=[self.tile(1, 1)]))
            path = store.save(self.payload(run="abc-1", tiles=[self.tile(0, 0, 3), self.tile(-1, 2, 1)]))
            # after a restart of the hub the newest map is still there to hand back
            again = MapStore(d)
            self.assertEqual(again.latest["run"], "abc-1")
            self.assertEqual(sorted((t["x"], t["z"]) for t in again.stored()["tiles"]), [(-1, 2), (0, 0)])
            # the headset is still in that run: its next tiles join the ones from before the restart
            self.assertEqual(again.save(self.payload(run="abc-1", tiles=[self.tile(3, 0, 2)])), path)
            data = json.loads(path.read_text())
            self.assertEqual((sorted(data["tiles"]), data["updates"]), (["-1,2", "0,0", "3,0"], 2))
            # so does an older run that is not the newest: it finds its own file again
            first = again.save(self.payload(run="abc-0", tiles=[self.tile(2, 2)]))
            self.assertEqual(sorted(json.loads(first.read_text())["tiles"]), ["1,1", "2,2"])
            self.assertEqual(len(list(path.parent.glob("field-*.json"))), 2)

    def test_files_that_are_not_maps_in_tiles_are_skipped(self):
        import json
        import os
        import tempfile
        import time
        from pathlib import Path
        from marswalk.maps import MapStore
        with tempfile.TemporaryDirectory() as d:
            good = MapStore(d).save(self.payload())
            # newer than the good one: a map from before the tiles, a broken tile, and no JSON at all
            old_format = {"run": "old-0", "originXZ": [-8, -8], "cellSizeM": 0.1, "cols": 4, "rows": 4,
                          "runs": [255, 16], "savedAt": "2026-01-01T00:00:00", "updates": 1}
            bad_tile = {"run": "bad-0", "cellSizeM": 0.1, "tileCells": 4, "tiles": {"0,0": [1, 15]}}
            later = time.time() + 5
            for name, text in (("field-20990101-000000-old-0.json", json.dumps(old_format)),
                               ("field-20990101-000001-bad-0.json", json.dumps(bad_tile)),
                               ("field-20990101-000002-junk.json", "{ not json")):
                path = Path(d) / name
                path.write_text(text)
                os.utime(path, (later, later))
            store = MapStore(d)
            self.assertEqual(store.latest["run"], "abc-0")
            self.assertEqual(store.files["abc-0"], good)

    def test_what_is_not_a_map_is_refused(self):
        from marswalk.maps import MAX_TILE, MAX_TILES, check
        ok = check(self.payload())
        self.assertEqual(ok["tiles"], {"0,0": [1, 3, 0, 5, 255, 8]})
        for change in ({"run": "../etc"}, {"run": 7}, {"cellSizeM": 0}, {"cellSizeM": "0.1"}, {"cellSizeM": True},
                       {"tileCells": 0}, {"tileCells": 100000}, {"tileCells": 4.0}, {"tileCells": None},
                       {"tiles": "x"}, {"tiles": {"0,0": [0, 16]}}, {"tiles": [[0, 0, [0, 16]]]},
                       {"tiles": [{"x": 0, "z": 0}]},                         # no runs
                       {"tiles": [{"x": 0.5, "z": 0, "runs": [0, 16]}]},      # not a tile number
                       {"tiles": [{"x": "0", "z": 0, "runs": [0, 16]}]},
                       {"tiles": [{"x": True, "z": 0, "runs": [0, 16]}]},
                       {"tiles": [{"x": MAX_TILE + 1, "z": 0, "runs": [0, 16]}]},
                       {"tiles": [{"x": 0, "z": -MAX_TILE - 1, "runs": [0, 16]}]},
                       {"tiles": [{"x": 0, "z": 0, "runs": [1, 3, 0, 5]}]},   # too few cells
                       {"tiles": [{"x": 0, "z": 0, "runs": [0, 17]}]},        # too many
                       {"tiles": [{"x": 0, "z": 0, "runs": [2, 16]}]},        # not a cell value
                       {"tiles": [{"x": 0, "z": 0, "runs": [0, -1, 0, 17]}]},
                       {"tiles": [{"x": 0, "z": 0, "runs": [0, 16.0]}]},
                       {"tiles": [{"x": 0, "z": 0, "runs": [0, 16, 1]}]},
                       {"tiles": [{"x": 0, "z": 0, "runs": "x"}]},
                       {"tiles": [self.tile(), {"x": 1, "z": 0, "runs": [0, 15]}]},   # one bad tile spoils the update
                       {"tiles": [self.tile(i, 0) for i in range(MAX_TILES + 1)]}):
            with self.subTest(change=str(change)[:80]), self.assertRaises(ValueError):
                check({**self.payload(), **change})
        for not_an_object in (None, [], "map", 3):
            with self.subTest(payload=not_an_object), self.assertRaises(ValueError):
                check(not_an_object)

    def test_a_refused_update_leaves_the_run_as_it_was(self):
        import json
        import tempfile
        from marswalk.maps import MapStore
        with tempfile.TemporaryDirectory() as d:
            store = MapStore(d)
            path = store.save(self.payload(tiles=[self.tile(0, 0, 3)]))
            before = path.read_text()
            with self.assertRaises(ValueError):
                store.save(self.payload(tiles=[self.tile(0, 0, 4), {"x": 1, "z": 0, "runs": [0, 15]}]))
            with self.assertRaises(ValueError):   # another tile size in the same run
                store.save({**self.payload(tiles=[{"x": 1, "z": 0, "runs": [0, 4]}]), "tileCells": 2})
            self.assertEqual(path.read_text(), before)
            self.assertEqual(store.latest["updates"], 1)
            self.assertEqual(json.loads(before)["tiles"], {"0,0": [1, 3, 0, 5, 255, 8]})

    def test_a_run_holds_no_more_than_its_share_of_tiles(self):
        import tempfile
        from unittest import mock
        from marswalk import maps
        with tempfile.TemporaryDirectory() as d, mock.patch.object(maps, "MAX_TILES", 3):
            store = maps.MapStore(d)
            store.save(self.payload(tiles=[self.tile(i, 0) for i in range(3)]))
            # full: a new tile is dropped, a tile the run has is still updated
            with self.assertLogs("maps", level="WARNING"):
                store.save(self.payload(tiles=[self.tile(7, 7), self.tile(1, 0, 6)]))
            tiles = store.latest["tiles"]
            self.assertEqual(sorted(tiles), ["0,0", "1,0", "2,0"])
            self.assertEqual(tiles["1,0"][:2], [1, 6])


if __name__ == "__main__":
    unittest.main()
