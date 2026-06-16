#include "MotorDriver.h"

#include <Arduino.h>

#include "Config.h"
#include "PinConfig.h"

void MotorDriver::begin() {
  // Direction and standby pins are normal digital outputs.
  pinMode(PinConfig::AIN1, OUTPUT);
  pinMode(PinConfig::AIN2, OUTPUT);
  pinMode(PinConfig::STBY, OUTPUT);

  // ESP32 Arduino Core 3.x attaches PWM directly to the GPIO pin.
  ledcAttach(PinConfig::PWMA, Config::PWM_FREQ, Config::PWM_RESOLUTION);

  // Enable the driver, then leave the motor released until commanded.
  digitalWrite(PinConfig::STBY, HIGH);
  motorStopCoast();
}

void MotorDriver::motorBrake() {
  // PWM off first, then set both inputs HIGH for TB6612FNG short brake.
  ledcWrite(PinConfig::PWMA, 0);

  digitalWrite(PinConfig::STBY, HIGH);
  digitalWrite(PinConfig::AIN1, HIGH);
  digitalWrite(PinConfig::AIN2, HIGH);
}

void MotorDriver::motorStopCoast() {
  // PWM off and both inputs LOW lets the motor coast freely.
  ledcWrite(PinConfig::PWMA, 0);

  digitalWrite(PinConfig::AIN1, LOW);
  digitalWrite(PinConfig::AIN2, LOW);
}

void MotorDriver::motorForwardRaw(int speedValue) {
  // Keep duty cycle inside the 8-bit PWM range.
  speedValue = constrain(speedValue, 0, 255);

  digitalWrite(PinConfig::STBY, HIGH);
  digitalWrite(PinConfig::AIN1, HIGH);
  digitalWrite(PinConfig::AIN2, LOW);

  ledcWrite(PinConfig::PWMA, speedValue);
}

void MotorDriver::motorReverseRaw(int speedValue) {
  // Keep duty cycle inside the 8-bit PWM range.
  speedValue = constrain(speedValue, 0, 255);

  digitalWrite(PinConfig::STBY, HIGH);
  digitalWrite(PinConfig::AIN1, LOW);
  digitalWrite(PinConfig::AIN2, HIGH);

  ledcWrite(PinConfig::PWMA, speedValue);
}

void MotorDriver::motorIncreaseForce(int speedValue) {
  // Logical force direction can be inverted without rewiring the motor.
  if (Config::MOTOR_DIR_INVERT == false) {
    motorForwardRaw(speedValue);
  } else {
    motorReverseRaw(speedValue);
  }
}

void MotorDriver::motorDecreaseForce(int speedValue) {
  // Opposite logical direction from motorIncreaseForce().
  if (Config::MOTOR_DIR_INVERT == false) {
    motorReverseRaw(speedValue);
  } else {
    motorForwardRaw(speedValue);
  }
}
