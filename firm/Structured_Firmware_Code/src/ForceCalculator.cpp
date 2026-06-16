#include "ForceCalculator.h"

#include <Arduino.h>
#include <math.h>

#include "Config.h"

double ForceCalculator::forceToExtensionM(double forceN) {
  // Hooke's law: extension in meters = force in newtons / spring constant.
  return forceN / Config::SPRING_K;
}

double ForceCalculator::extensionToThetaRad(double extensionM) {
  // Arc length formula rearranged: theta = s / r.
  return extensionM / Config::SPOOL_RADIUS_M;
}

double ForceCalculator::radiansToDegrees(double radians) {
  // Degrees are only for printing/debugging; tick conversion could use radians too.
  return radians * 180.0 / PI;
}

long ForceCalculator::degreesToTicks(double degrees) {
  // Convert degrees to output shaft revolutions, then revolutions to encoder ticks.
  double revolutions = degrees / 360.0;
  double ticks = revolutions * Config::TICKS_PER_OUTPUT_REV;

  return lround(ticks);
}

long ForceCalculator::levelToTargetTicks(int level) {
  // Each level maps directly to force in newtons: level 5 = 5 N.
  double forceN = (double)level;
  double extensionM = forceToExtensionM(forceN);
  double thetaRad = extensionToThetaRad(extensionM);
  double degrees = radiansToDegrees(thetaRad);

  return degreesToTicks(degrees);
}

void ForceCalculator::printLevelCalculation(int level) {
  // Recompute intermediate values so the Serial Monitor shows the full calculation.
  double forceN = (double)level;
  double extensionM = forceToExtensionM(forceN);
  double extensionMM = extensionM * 1000.0;
  double thetaRad = extensionToThetaRad(extensionM);
  double degrees = radiansToDegrees(thetaRad);
  long targetTicks = levelToTargetTicks(level);

  Serial.println();
  Serial.print("Level: ");
  Serial.println(level);

  Serial.print("Force: ");
  Serial.print(forceN, 3);
  Serial.println(" N");

  Serial.print("Spring extension: ");
  Serial.print(extensionMM, 3);
  Serial.println(" mm");

  Serial.print("Required angle: ");
  Serial.print(degrees, 3);
  Serial.println(" degrees");

  Serial.print("Target position: ");
  Serial.print(targetTicks);
  Serial.println(" ticks");
}
