#include "VibrationMotor.h"

#include <Arduino.h>

#include "Config.h"
#include "PinConfig.h"

void VibrationMotor::begin() {
  // ESP32 Arduino Core 3.x attaches PWM directly to the output pin.
  ledcAttach(PinConfig::VIBRATION_MOTOR_PIN,
             Config::VIBRATION_PWM_FREQ,
             Config::VIBRATION_PWM_RESOLUTION);

  // Start the repeating cycle from medium vibration, matching the original code.
  vibrationState = 0;
  previousVibrationTime = millis();
  applyVibrationState();
}

void VibrationMotor::applyVibrationState() {
  // State 0 = medium, state 1 = strong, state 2 = off.
  if (vibrationState == 0) {
    ledcWrite(PinConfig::VIBRATION_MOTOR_PIN, Config::VIBRATION_MEDIUM_PWM);
  } else if (vibrationState == 1) {
    ledcWrite(PinConfig::VIBRATION_MOTOR_PIN, Config::VIBRATION_STRONG_PWM);
  } else {
    ledcWrite(PinConfig::VIBRATION_MOTOR_PIN, Config::VIBRATION_OFF_PWM);
  }
}

void VibrationMotor::updateVibrationMotorIfNeeded() {
  unsigned long currentTime = millis();

  // Non-blocking timing keeps the rest of loop() responsive.
  if (currentTime - previousVibrationTime >= Config::VIBRATION_INTERVAL_MS) {
    previousVibrationTime = currentTime;

    vibrationState++;

    // Cycle through 0, 1, 2 forever.
    if (vibrationState > 2) {
      vibrationState = 0;
    }

    applyVibrationState();
  }
}

int VibrationMotor::getVibrationState() const {
  return vibrationState;
}
