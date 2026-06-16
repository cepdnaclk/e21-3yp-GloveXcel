#ifndef ENCODER_MANAGER_H
#define ENCODER_MANAGER_H

#include <Arduino.h>

/*
  EncoderManager owns the quadrature encoder count.

  The interrupt routine updates rawEncoderTicks. Public getter methods copy
  that volatile value safely while interrupts are paused for a very short time.
*/
class EncoderManager {
 public:
  // Configure encoder pins, read the initial state, and attach interrupts.
  void begin();

  // Signed raw tick count from the quadrature decoder.
  long getRawEncoderTicks();

  // Absolute tick count used as spring extension distance.
  long getExtensionTicks();

  // Set the current encoder position to zero.
  void zeroEncoder();

  // Static ISR required by attachInterrupt().
  static void IRAM_ATTR updateEncoder();

 private:
  // Volatile because these values are changed inside an interrupt.
  static volatile long rawEncoderTicks;
  static volatile int lastEncoded;
};

#endif
