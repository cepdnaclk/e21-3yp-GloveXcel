#ifndef PIN_CONFIG_H
#define PIN_CONFIG_H

/*
  Hardware pin map.

  Keep every GPIO assignment here so wiring changes only require editing
  this file. The rest of the firmware refers to pins through PinConfig.
*/
namespace PinConfig {

// TB6612FNG motor driver pins.
constexpr int AIN1 = 16;
constexpr int AIN2 = 17;
constexpr int PWMA = 5;
constexpr int STBY = 4;

// N20 quadrature encoder pins.
constexpr int ENC_C1 = 19;
constexpr int ENC_C2 = 18;

// PWM output pin for the vibration motor.
constexpr int VIBRATION_MOTOR_PIN = 15;

// Five analog potentiometer input pins.
constexpr int POT_COUNT = 5;
constexpr int POT_PINS[POT_COUNT] = {36, 39, 34, 35, 32};

}  // namespace PinConfig

#endif
