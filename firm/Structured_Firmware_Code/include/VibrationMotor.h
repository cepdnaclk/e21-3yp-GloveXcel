#ifndef VIBRATION_MOTOR_H
#define VIBRATION_MOTOR_H

/*
  VibrationMotor runs the repeating PWM vibration pattern.

  The cycle is medium for 2 seconds, strong for 2 seconds, then off for
  2 seconds. Timing is non-blocking so loop() can keep doing other work.
*/
class VibrationMotor {
 public:
  // Attach PWM and start from the medium vibration state.
  void begin();

  // Write the PWM duty that matches the current vibration state.
  void applyVibrationState();

  // Advance the vibration state when its interval has elapsed.
  void updateVibrationMotorIfNeeded();

  // Used by ForceController when printing status.
  int getVibrationState() const;

 private:
  // Local state for the non-blocking vibration timer.
  unsigned long previousVibrationTime = 0;
  int vibrationState = 0;
};

#endif
