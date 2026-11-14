"""Run from jetson/:  .venv/bin/python -m unittest discover tests"""
import unittest

from marswalk.alerts import SuitTempAlert
from marswalk.intents import parse
from marswalk.speech import status_sentence, temp_words


class AlertTest(unittest.TestCase):
    def run_seq(self, temps):
        a = SuitTempAlert()
        return [m for t in temps for m in a.update(t)]

    def test_warn_then_critical_then_clear(self):
        msgs = self.run_seq([25, 30, 31, 35, 33, 29, 27.9, 26])
        kinds = [(t, p.get("level")) for t, p in msgs]
        self.assertEqual(kinds, [("alert.raise", "warn"), ("alert.raise", "critical"),
                                 ("alert.clear", None)])

    def test_straight_to_critical(self):
        msgs = self.run_seq([24, 36])
        self.assertEqual([(t, p.get("level")) for t, p in msgs], [("alert.raise", "critical")])

    def test_hysteresis_no_flapping(self):
        # hovering around 30 must raise once and not clear until < 28
        self.assertEqual(len(self.run_seq([30, 29.5, 30.2, 29, 30])), 1)

    def test_none_ignored(self):
        self.assertEqual(self.run_seq([None, None]), [])


class IntentTest(unittest.TestCase):
    CASES = {
        "Take me to the survey site": ("nav.start", {"targetId": "site1"}),
        "Guide me to the sulfur rocks.": ("nav.start", {"targetId": "site1"}),
        "Go back to base": ("nav.home", {}),
        "Return to base.": ("nav.home", {}),
        "Stop navigation": ("nav.stop", {}),
        "Show the thermal map": ("layer.show", {"id": "thermal"}),
        "Hide the thermal map": ("layer.hide", {"id": "thermal"}),
        "Turn off the thermal layer.": ("layer.hide", {"id": "thermal"}),
        "show the slope layer": ("layer.show", {"id": "slope"}),
        "Status report": ("status.report", {}),
        "Acknowledge alert": ("alert.ack", {}),
        "Night mode": ("mode.set", {"mode": "night"}),
        # as the STT sometimes writes them
        "Show the thermo mat.": ("layer.show", {"id": "thermal"}),
        "takeme to the survey site": ("nav.start", {"targetId": "site1"}),
    }

    def test_examples(self):
        for text, (intent, slots) in self.CASES.items():
            with self.subTest(text=text):
                r = parse(text)
                self.assertIsNotNone(r)
                self.assertEqual((r["intent"], r["slots"]), (intent, slots))

    def test_unknown_dropped(self):
        self.assertIsNone(parse("what is for lunch today"))
        self.assertIsNone(parse(""))


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
