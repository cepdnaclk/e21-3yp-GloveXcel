#include <Arduino.h>

#include "BLEManager.h"
#include "Config.h"
#include "EncoderManager.h"
#include "ForceCalculator.h"
#include "ForceController.h"
#include "MotorDriver.h"
#include "PinConfig.h"
#include "PotentiometerReader.h"
#include "SerialCommandHandler.h"
#include "VibrationMotor.h"

// One object per firmware module. Keeping them here makes setup() and loop()
// easy to read while still allowing each module to own its own behavior.
BLEManager bleManager;
MotorDriver motorDriver;
EncoderManager encoderManager;
ForceCalculator forceCalculator;
VibrationMotor vibrationMotor;
PotentiometerReader potReader(bleManager);
ForceController forceController(motorDriver, encoderManager, forceCalculator, vibrationMotor);
SerialCommandHandler serialCommandHandler(forceController, encoderManager, motorDriver);

// Startup text is kept in one function so setup() stays short and clean.
void printStartupMessages() {
  Serial.println();
  Serial.println("ESP32 Combined System Started");
  Serial.println("--------------------------------------------");
  Serial.println("Function 1: TB6612FNG N20 Force Level Hold Control");
  Serial.println("Function 2: 5 Potentiometer Reader");
  Serial.println("Function 3: Vibration Motor PWM Cycle");
  Serial.println("Function 4: Frontend BLE Web Bluetooth Control");
  Serial.println("--------------------------------------------");
  Serial.println("Spring constant k = 182 N/m");
  Serial.println("Spool radius = 4 mm");
  Serial.println("Max level = 10 N");
  Serial.println();
  Serial.println("Potentiometer pins:");
  Serial.println("Pot 1 -> GPIO36");
  Serial.println("Pot 2 -> GPIO39");
  Serial.println("Pot 3 -> GPIO34");
  Serial.println("Pot 4 -> GPIO35");
  Serial.println("Pot 5 -> GPIO32");
  Serial.println();
  Serial.println("Vibration motor:");
  Serial.print("GPIO");
  Serial.println(PinConfig::VIBRATION_MOTOR_PIN);
  Serial.println("Medium = PWM 120 for 2 seconds");
  Serial.println("Strong = PWM 255 for 2 seconds");
  Serial.println("OFF    = PWM 0 for 2 seconds");
  Serial.println();
  Serial.println("Motor commands:");
  Serial.println("Serial Monitor: Z, P, R, 0 to 10");
  Serial.println("Frontend BLE: 0 to 10 written as one byte to motor characteristic");
  Serial.println();
  Serial.println("Frontend BLE UUIDs:");
  Serial.println("Service: 12345678-1234-1234-1234-1234567890ab");
  Serial.println("Pot notify: 87654321-4321-4321-4321-9876543210ab");
  Serial.println("Motor write: 11111111-2222-3333-4444-555555555555");
  Serial.println();
  Serial.println("IMPORTANT:");
  Serial.println("1. Keep spring at 0 N starting position.");
  Serial.println("2. For Serial Monitor test, type Z to zero encoder.");
  Serial.println("3. For frontend test, power up ESP32 at the 0 N starting position.");
  Serial.println("4. Then select motor level 0 to 10 from frontend.");
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  // Initialize hardware modules first, then start BLE, then print instructions.
  motorDriver.begin();
  encoderManager.begin();
  potReader.begin();
  vibrationMotor.begin();
  bleManager.begin();

  printStartupMessages();
}

void loop() {
  // These three tasks run continuously without delay() so the firmware remains responsive.
  forceController.holdPositionControl();
  potReader.printPotValuesIfNeeded();
  vibrationMotor.updateVibrationMotorIfNeeded();

  int bleLevel = 0;

  // BLE callbacks only queue motor commands. The actual motor move happens here.
  if (bleManager.fetchMotorCommand(bleLevel)) {
    forceController.moveToLevel(bleLevel);
  }

  // Serial commands are kept for direct testing from the Arduino Serial Monitor.
  if (Serial.available() > 0) {
    String input = Serial.readStringUntil('\n');
    serialCommandHandler.processSerialCommand(input);
  }
}
