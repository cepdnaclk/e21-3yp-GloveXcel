#pragma once

#include <Arduino.h>

// =====================================================
// BLE settings for frontend doctor.html
// =====================================================
#define BLE_DEVICE_NAME "ESP32_FORCE_MOTOR"
#define BLE_SERVICE_UUID         "12345678-1234-1234-1234-1234567890ab"
#define BLE_POT_CHARACTERISTIC   "87654321-4321-4321-4321-9876543210ab"
#define BLE_MOTOR_CHARACTERISTIC "11111111-2222-3333-4444-555555555555"

// =====================================================
// MQTT settings for HiveMQ Cloud
// =====================================================
#define WIFI_SSID "Galaxy A12"
#define WIFI_PASSWORD "wrbj14352"

#define MQTT_HOST "f13259acb4eb4d23a9ccdd68b977301c.s1.eu.hivemq.cloud"
#define MQTT_PORT 8883

#define MQTT_USERNAME "Glovexl"
#define MQTT_PASSWORD "200209Ost"

#define MQTT_TOPIC "project/glove01/fingers"
#define MQTT_STATUS_TOPIC "project/glove01/status"
#define MQTT_DEVICE_ID "glove01"

// MQTT publish rate (100 ms = 10 messages/sec)
constexpr unsigned long MQTT_PUBLISH_INTERVAL = 100;

// Non-blocking reconnect timers
constexpr unsigned long WIFI_RECONNECT_INTERVAL = 5000;
constexpr unsigned long MQTT_RECONNECT_INTERVAL = 5000;

// Keep this false to avoid mixing MQTT publish lines with fast pot Serial output
constexpr bool MQTT_PRINT_EACH_PUBLISH = false;

// =====================================================
// TB6612FNG motor pins
// =====================================================
constexpr int PIN_AIN1 = 16;
constexpr int PIN_AIN2 = 17;
constexpr int PIN_PWMA = 5;
constexpr int PIN_STBY = 4;

// =====================================================
// Encoder pins
// =====================================================
constexpr int PIN_ENC_C1 = 19;
constexpr int PIN_ENC_C2 = 18;

// =====================================================
// Vibration motor pin
// =====================================================
constexpr int PIN_VIBRATION_MOTOR = 15;

// =====================================================
// Potentiometer pins
// =====================================================
constexpr int POT_PINS[5] = {36, 39, 34, 35, 32};

// Pot refresh rate (20 ms = 50 readings/sec)
constexpr unsigned long PRINT_INTERVAL = 20;

// =====================================================
// Vibration motor settings
// =====================================================
constexpr int VIBRATION_PWM_FREQ = 5000;
constexpr int VIBRATION_PWM_RESOLUTION = 8;
constexpr unsigned long VIBRATION_INTERVAL = 2000;

// =====================================================
// Spring and mechanical values
// =====================================================
constexpr double SPRING_K = 182.0;
constexpr double SPOOL_RADIUS_M = 0.004;
constexpr int MAX_LEVEL = 10;
constexpr double TICKS_PER_OUTPUT_REV = 1400.0;

// =====================================================
// Motor speed and limits settings
// =====================================================
constexpr int PWM_FREQ = 20000;
constexpr int PWM_RESOLUTION = 8;

constexpr int NORMAL_SPEED = 160;
constexpr int SLOW_SPEED = 90;
constexpr int SLOW_DOWN_TICKS = 80;
constexpr int POSITION_TOLERANCE_TICKS = 5;

// =====================================================
// Hold control settings
// =====================================================
constexpr int HOLD_TOLERANCE_TICKS = 8;
constexpr int HOLD_CORRECT_SPEED = 85;

// Motor direction inversion safety flag
constexpr bool MOTOR_DIR_INVERT = false;

// Safety settings
constexpr unsigned long MOVE_TIMEOUT_MS = 10000;
constexpr unsigned long ENCODER_STUCK_TIME_MS = 500;
