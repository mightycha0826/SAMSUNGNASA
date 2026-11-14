"""Keyword rule intent parser (docs/INTERFACES.md section 6). English commands.

Text that matches nothing returns None and is dropped.
Matching ignores case, spaces and punctuation, and the keyword lists include the
misspellings the STT actually produces ("thermo mat" for "thermal map").
"""
import re

LAYERS = {
    "thermal": ["thermal", "thermo", "heat", "infrared"],
    "optical": ["optical", "optic", "satellite", "photo", "visible"],
    "slope": ["slope", "steep"],
    "topo": ["topo", "terrain", "train map", "elevation", "height", "contour"],
}

_HIDE = ["hide", "turn off", "switch off", "remove", "close", "disable"]


def _norm(text: str) -> str:
    return re.sub(r"[\W_]+", "", text.lower())


def _has(t: str, words) -> bool:
    return any(_norm(w) in t for w in words)


# How the STT spells each wake word. "helmet" was recognized 6 of 6 times in the self-test;
# "visor" was not (it came out as "Psor", "Pfsor", "Psizer").
WAKE_VARIANTS = {"helmet": ["helmet", "hell met", "helmut", "helmit"]}


def parse(text: str, wake: str | None = None) -> dict | None:
    """With `wake`, only speech that contains the wake word is a command
    ("Helmet, take me to the survey site"). Use it where other people are talking."""
    t = _norm(text)
    if not t:
        return None
    if wake and not _has(t, WAKE_VARIANTS.get(wake, [wake])):
        return None

    def out(intent, slots=None):
        return {"intent": intent, "slots": slots or {}, "text": text}

    # Order matters: more specific commands first.
    if _has(t, ["acknowledge", "alert ok", "alert confirmed", "confirm alert", "copy that", "roger"]):
        return out("alert.ack")
    if _has(t, ["stop navigation", "stop guiding", "stop guidance", "stop the route",
                "cancel", "end navigation", "stop"]):
        return out("nav.stop")
    if _has(t, ["base", "home", "go back", "return", "habitat"]):
        return out("nav.home")
    if _has(t, ["survey", "site", "destination", "take me", "guide me", "navigate", "sulfur"]):
        return out("nav.start", {"targetId": "site1"})
    if _has(t, ["status", "report", "how am i", "situation"]):
        return out("status.report")
    if _has(t, ["night"]):
        return out("mode.set", {"mode": "night"})

    for layer_id, words in LAYERS.items():
        if _has(t, words):   # naming a layer without a "hide" word means "show it"
            return out("layer.hide" if _has(t, _HIDE) else "layer.show", {"id": layer_id})
    return None
