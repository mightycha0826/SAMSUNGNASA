// Marswalk suit temperature sensor (role E).
//
// Output (docs/INTERFACES.md section 5): 115200 baud, one JSON line per second.
//   {"temp_c": 24.5}
//   {"temp_c": null, "error": "read_failed"}
//
// Pick the sensor you actually have by setting SENSOR below, then check the pin.
//   SENSOR_DS18B20     digital 1-Wire probe. Data -> D2, 4.7k pull-up from data to 5V.
//                      Libraries: OneWire, DallasTemperature.
//   SENSOR_DHT         DHT11 / DHT22 module. Data -> D2. Library: "DHT sensor library" (Adafruit).
//   SENSOR_LM35        analog, 10 mV per degC. Out -> A0.
//   SENSOR_TMP36       analog, 10 mV per degC with a 500 mV offset. Out -> A0.
//   SENSOR_NTC         10k NTC thermistor (B = 3950) with a 10k series resistor. Midpoint -> A0.
//                      Wiring: 5V - 10k resistor - A0 - thermistor - GND.
//                      (KY-013 modules are wired the other way round: set NTC_TO_GND to 0.)

#define SENSOR_DS18B20 1
#define SENSOR_DHT     2
#define SENSOR_LM35    3
#define SENSOR_TMP36   4
#define SENSOR_NTC     5

#define SENSOR SENSOR_DS18B20   // <-- change this

const uint8_t  DATA_PIN   = 2;      // DS18B20, DHT
const uint8_t  ANALOG_PIN = A0;     // LM35, TMP36, NTC
const float    VREF       = 5.0;    // 3.3 on 3.3 V boards
const float    ADC_MAX    = 1023.0; // 4095 on 12-bit boards
const uint32_t PERIOD_MS  = 1000;

#if SENSOR == SENSOR_DS18B20
  #include <OneWire.h>
  #include <DallasTemperature.h>
  OneWire oneWire(DATA_PIN);
  DallasTemperature probe(&oneWire);
#elif SENSOR == SENSOR_DHT
  #include <DHT.h>
  #define DHT_TYPE DHT11            // or DHT22
  DHT dht(DATA_PIN, DHT_TYPE);
#elif SENSOR == SENSOR_NTC
  #define NTC_TO_GND 1
  const float NTC_R0 = 10000.0, NTC_B = 3950.0, NTC_SERIES = 10000.0;
#endif

// Mean of several ADC samples, in volts. Smooths the jitter of the analog sensors.
float readVolts() {
  uint32_t sum = 0;
  for (uint8_t i = 0; i < 16; i++) { sum += analogRead(ANALOG_PIN); delay(2); }
  return (sum / 16.0) * VREF / ADC_MAX;
}

// Returns false when the sensor gives no usable value.
bool readTempC(float &t) {
#if SENSOR == SENSOR_DS18B20
  probe.requestTemperatures();
  t = probe.getTempCByIndex(0);
  return t != DEVICE_DISCONNECTED_C && t != 85.0;   // 85.0 = power-on value, not a reading
#elif SENSOR == SENSOR_DHT
  t = dht.readTemperature();
  return !isnan(t);
#elif SENSOR == SENSOR_LM35
  t = readVolts() * 100.0;
  return true;
#elif SENSOR == SENSOR_TMP36
  t = (readVolts() - 0.5) * 100.0;
  return true;
#elif SENSOR == SENSOR_NTC
  float v = readVolts();
  if (v <= 0.01 || v >= VREF - 0.01) return false;   // open or shorted
  float r = NTC_TO_GND ? NTC_SERIES * v / (VREF - v) : NTC_SERIES * (VREF - v) / v;
  t = 1.0 / (log(r / NTC_R0) / NTC_B + 1.0 / 298.15) - 273.15;
  return true;
#else
  #error "Set SENSOR to one of the SENSOR_* values"
#endif
}

void setup() {
  Serial.begin(115200);
#if SENSOR == SENSOR_DS18B20
  probe.begin();
#elif SENSOR == SENSOR_DHT
  dht.begin();
#endif
}

void loop() {
  static uint32_t next = 0;
  uint32_t now = millis();
  if ((int32_t)(now - next) < 0) return;
  next = now + PERIOD_MS;

  float t;
  if (readTempC(t) && t > -60.0 && t < 130.0) {
    Serial.print(F("{\"temp_c\": "));
    Serial.print(t, 1);
    Serial.println(F("}"));
  } else {
    Serial.println(F("{\"temp_c\": null, \"error\": \"read_failed\"}"));
  }
}
