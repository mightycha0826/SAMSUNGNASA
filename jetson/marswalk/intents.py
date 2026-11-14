"""Voice command matcher (docs/INTERFACES.md section 6).

The commands live in jetson/commands.json so they can be added or changed without touching
code; the file is reloaded whenever it changes. See the "_help" lines in that file.

Matching is built for a speech recognizer that makes small mistakes:
  1. a phrase whose words appear in the transcript scores 1.0;
  2. the same with the spaces removed ("takeme to the site") scores 0.97;
  3. otherwise the phrase is compared with every stretch of the transcript of about the same
     length; a similarity of at least min_score counts ("thermo mat" for "thermal map").
Very short phrases (under 5 letters) must match exactly: "stop" must not match "shop".
The best score wins; on a tie the longest phrase wins, so specific commands beat general ones.

The command list is kept to what the demo needs (status, navigate, base, mark target, stop,
confirm, and the four layer names). More phrases mean more false triggers from ordinary talk.
"""
import json
import logging
import re
from difflib import SequenceMatcher
from itertools import product
from pathlib import Path

log = logging.getLogger("intents")

DEFAULT_FILE = Path(__file__).resolve().parent.parent / "commands.json"
FUZZY_MIN_LETTERS = 5
_VAR = re.compile(r"\{(\w+)\}")


# Filler words are dropped from both the phrases and the transcript, so "hide the thermal map"
# still contains the phrase "hide thermal".
FILLER = {"the", "a", "an", "please", "uh", "um", "now"}


def _words(text: str) -> list[str]:
    words = re.sub(r"[^\w\s']+", " ", text.lower()).replace("_", " ").split()
    return [w for w in words if w not in FILLER]


class CommandSet:
    def __init__(self, path: Path | str = DEFAULT_FILE):
        self.path = Path(path)
        self._mtime = None
        self.wake_word: str | None = None
        self.min_score = 0.8
        self.entries: list[tuple[list[str], dict]] = []  # (phrase words, command)
        self.menu: list[dict] = []   # for the headset's command menu
        self.version = 0             # bumped on every successful (re)load
        self.reload_if_changed()

    def reload_if_changed(self):
        try:
            mtime = self.path.stat().st_mtime
        except OSError:
            if self._mtime is None:
                log.error("command file missing: %s", self.path)
                self._mtime = -1
            return
        if mtime == self._mtime:
            return
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            entries = self._expand(data)
            menu = self._menu(data)
        except (ValueError, KeyError, TypeError) as e:
            # Keep the commands that were working; a typo must not silence the assistant.
            log.error("could not load %s (%s); keeping the previous commands", self.path, e)
            self._mtime = mtime
            return
        self._mtime = mtime
        self.entries = entries
        self.menu = menu
        self.version += 1
        self.wake_word = data.get("wake_word") or None
        self.min_score = float(data.get("min_score", 0.8))
        log.info("loaded %d phrases for %d commands from %s",
                 len(entries), len(data["commands"]), self.path.name)

    @staticmethod
    def _expand(data: dict) -> list[tuple[list[str], dict]]:
        vars_ = data.get("vars", {})
        out = []
        for cmd in data["commands"]:
            slots = cmd.get("slots", {})
            for phrase in cmd["phrases"]:
                names = list(dict.fromkeys(_VAR.findall(phrase)))
                # every combination of (slot value, spoken form) for the variables used
                choices = [[(n, value, said) for value, forms in vars_[n].items() for said in forms]
                           for n in names]
                for combo in product(*choices):
                    said = {n: s for n, _, s in combo}
                    value = {n: v for n, v, _ in combo}
                    words = _words(_VAR.sub(lambda m: said[m.group(1)], phrase))
                    if not words:
                        continue
                    filled = {k: (_VAR.sub(lambda m: value.get(m.group(1), m.group(0)), v)
                                  if isinstance(v, str) else v) for k, v in slots.items()}
                    out.append((words, {"intent": cmd["intent"], "slots": filled,
                                        "reply": cmd.get("reply")}))
        return out

    @staticmethod
    def _menu(data: dict) -> list[dict]:
        """What the headset lists in its command menu: one entry per command and variable value,
        labelled with "say" or the first phrase."""
        vars_ = data.get("vars", {})
        out = []
        for cmd in data["commands"]:
            if cmd.get("menu") is False:
                continue
            label = cmd.get("say") or cmd["phrases"][0]
            names = list(dict.fromkeys(_VAR.findall(label) + [n for v in cmd.get("slots", {}).values()
                                                              if isinstance(v, str) for n in _VAR.findall(v)]))
            combos = product(*[[(n, value, forms[0]) for value, forms in vars_[n].items()] for n in names])
            for combo in combos:
                said = {n: s for n, _, s in combo}
                value = {n: v for n, v, _ in combo}
                say = _VAR.sub(lambda m: said[m.group(1)], label)
                slots = {k: (_VAR.sub(lambda m: value.get(m.group(1), m.group(0)), v)
                             if isinstance(v, str) else v) for k, v in cmd.get("slots", {}).items()}
                entry = {"say": say[:1].upper() + say[1:], "intent": cmd["intent"], "slots": slots}
                if cmd.get("mode"):
                    entry["mode"] = cmd["mode"]   # shown only in this mode of the app
                out.append(entry)
        return out

    def _score(self, phrase: list[str], heard: list[str], heard_joined: str) -> float:
        n = len(phrase)
        for i in range(len(heard) - n + 1):
            if heard[i:i + n] == phrase:
                return 1.0
        target = " ".join(phrase)
        letters = len(target.replace(" ", ""))
        if letters < FUZZY_MIN_LETTERS:
            return 0.0
        if target.replace(" ", "") in heard_joined:
            return 0.97
        best = 0.0
        for size in {max(1, n - 1), n, n + 1}:
            for i in range(max(1, len(heard) - size + 1)):
                r = SequenceMatcher(None, target, " ".join(heard[i:i + size])).ratio()
                best = max(best, r)
        return best * 0.95 if best >= self.min_score else 0.0

    def parse(self, text: str, wake: str | None = None) -> dict | None:
        self.reload_if_changed()
        heard = _words(text)
        if not heard:
            return None
        joined = "".join(heard)
        wake = wake or self.wake_word
        if wake:
            w = _words(wake)
            if self._score(w, heard, joined) == 0.0:
                return None
        best, best_key = None, (0.0, 0)
        for phrase, cmd in self.entries:
            s = self._score(phrase, heard, joined)
            key = (s, sum(map(len, phrase)))
            if s > 0 and key > best_key:
                best, best_key = cmd, key
        if best is None:
            return None
        out = {"intent": best["intent"], "slots": dict(best["slots"]), "text": text}
        if best.get("reply"):
            out["reply"] = best["reply"]
        return out


_default: CommandSet | None = None


def parse(text: str, wake: str | None = None) -> dict | None:
    """Match `text` against jetson/commands.json. Returns
    {"intent", "slots", "text"[, "reply"]} or None when nothing matches."""
    global _default
    if _default is None:
        _default = CommandSet()
    return _default.parse(text, wake)


def menu() -> tuple[int, list[dict]]:
    """(version, entries) of the command menu; the version changes when the file is reloaded."""
    global _default
    if _default is None:
        _default = CommandSet()
    _default.reload_if_changed()
    return _default.version, _default.menu
