#ifndef MOTOR_DRIVER_H
#define MOTOR_DRIVER_H

/*
  MotorDriver is the low-level TB6612FNG driver.

  It only knows how to set pins, PWM, brake, coast, and spin in each direction.
  Higher-level force logic lives in ForceController.
*/
class MotorDriver {
 public:
  // Configure GPIO pins and attach ESP32 Core 3.x PWM to the motor pin.
  void begin();

  // Short-brake mode: both motor inputs HIGH with PWM off.
  void motorBrake();

  // Coast/release mode: both motor inputs LOW with PWM off.
  void motorStopCoast();

  // Raw physical directions before applying MOTOR_DIR_INVERT.
  void motorForwardRaw(int speedValue);
  void motorReverseRaw(int speedValue);

  // Logical force directions used by the force controller.
  void motorIncreaseForce(int speedValue);
  void motorDecreaseForce(int speedValue);
};

#endif
