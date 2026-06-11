#pragma once

#include <NimBLEDevice.h>
#include <Arduino.h>

class BleManager {
private:
    static BleManager* instance;

    const char* deviceName;
    const char* serviceUuid;
    const char* potUuid;
    const char* motorUuid;

    NimBLEServer* bleServer;
    NimBLECharacteristic* blePotCharacteristic;
    NimBLECharacteristic* bleMotorCharacteristic;

    volatile bool clientConnected;
    portMUX_TYPE bleCommandMux;
    volatile bool motorCommandAvailable;
    volatile int requestedLevel;

    // Friend classes to access the singleton instance variables
    friend class FrontendBLEServerCallbacks;
    friend class MotorCommandCallbacks;

    void setConnected(bool connected);
    void queueMotorCommand(int level);

public:
    BleManager(
        const char* name = "ESP32_FORCE_MOTOR",
        const char* sUuid = "12345678-1234-1234-1234-1234567890ab",
        const char* pUuid = "87654321-4321-4321-4321-9876543210ab",
        const char* mUuid = "11111111-2222-3333-4444-555555555555"
    );

    // Initializer to start BLE device, setup characteristics, and advertise
    void begin();
    
    // Status check for client connection
    bool isConnected() const;

    // Thread-safe command check and dequeueing. Returns true if a command was fetched.
    bool fetchMotorCommand(int &level);

    // Scaling and notifying pot packet (5 bytes, scaled from 0-4095 to 0-255) to the client
    void sendPotValues(const int rawValues[5]);
    
    // Static getter for callback access
    static BleManager* getInstance() { return instance; }
};
