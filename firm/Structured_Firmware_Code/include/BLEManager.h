#ifndef BLE_MANAGER_H
#define BLE_MANAGER_H

#include <Arduino.h>
#include <NimBLEDevice.h>

/*
  BLEManager owns the Web Bluetooth service.

  It sends potentiometer packets to the frontend and receives motor level
  commands. Motor commands are only queued here; the main loop fetches and
  executes them so BLE callbacks never move the motor directly.
*/
class BLEManager {
 public:
  // Start NimBLE, create service/characteristics, and begin advertising.
  void begin();

  // Store the latest requested level from a BLE callback in a thread-safe way.
  void queueMotorCommand(int level);

  // Called from loop(). Returns true when a queued BLE command is available.
  bool fetchMotorCommand(int &level);

  // Notify the connected frontend with the 5-byte potentiometer packet.
  void sendPotentiometerPacket(const uint8_t *packet, size_t length);

  // Called by server callbacks when a frontend connects or disconnects.
  void setClientConnected(bool connected);

 private:
  // NimBLE objects are kept here so no other module needs BLE internals.
  NimBLEServer *bleServer = nullptr;
  NimBLECharacteristic *blePotCharacteristic = nullptr;
  NimBLECharacteristic *bleMotorCharacteristic = nullptr;

  // This small queue crosses from BLE callback context into normal loop code.
  bool bleClientConnected = false;
  portMUX_TYPE bleCommandMux = portMUX_INITIALIZER_UNLOCKED;
  bool bleMotorCommandAvailable = false;
  int bleRequestedLevel = 0;
};

#endif
