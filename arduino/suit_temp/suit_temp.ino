// Marswalk suit temperature sensor (role E).
//
// Output (docs/INTERFACES.md section 5): 115200 baud, one JSON line per second.
//   {"temp_c": 24.5}
//   {"temp_c": null, "error": "read_failed"}      (also "no_sensor" while nothing is wired)
// Lines starting with '#' are information for people; the hub ignores them.
//
// Wiring, the same for every supported 3-pin sensor:
//   sensor VCC -> 5V,  sensor GND -> GND,  sensor signal -> A0
// The sketch works out which sensor it is and keeps checking, so the sensor can be plugged
// in or swapped while the board is running:
//   DS18B20        1-Wire answer on A0. A bare DS18B20 needs a 4.7k resistor from signal to 5V
//                  (modules such as KY-001 already have it).
//   DHT11 / DHT22  valid DHT frame on A0 (3-pin modules).
//   LM35           analog, 10 mV per degC            (0.10 .. 0.50 V at 10 .. 50 degC)
//   TMP36          analog, 10 mV per degC + 500 mV   (0.55 .. 1.05 V at 5 .. 55 degC)
//   NTC module     10k thermistor divider, B = 3950  (1.2 .. 4.0 V). KY-013 style wiring;
//                  if the value falls when warmed, set NTC_TO_GND to 1.
// To skip detection, set FORCE_SENSOR to one of the S_* values.
//
// Demo dial (not a sensor): a potentiometer with its outer pins on 5V and GND and its middle
// pin on A0. It cannot be told apart from the analog sensors, so it must be forced:
//   SENSOR=pot jetson/tools/arduino.sh flash      (or #define FORCE_SENSOR S_POT)
// The dial maps 0..5 V to POT_MIN_C..POT_MAX_C, so the alerts can be shown on demand.
// WARNING: never wire the middle pin to 5V or GND. Turning the knob to the end would then short
// the supply and the board drops off USB.
//
// Libraries: OneWire, DallasTemperature, DHT sensor library (jetson/tools/arduino.sh setup).

#include <OneWire.h>
#include <DallasTemperature.h>
#include <DHT.h>

enum Sensor : uint8_t { S_NONE, S_DS18B20, S_DHT11, S_DHT22, S_LM35, S_TMP36, S_NTC, S_POT };
const char *const NAMES[] = {"none", "ds18b20", "dht11", "dht22", "lm35", "tmp36", "ntc", "pot (dial)"};

#ifndef FORCE_SENSOR
#define FORCE_SENSOR S_NONE         // S_NONE = detect automatically
#endif
#define NTC_TO_GND   0

const uint8_t  PIN        = A0;
const float    VREF       = 5.0;    // 3.3 on 3.3 V boards
const float    ADC_MAX    = 1023.0; // 4095 on 12-bit boards
const uint32_t PERIOD_MS  = 1000;
const float    NTC_R0 = 10000.0, NTC_B = 3950.0, NTC_SERIES = 10000.0;
const float    POT_MIN_C = 15.0, POT_MAX_C = 45.0;   // dial range; 30 and 35 degC sit at 1/2 and 2/3 turn

OneWire oneWire(PIN);
DallasTemperature probe(&oneWire);
DHT dht11(PIN, DHT11);
DHT dht22(PIN, DHT22);

Sensor  sensor = S_NONE;
uint8_t failures = 0;

// Mean of several ADC samples, in volts. Smooths the jitter of the analog sensors.
float readVolts() {
  pinMode(PIN, INPUT);
  uint32_t sum = 0;
  for (uint8_t i = 0; i < 16; i++) { sum += analogRead(PIN); delay(2); }
  return (sum / 16.0) * VREF / ADC_MAX;
}

// True when nothing drives the pin: the weak internal pull-up then lifts it to the rail.
bool pinFloating() {
  pinMode(PIN, INPUT_PULLUP);
  delay(5);
  int up = analogRead(PIN);
  pinMode(PIN, INPUT);
  delay(5);
  return up > 0.965 * ADC_MAX;
}

