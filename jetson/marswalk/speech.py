"""Sentences the hub speaks. Numbers are spelled out so the TTS reads them the same way
every time ("24.5" -> "twenty-four point five")."""

_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
         "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
         "eighteen", "nineteen"]
_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
ALERT_WORD = {"warn": "caution", "critical": "critical"}


def int_words(n: int) -> str:
    """0..999 -> English words."""
    if n < 20:
        return _ONES[n]
    if n < 100:
        tens, ones = divmod(n, 10)
        return _TENS[tens] + (f"-{_ONES[ones]}" if ones else "")
    hundreds, rest = divmod(n, 100)
    return f"{_ONES[hundreds]} hundred" + (f" {int_words(rest)}" if rest else "")


def temp_words(temp_c: float) -> str:
    """24.5 -> 'twenty-four point five degrees', -3.0 -> 'minus three degrees'."""
    tenths = round(abs(temp_c) * 10)
    whole, frac = divmod(tenths, 10)
    s = int_words(whole) + (f" point {_ONES[frac]}" if frac else "")
    unit = "degree" if tenths == 10 else "degrees"
    return ("minus " if temp_c < 0 and tenths else "") + f"{s} {unit}"


def status_sentence(temp_c, source, alerts: dict, state: dict) -> str:
    """Answer to "status report": suit temperature, active alerts, route state."""
    parts = []
    if temp_c is not None:
        parts.append(f"Suit temperature {temp_words(temp_c)}"
                     + (", simulated" if source == "mock" else ""))
    else:
        parts.append("Suit temperature sensor is not responding")
    if alerts:
        worst = "critical" if any(a.get("level") == "critical" for a in alerts.values()) else "warn"
        n = len(alerts)
        parts.append(f"{int_words(n).capitalize()} {ALERT_WORD[worst]} alert{'s' if n > 1 else ''}")
    else:
        parts.append("No alerts")
    nav = {"ok": "Route guidance active", "blocked": "Route is blocked",
           "arrived": "You have arrived"}.get(state.get("navStatus"))
    if nav:
        parts.append(nav)
    if state.get("mode") == "emergency":
        parts.append("Emergency mode")
    return ". ".join(parts) + "."
