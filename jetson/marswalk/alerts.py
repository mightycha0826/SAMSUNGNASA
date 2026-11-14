"""Suit temperature alert state machine (docs/INTERFACES.md section 4).

< warn_c      : normal
>= warn_c     : raise warn
>= critical_c : raise critical (escalates from warn; never downgrades)
< clear_c     : clear (hysteresis: only after dropping below clear_c)
"""
from dataclasses import dataclass

ALERT_ID = "suit-temp"
SUIT_TEMP_MESSAGES = {"warn": "Suit temperature is rising",
                      "critical": "Suit temperature is critical"}


@dataclass
class Thresholds:
    warn_c: float = 30.0
    critical_c: float = 35.0
    clear_c: float = 28.0


class SuitTempAlert:
    def __init__(self, th: Thresholds | None = None):
        self.th = th or Thresholds()
        self.level: str | None = None  # None, "warn", "critical"

    def update(self, temp_c: float | None) -> list[tuple[str, dict]]:
        """Feed one reading; return WebSocket messages [(type, payload)] to send."""
        if temp_c is None:
            return []
        th = self.th
        if temp_c >= th.critical_c:
            target = "critical"
        elif temp_c >= th.warn_c:
            target = "warn"
        else:
            target = None

        if self.level is not None and temp_c < th.clear_c:
            self.level = None
            return [("alert.clear", {"id": ALERT_ID})]

        if target is not None and _rank(target) > _rank(self.level):
            self.level = target
            return [("alert.raise", {"id": ALERT_ID, "level": target,
                                     "message": SUIT_TEMP_MESSAGES[target]})]
        return []


def _rank(level: str | None) -> int:
    return {None: 0, "warn": 1, "critical": 2}[level]
