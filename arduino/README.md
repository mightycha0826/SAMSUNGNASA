# arduino/ — suit temperature sensor (role E)

`suit_temp/suit_temp.ino` reads one temperature sensor and prints one JSON line per second at 115200 baud ([docs/INTERFACES.md](../docs/INTERFACES.md) section 5):

```
{"temp_c": 24.5}
{"temp_c": null, "error": "read_failed"}
```

## 1. Pick the sensor

Set `#define SENSOR` near the top of the sketch to the sensor you have. The default is `SENSOR_DS18B20`.

| `SENSOR` | Part | Wiring | Library |
|---|---|---|---|
| `SENSOR_DS18B20` | DS18B20 1-Wire probe | data → D2, 4.7 kΩ pull-up from data to 5 V | OneWire, DallasTemperature |
| `SENSOR_DHT` | DHT11 / DHT22 module | data → D2 | DHT sensor library (Adafruit) |
| `SENSOR_LM35` | LM35 | out → A0 | none |
| `SENSOR_TMP36` | TMP36 | out → A0 | none |
| `SENSOR_NTC` | 10 kΩ NTC thermistor (B = 3950) | 5 V – 10 kΩ – A0 – thermistor – GND | none |

On a 3.3 V or 12-bit board also change `VREF` and `ADC_MAX`.

## 2. Build and flash from the Jetson

```bash
cd jetson
tools/arduino.sh setup     # once: arduino-cli, AVR core and the libraries into jetson/.tools/
tools/arduino.sh build     # compile for an Uno (other board: FQBN=arduino:avr:nano tools/arduino.sh build)
tools/arduino.sh flash     # compile and upload to the first /dev/ttyACM* or /dev/ttyUSB*
tools/arduino.sh watch     # print the serial lines
```

Stop the hub before flashing or watching: it holds the serial port. The Arduino IDE works too (board: Uno, 115200 baud in the serial monitor).

## 3. Check with the hub

Start the hub (`jetson/README.md`). The log prints `arduino data, source=arduino`, and `telemetry` messages carry `"source": "arduino"`. Hold the sensor in your hand, note the temperature it reaches, and set `--warn-c` / `--critical-c` / `--clear-c` so the demo crosses them.

## Status

All five sensor variants compile for `arduino:avr:uno`. None has run on a real board yet.
