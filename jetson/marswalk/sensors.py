"""Suit temperature source: Arduino over serial, falling back to mock.

Serial format (docs/INTERFACES.md section 5): 115200 baud, one JSON line per second,
{"temp_c": 24.5} or {"temp_c": null, "error": "read_failed"}.
If no reading arrives for 5 s, source becomes "mock" and a log line is written.
"""
import asyncio
import glob
import statistics
from collections import deque
import json
import logging
import time

log = logging.getLogger("sensors")

STALE_S = 5.0
MEDIAN_N = 5   # readings; an analog sensor jumps around, and one stray reading must not alarm


class SuitTemp:
    def __init__(self, port: str | None, mock_base_c: float = 24.0):
        self.port = port
        self.temp_c: float | None = mock_base_c
        self.source = "mock"
        self.mock_c = mock_base_c        # dev.temp can change this
        self._last_line = 0.0
        self._recent: deque[float] = deque(maxlen=MEDIAN_N)
        self._last_error = None

    def reading(self) -> dict:
        if self.source == "arduino" and time.monotonic() - self._last_line > STALE_S:
            log.warning("no serial line for %.0fs, switching to mock", STALE_S)
            self.source = "mock"
            self._recent.clear()
        if self.source == "mock":
            self.temp_c = self.mock_c
        return {"suitTempC": self.temp_c, "source": self.source}

    async def run(self):
        """Read the serial port forever, reopening it if it disappears."""
        if self.port == "none":
            log.info("serial disabled, mock only")
            return
        import serial  # pyserial

        while True:
            port = self.port or _guess_port()
            if not port:
                await asyncio.sleep(2)
                continue
            try:
                ser = serial.Serial(port, 115200, timeout=0.2)
                log.info("serial open %s", port)
            except (serial.SerialException, OSError) as e:
                log.debug("serial open failed %s: %s", port, e)
                await asyncio.sleep(2)
                continue
            buf = b""
            try:
                while True:
                    chunk = await asyncio.to_thread(ser.read, 256)
                    buf += chunk
                    while b"\n" in buf:
                        line, buf = buf.split(b"\n", 1)
                        self._handle(line)
            except (serial.SerialException, OSError) as e:
                log.warning("serial lost %s: %s", port, e)
                ser.close()
                await asyncio.sleep(1)

    def _handle(self, line: bytes):
        try:
            data = json.loads(line.decode("utf-8", "replace").strip())
        except json.JSONDecodeError:
            return  # boot noise
        t = data.get("temp_c")
        if t is None:
            # Keep the last good value. Only readings count as "alive", so a board with
            # no sensor wired ("no_sensor") falls back to mock after STALE_S like a silent one.
            err = data.get("error")
            if err != self._last_error:
                log.warning("arduino: %s", err)
                self._last_error = err
            return
        self._last_error = None
        self._last_line = time.monotonic()
        if self.source != "arduino":
            log.info("arduino data, source=arduino")
        self.source = "arduino"
        # The median of the last few readings: steady enough for the display, and a single
        # spike cannot cross an alert threshold. Costs about two seconds of lag.
        self._recent.append(float(t))
        self.temp_c = round(statistics.median(self._recent), 1)


def _guess_port() -> str | None:
    ports = sorted(glob.glob("/dev/ttyACM*") + glob.glob("/dev/ttyUSB*"))
    return ports[0] if ports else None
