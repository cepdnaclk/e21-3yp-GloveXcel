#ifndef FORCE_CONTROLLER_H
#define FORCE_CONTROLLER_H

class MotorDriver;
class EncoderManager;
class ForceCalculator;
class VibrationMotor;

/*
  ForceController is the high-level motor behavior.

  It converts requested force levels into target encoder ticks, moves the
  motor to the target, then keeps holding that position until released.
*/
class ForceController {
 public:
  ForceController(MotorDriver &motorDriver,
                  EncoderManager &encoderManager,
                  ForceCalculator &forceCalculator,
                  VibrationMotor &vibrationMotor);

  // Blocking move used by moveToLevel() until target, timeout, or safety stop.
  void moveToTargetTicks(long targetTicks);

  // Main command: move to force level 0-10 and update hold state.
  void moveToLevel(int level);

  // Called every loop() to correct drift after a non-zero level is reached.
  void holdPositionControl();

  // Print current level, raw ticks, extension ticks, hold state, and vibration.
  void printCurrentPosition();

  // Used by serial commands when releasing or zeroing the system.
  void disableHold();
  void resetLevelState();

 private:
  // References to the modules this controller coordinates.
  MotorDriver &motorDriver;
  EncoderManager &encoderManager;
  ForceCalculator &forceCalculator;
  VibrationMotor &vibrationMotor;

  // Current force command and hold target maintained by this controller.
  bool holdEnabled = false;
  int currentLevel = 0;
  long holdTargetTicks = 0;
};

#endif
