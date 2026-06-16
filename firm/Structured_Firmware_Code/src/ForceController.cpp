#include "ForceController.h"

#include <Arduino.h>

#include "Config.h"
#include "EncoderManager.h"
#include "ForceCalculator.h"
#include "MotorDriver.h"
#include "VibrationMotor.h"

ForceController::ForceController(MotorDriver &motorDriver,
                                 EncoderManager &encoderManager,
                                 ForceCalculator &forceCalculator,
                                 VibrationMotor &vibrationMotor)
    : motorDriver(motorDriver),
      encoderManager(encoderManager),
      forceCalculator(forceCalculator),
      vibrationMotor(vibrationMotor) {}

void ForceController::moveToTargetTicks(long targetTicks) {
  // The movement loop is blocking by design, but includes timeout safety checks.
  unsigned long moveStartTime = millis();
  unsigned long lastTickChangeTime = millis();

  // Used to detect whether the encoder has stopped changing while moving.
  long lastExtensionTicks = encoderManager.getExtensionTicks();

  while (true) {
    long currentTicks = encoderManager.getExtensionTicks();
    long errorTicks = targetTicks - currentTicks;
    long absError = abs(errorTicks);

    if (absError <= Config::POSITION_TOLERANCE_TICKS) {
      Serial.println("Target reached.");
      break;
    }

    // Stop if the move takes too long.
    if (millis() - moveStartTime > Config::MOVE_TIMEOUT_MS) {
      Serial.println("ERROR: Move timeout. Motor stopped for safety.");
      break;
    }

    if (currentTicks != lastExtensionTicks) {
      lastExtensionTicks = currentTicks;
      lastTickChangeTime = millis();
    }

    // Stop if the motor is commanded but encoder ticks are not changing.
    if (millis() - lastTickChangeTime > Config::ENCODER_STUCK_TIME_MS) {
      Serial.println("ERROR: Encoder ticks not changing. Motor stopped for safety.");
      Serial.println("Check encoder wiring ENC_C1 and ENC_C2.");
      break;
    }

    int motorSpeed = Config::NORMAL_SPEED;

    // Slow down near the target to reduce overshoot.
    if (absError <= Config::SLOW_DOWN_TICKS) {
      motorSpeed = Config::SLOW_SPEED;
    }

    if (errorTicks > 0) {
      motorDriver.motorIncreaseForce(motorSpeed);
    } else {
      motorDriver.motorDecreaseForce(motorSpeed);
    }

    // Keep the vibration cycle alive while this blocking move is running.
    vibrationMotor.updateVibrationMotorIfNeeded();
  }

  // Brake after the move. If hold is enabled, holdPositionControl() continues from loop().
  motorDriver.motorBrake();
}

void ForceController::holdPositionControl() {
  if (holdEnabled == false) {
    return;
  }

  long currentTicks = encoderManager.getExtensionTicks();
  long errorTicks = holdTargetTicks - currentTicks;
  long absError = abs(errorTicks);

  // Inside tolerance: hold the motor with brake mode.
  if (absError <= Config::HOLD_TOLERANCE_TICKS) {
    motorDriver.motorBrake();
  } else if (errorTicks > 0) {
    // Spring relaxed below target, so pull back toward more force.
    motorDriver.motorIncreaseForce(Config::HOLD_CORRECT_SPEED);
  } else {
    // Motor moved too far, so release slightly.
    motorDriver.motorDecreaseForce(Config::HOLD_CORRECT_SPEED);
  }
}

void ForceController::moveToLevel(int level) {
  // Reject invalid levels before doing any motor work.
  if (level < 0 || level > Config::MAX_LEVEL) {
    Serial.println();
    Serial.print("Invalid level. Enter 0 to ");
    Serial.println(Config::MAX_LEVEL);
    return;
  }

  forceCalculator.printLevelCalculation(level);

  // Compare current extension against the calculated target for this level.
  long currentTicks = encoderManager.getExtensionTicks();
  long targetTicks = forceCalculator.levelToTargetTicks(level);
  long neededMove = targetTicks - currentTicks;

  Serial.print("Current raw encoder ticks: ");
  Serial.println(encoderManager.getRawEncoderTicks());

  Serial.print("Current extension ticks: ");
  Serial.println(currentTicks);

  Serial.print("Target extension ticks: ");
  Serial.println(targetTicks);

  Serial.print("Need to move: ");
  Serial.print(neededMove);
  Serial.println(" ticks");

  if (abs(neededMove) <= Config::POSITION_TOLERANCE_TICKS) {
    Serial.println("Already near this level.");
  } else {
    // Direction print is for the user; actual direction happens in moveToTargetTicks().
    if (neededMove > 0) {
      Serial.println("Direction: Increase spring force");
    } else {
      Serial.println("Direction: Decrease spring force");
    }

    Serial.println("Motor moving...");
    moveToTargetTicks(targetTicks);
  }

  currentLevel = level;
  holdTargetTicks = targetTicks;

  // Level 0 means release. Non-zero levels enable active hold.
  if (level == 0) {
    holdEnabled = false;
    motorDriver.motorStopCoast();
    Serial.println("Level 0 reached. Hold disabled and motor released.");
  } else {
    holdEnabled = true;
    Serial.println("Hold position enabled.");
  }

  Serial.print("Final raw encoder ticks: ");
  Serial.println(encoderManager.getRawEncoderTicks());

  Serial.print("Final extension ticks: ");
  Serial.println(encoderManager.getExtensionTicks());

  Serial.println();
  Serial.println("Enter next level:");
}

void ForceController::printCurrentPosition() {
  long rawTicks = encoderManager.getRawEncoderTicks();
  long extensionTicks = encoderManager.getExtensionTicks();

  Serial.println();

  Serial.print("Current level command: ");
  Serial.println(currentLevel);

  Serial.print("Raw encoder ticks: ");
  Serial.println(rawTicks);

  Serial.print("Extension ticks: ");
  Serial.println(extensionTicks);

  Serial.print("Hold target ticks: ");
  Serial.println(holdTargetTicks);

  Serial.print("Hold enabled: ");
  if (holdEnabled) {
    Serial.println("YES");
  } else {
    Serial.println("NO");
  }

  Serial.print("Vibration state: ");
  int vibrationState = vibrationMotor.getVibrationState();
  if (vibrationState == 0) {
    Serial.println("Medium");
  } else if (vibrationState == 1) {
    Serial.println("Strong");
  } else {
    Serial.println("OFF");
  }
}

void ForceController::disableHold() {
  holdEnabled = false;
}

void ForceController::resetLevelState() {
  currentLevel = 0;
  holdTargetTicks = 0;
}
