#include "EncoderManager.h"

#include "PinConfig.h"

// Static storage for the ISR-owned encoder state.
volatile long EncoderManager::rawEncoderTicks = 0;
volatile int EncoderManager::lastEncoded = 0;

void EncoderManager::begin() {
  pinMode(PinConfig::ENC_C1, INPUT_PULLUP);
  pinMode(PinConfig::ENC_C2, INPUT_PULLUP);

  // Capture the current encoder state so the first interrupt has a valid previous state.
  int MSB = digitalRead(PinConfig::ENC_C1);
  int LSB = digitalRead(PinConfig::ENC_C2);
  lastEncoded = (MSB << 1) | LSB;

  // Both quadrature channels can change, so attach interrupts to both pins.
  attachInterrupt(digitalPinToInterrupt(PinConfig::ENC_C1), EncoderManager::updateEncoder, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PinConfig::ENC_C2), EncoderManager::updateEncoder, CHANGE);
}

void IRAM_ATTR EncoderManager::updateEncoder() {
  // Read both encoder channels and compare old/new states.
  int MSB = digitalRead(PinConfig::ENC_C1);
  int LSB = digitalRead(PinConfig::ENC_C2);

  int encoded = (MSB << 1) | LSB;
  int sum = (lastEncoded << 2) | encoded;

  // Valid quadrature transitions in one direction.
  if (
    sum == 0b1101 ||
    sum == 0b0100 ||
    sum == 0b0010 ||
    sum == 0b1011
  ) {
    rawEncoderTicks++;
  }

  // Valid quadrature transitions in the opposite direction.
  if (
    sum == 0b1110 ||
    sum == 0b0111 ||
    sum == 0b0001 ||
    sum == 0b1000
  ) {
    rawEncoderTicks--;
  }

  lastEncoded = encoded;
}

long EncoderManager::getRawEncoderTicks() {
  // Copy volatile multi-byte value while interrupts are paused.
  noInterrupts();
  long ticks = rawEncoderTicks;
  interrupts();

  return ticks;
}

long EncoderManager::getExtensionTicks() {
  long ticks = getRawEncoderTicks();

  // Force extension is treated as distance, so use the absolute tick count.
  if (ticks < 0) {
    ticks = -ticks;
  }

  return ticks;
}

void EncoderManager::zeroEncoder() {
  // Reset the ISR-owned counter atomically.
  noInterrupts();
  rawEncoderTicks = 0;
  interrupts();
}
