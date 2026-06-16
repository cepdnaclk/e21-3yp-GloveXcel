#ifndef POTENTIOMETER_READER_H
#define POTENTIOMETER_READER_H

#include <Arduino.h>

class BLEManager;

/*
  PotentiometerReader owns ADC reads and periodic pot reporting.

  It prints the original raw ADC values to Serial and also sends a scaled
  5-byte packet to BLE for the frontend.
*/
class PotentiometerReader {
 public:
  explicit PotentiometerReader(BLEManager &bleManager);

  // Configure ESP32 ADC resolution and attenuation for all pot pins.
  void begin();

  // Average three ADC samples to reduce small reading noise.
  int readPotValue(int pin);

  // Non-blocking periodic Serial print and BLE notify.
  void printPotValuesIfNeeded();

 private:
  // Build the 0-255 BLE packet from 0-4095 ADC values.
  void sendPotValuesToBLE();

  BLEManager &bleManager;
  unsigned long previousPrintTime = 0;
};

#endif
