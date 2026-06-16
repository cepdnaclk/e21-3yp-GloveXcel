#ifndef FORCE_CALCULATOR_H
#define FORCE_CALCULATOR_H

/*
  ForceCalculator contains only the math.

  It converts a requested force level into spring extension, spool angle,
  and finally encoder ticks. Keeping this separate makes the formulas easier
  to review and tune.
*/
class ForceCalculator {
 public:
  // Hooke's law: x = F / k.
  double forceToExtensionM(double forceN);

  // Spool angle in radians: theta = extension / radius.
  double extensionToThetaRad(double extensionM);

  // Helper conversion for readable debug output.
  double radiansToDegrees(double radians);

  // Convert spool rotation degrees to encoder ticks.
  long degreesToTicks(double degrees);

  // Complete conversion from user level to target encoder ticks.
  long levelToTargetTicks(int level);

  // Print the intermediate calculation values to Serial.
  void printLevelCalculation(int level);
};

#endif
