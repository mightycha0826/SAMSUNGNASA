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


if __name__ == "__main__":
    unittest.main()