Sensor detect() {
  uint8_t addr[8];
  oneWire.reset_search();
  if (oneWire.search(addr) && OneWire::crc8(addr, 7) == addr[7]) { probe.begin(); return S_DS18B20; }

  dht11.begin();
  delay(1100);                                  // a DHT needs a second after power-up
  float t = dht11.readTemperature(), h = dht11.readHumidity();
  if (!isnan(t)) {
    // The frame is the same; a DHT22 decoded as a DHT11 gives impossible values.
    if (t >= 0 && t <= 50 && h >= 15 && h <= 95) return S_DHT11;
    dht22.begin();
    return S_DHT22;
  }

  if (pinFloating()) return S_NONE;
  float v = readVolts();
  if (v >= 0.10 && v < 0.50) return S_LM35;
  if (v >= 0.55 && v < 1.05) return S_TMP36;
  if (v >= 1.20 && v < 4.00) return S_NTC;
  return S_NONE;
}

// Returns false when the sensor gives no usable value.
bool readTempC(float &t) {
  switch (sensor) {
    case S_DS18B20:
      probe.requestTemperatures();
      t = probe.getTempCByIndex(0);
      return t != DEVICE_DISCONNECTED_C && t != 85.0;   // 85.0 = power-on value, not a reading
    case S_DHT11: t = dht11.readTemperature(); return !isnan(t);
    case S_DHT22: t = dht22.readTemperature(); return !isnan(t);
    case S_LM35:
      if (pinFloating()) return false;
      t = readVolts() * 100.0;
      return true;
    case S_TMP36:
      if (pinFloating()) return false;
      t = (readVolts() - 0.5) * 100.0;
      return true;
    case S_NTC: {
      if (pinFloating()) return false;
      float v = readVolts();
      if (v <= 0.01 || v >= VREF - 0.01) return false;  // open or shorted
      float r = NTC_TO_GND ? NTC_SERIES * v / (VREF - v) : NTC_SERIES * (VREF - v) / v;
      t = 1.0 / (log(r / NTC_R0) / NTC_B + 1.0 / 298.15) - 273.15;
      return true;
    }
    case S_POT: {
      // The wiper always drives the pin, so there is no "floating" check here.
      static float smooth = -1000.0;
      float v = POT_MIN_C + (POT_MAX_C - POT_MIN_C) * readVolts() / VREF;
      smooth = (smooth < -999.0) ? v : smooth + 0.5 * (v - smooth);   // steady the last digit
      t = smooth;
      return true;
    }
    default: return false;
  }
}

void announce() {
  Serial.print(F("# sensor: "));
  Serial.println(NAMES[sensor]);
}

void setup() {
  Serial.begin(115200);
  sensor = (FORCE_SENSOR != S_NONE) ? (Sensor)FORCE_SENSOR : detect();
  if (sensor == S_DS18B20) probe.begin();
  if (sensor == S_DHT11) dht11.begin();
  if (sensor == S_DHT22) dht22.begin();
  announce();
}

void loop() {
  static uint32_t next = 0;
  uint32_t now = millis();
  if ((int32_t)(now - next) < 0) return;
  next = now + PERIOD_MS;

  if (sensor == S_NONE && FORCE_SENSOR == S_NONE) {
    sensor = detect();
    if (sensor != S_NONE) announce();
  }

  float t;
  if (sensor != S_NONE && readTempC(t) && t > -40.0 && t < 125.0) {
    failures = 0;
    Serial.print(F("{\"temp_c\": "));
    Serial.print(t, 1);
    Serial.println(F("}"));
    return;
  }
  if (sensor == S_NONE) {
    Serial.println(F("{\"temp_c\": null, \"error\": \"no_sensor\"}"));
    return;
  }
  Serial.println(F("{\"temp_c\": null, \"error\": \"read_failed\"}"));
  if (++failures >= 3 && FORCE_SENSOR == S_NONE) {   // unplugged or swapped: detect again
    failures = 0;
    sensor = S_NONE;
    announce();
  }
}
