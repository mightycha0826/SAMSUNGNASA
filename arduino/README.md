# arduino/ — suit temperature sensor (role E)

`suit_temp/suit_temp.ino` reads one temperature sensor and prints one JSON line per second at 115200 baud ([docs/INTERFACES.md](../docs/INTERFACES.md) section 5):

```
{"temp_c": 24.5}
{"temp_c": null, "error": "read_failed"}
```

## 1. Wire the sensor

The same wiring for every supported 3-pin sensor. The sketch works out which one it is, and keeps checking, so a sensor can be plugged in or swapped while the board runs.

| Sensor pin | Arduino |
|---|---|
| VCC (+) | 5V |
| GND (−) | GND |
| Signal (S / OUT / DATA) | **A0** |

Check the pin order on the part's datasheet or the module's silkscreen before powering it: an LM35 or TMP36 wired backwards gets hot within seconds.

| Detected as | Part | How it is recognized |
|---|---|---|
| `ds18b20` | DS18B20 (bare, or a KY-001 module) | Answers on 1-Wire. A bare part needs a 4.7 kΩ resistor from signal to 5 V |
| `dht11` / `dht22` | DHT module | Sends a valid DHT frame |
| `lm35` | LM35 | 0.10–0.50 V at room temperature |
| `tmp36` | TMP36 | 0.55–1.05 V at room temperature |
| `ntc` | 10 kΩ NTC thermistor module (KY-013) | 1.2–4.0 V. If the value falls when warmed, set `NTC_TO_GND` to 1 |

With nothing on A0 the board prints `{"temp_c": null, "error": "no_sensor"}` and the hub stays on mock values. To skip detection set `FORCE_SENSOR` in the sketch. On a 3.3 V or 12-bit board also change `VREF` and `ADC_MAX`.

### Demo dial (potentiometer)

A potentiometer can stand in for the sensor so the alerts can be shown on demand. Wire the **outer pins to 5V and GND** and the **middle pin to A0**, and flash with `SENSOR=pot tools/arduino.sh flash`: detection is skipped (a dial cannot be told apart from an analog sensor) and 0–5 V maps to 15–45 °C, so 30 °C is at half turn and 35 °C at two thirds. Say in the demo that the temperature comes from a dial.

Never wire the middle pin to 5V or GND: at the end of the knob's travel that shorts the supply, and the board drops off USB (the kernel log then shows `device not accepting address` / `unable to enumerate USB device`).

## 2. Build and flash from the Jetson

```bash
cd jetson
tools/arduino.sh setup     # once: arduino-cli, AVR core and the libraries into jetson/.tools/
tools/arduino.sh build     # compile for the team's Mega 2560 (other board: FQBN=arduino:avr:uno tools/arduino.sh build)
tools/arduino.sh flash     # compile and upload to the first /dev/ttyACM* or /dev/ttyUSB*
tools/arduino.sh watch     # print the serial lines
```

Stop the hub before flashing or watching: it holds the serial port. The Arduino IDE works too (115200 baud in the serial monitor).

## 3. Check with the hub

Start the hub (`jetson/README.md`). The log prints `arduino data, source=arduino`, and `telemetry` messages carry `"source": "arduino"`. Hold the sensor in your hand, note the temperature it reaches, and set `--warn-c` / `--critical-c` so the demo crosses them.

## Status

The firmware is flashed on the team's Mega 2560 and the hub reads it (`no_sensor` until a sensor is wired). Detection of each sensor type has not been tried with real parts yet.
