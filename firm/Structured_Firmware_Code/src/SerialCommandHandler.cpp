#include "SerialCommandHandler.h"

#include "EncoderManager.h"
#include "ForceController.h"
#include "MotorDriver.h"

SerialCommandHandler::SerialCommandHandler(ForceController &forceController,
                                           EncoderManager &encoderManager,
                                           MotorDriver &motorDriver)
    : forceController(forceController),
      encoderManager(encoderManager),
      motorDriver(motorDriver) {}

void SerialCommandHandler::processSerialCommand(String input) {
  // Remove newline/spaces from the Serial Monitor input.
  input.trim();

  if (input.length() == 0) {
    return;
  }

  if (input == "Z" || input == "z") {
    // Zeroing also releases the motor and resets the current level state.
    forceController.disableHold();
    encoderManager.zeroEncoder();
    motorDriver.motorStopCoast();

    forceController.resetLevelState();

    Serial.println();
    Serial.println("Encoder zeroed.");
    Serial.println("Current position = 0 ticks");
    Serial.println("Now enter level 0 to 10.");
    return;
  }

  if (input == "P" || input == "p") {
    // Print current status without moving anything.
    forceController.printCurrentPosition();
    return;
  }

  if (input == "R" || input == "r") {
    // Release the motor without changing encoder zero.
    forceController.disableHold();
    motorDriver.motorStopCoast();

    Serial.println();
    Serial.println("Motor released. Hold disabled.");
    return;
  }

  // Any other input is interpreted as a force level number, just like before.
  int level = input.toInt();
  forceController.moveToLevel(level);
}
