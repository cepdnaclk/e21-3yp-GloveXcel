#ifndef SERIAL_COMMAND_HANDLER_H
#define SERIAL_COMMAND_HANDLER_H

#include <Arduino.h>

class EncoderManager;
class ForceController;
class MotorDriver;

/*
  SerialCommandHandler keeps the original Serial Monitor command interface.

  Supported commands:
    Z/z = zero encoder and release motor
    P/p = print current position
    R/r = release motor and disable hold
    0-10 = move to that force level
*/
class SerialCommandHandler {
 public:
  SerialCommandHandler(ForceController &forceController,
                       EncoderManager &encoderManager,
                       MotorDriver &motorDriver);

  // Parse and execute one line read from Serial.
  void processSerialCommand(String input);

 private:
  // References to the modules needed by the supported serial commands.
  ForceController &forceController;
  EncoderManager &encoderManager;
  MotorDriver &motorDriver;
};

#endif
