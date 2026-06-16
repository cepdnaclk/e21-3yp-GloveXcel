#ifndef CONFIG_H
#define CONFIG_H

/*
  Central firmware configuration.

  Keep values that control behavior here instead of scattering numbers
  through the code. This makes it easier to tune the motor, BLE UUIDs,
  timing intervals, and force calculation constants from one place.
*/
namespace Config {

// BLE name and UUIDs must match the Web Bluetooth frontend.
constexpr const char *BLE_DEVICE_NAME = "ESP32_FORCE_MOTOR";
constexpr const char *BLE_SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab";
constexpr const char *BLE_POT_CHARACTERISTIC = "87654321-4321-4321-4321-9876543210ab";
constexpr const char *BLE_MOTOR_CHARACTERISTIC = "11111111-2222-3333-4444-555555555555";

// Potentiometer refresh interval. 20 ms gives about 50 updates per second.
constexpr unsigned long POT_PRINT_INTERVAL_MS = 20;

// PWM settings and duty values for the small vibration motor.
constexpr int VIBRATION_PWM_FREQ = 5000;
constexpr int VIBRATION_PWM_RESOLUTION = 8;
constexpr unsigned long VIBRATION_INTERVAL_MS = 2000;
constexpr int VIBRATION_MEDIUM_PWM = 120;
constexpr int VIBRATION_STRONG_PWM = 255;
constexpr int VIBRATION_OFF_PWM = 0;

// Mechanical constants used to convert force level into encoder ticks.
constexpr double SPRING_K = 182.0;
constexpr double SPOOL_RADIUS_M = 0.004;
constexpr int MAX_LEVEL = 10;
constexpr double TICKS_PER_OUTPUT_REV = 1400.0;

// ESP32 Arduino Core 3.x PWM settings for the TB6612FNG motor output.
constexpr int PWM_FREQ = 20000;
constexpr int PWM_RESOLUTION = 8;

// Motor speeds and movement tolerances for normal moves.
constexpr int NORMAL_SPEED = 160;
constexpr int SLOW_SPEED = 90;
constexpr int SLOW_DOWN_TICKS = 80;
constexpr int POSITION_TOLERANCE_TICKS = 5;

// Hold control settings used after reaching a non-zero force level.
constexpr int HOLD_TOLERANCE_TICKS = 8;
constexpr int HOLD_CORRECT_SPEED = 85;

// Change this to true only if the physical motor direction is reversed.
constexpr bool MOTOR_DIR_INVERT = false;

// Safety limits to stop a move if it runs too long or encoder ticks stop.
constexpr unsigned long MOVE_TIMEOUT_MS = 10000;
constexpr unsigned long ENCODER_STUCK_TIME_MS = 500;

}  // namespace Config

#endif
