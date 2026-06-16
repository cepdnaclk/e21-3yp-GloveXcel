#include "PotentiometerReader.h"

#include "BLEManager.h"
#include "Config.h"
#include "PinConfig.h"

PotentiometerReader::PotentiometerReader(BLEManager &bleManager)
    : bleManager(bleManager) {}

void PotentiometerReader::begin() {
  // 12-bit ADC gives values from 0 to 4095.
  analogReadResolution(12);

  // 11 dB attenuation supports the wider ESP32 ADC input range.
  for (int i = 0; i < PinConfig::POT_COUNT; i++) {
    analogSetPinAttenuation(PinConfig::POT_PINS[i], ADC_11db);
  }
}

int PotentiometerReader::readPotValue(int pin) {
  // Average three quick samples for a slightly smoother reading.
  int value1 = analogRead(pin);
  int value2 = analogRead(pin);
  int value3 = analogRead(pin);

  return (value1 + value2 + value3) / 3;
}

void PotentiometerReader::printPotValuesIfNeeded() {
  unsigned long currentTime = millis();

  // Non-blocking timer: print/send only when the interval has elapsed.
  if (currentTime - previousPrintTime >= Config::POT_PRINT_INTERVAL_MS) {
    previousPrintTime = currentTime;

    for (int i = 0; i < PinConfig::POT_COUNT; i++) {
      int rawValue = readPotValue(PinConfig::POT_PINS[i]);

      // Preserve the original Serial format used by the single-file sketch.
      Serial.print("GPIO");
      Serial.print(PinConfig::POT_PINS[i]);
      Serial.print(" = ");
      Serial.print(rawValue);

      if (i < PinConfig::POT_COUNT - 1) {
        Serial.print(" | ");
      }
    }

    Serial.println();
    // Send the BLE packet after printing, keeping the same 20 ms update interval.
    sendPotValuesToBLE();
  }
}

void PotentiometerReader::sendPotValuesToBLE() {
  uint8_t potPacket[PinConfig::POT_COUNT];

  for (int i = 0; i < PinConfig::POT_COUNT; i++) {
    int rawValue = readPotValue(PinConfig::POT_PINS[i]);
    // Frontend expects 8-bit values, so scale 0-4095 ADC to 0-255.
    int scaledValue = map(rawValue, 0, 4095, 0, 255);
    scaledValue = constrain(scaledValue, 0, 255);

    potPacket[i] = (uint8_t)scaledValue;
  }

  bleManager.sendPotentiometerPacket(potPacket, PinConfig::POT_COUNT);
}
