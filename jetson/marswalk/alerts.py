"""Suit temperature alert state machine (docs/INTERFACES.md section 4).

The alert level follows the temperature in both directions:

>= warn_c                : raise warn
>= critical_c            : raise critical
<  critical_c - margin_c : critical goes back down to warn
<  warn_c - margin_c     : clear

The margin keeps a reading that hovers on a threshold from raising and clearing over and
over. It is small on purpose: the alarm must not keep ringing while the display shows a
temperature well under the threshold that started it.
"""
from dataclasses import dataclass

ALERT_ID = "suit-temp"
SUIT_TEMP_MESSAGES = {"warn": "Suit temperature is rising",
                      "critical": "Suit temperature is critical"}
# What the alert says after it has come down from critical.
EASING_MESSAGE = "Suit temperature is high"


@dataclass
class Thresholds:
    warn_c: float = 30.0
    critical_c: float = 35.0
    margin_c: float = 1.0


class SuitTempAlert:
    def __init__(self, th: Thresholds | None = None):
        self.th = th or Thresholds()
        self.level: str | None = None  # None, "warn", "critical"

    def update(self, temp_c: float | None) -> list[tuple[str, dict]]:
        """Feed one reading; return WebSocket messages [(type, payload)] to send."""
        if temp_c is None:
            return []
        th = self.th
        before = self.level
        if temp_c >= th.critical_c:
            level = "critical"
        elif temp_c >= th.warn_c:
            # Between the thresholds: a critical alert holds until the margin is crossed.
            level = "critical" if before == "critical" and temp_c >= th.critical_c - th.margin_c else "warn"
        elif temp_c >= th.warn_c - th.margin_c:
            # Just under the warn threshold: whatever is raised eases to warn, nothing new starts.
            level = "warn" if before else None
        else:
            level = None

        if level == before:
            return []
        self.level = level
        if level is None:
            return [("alert.clear", {"id": ALERT_ID})]
        easing = before == "critical"
        return [("alert.raise", {"id": ALERT_ID, "level": level,
                                 "message": EASING_MESSAGE if easing else SUIT_TEMP_MESSAGES[level]})]
