#include "BLEManager.h"

#include "Config.h"

namespace {
// NimBLE callbacks are plain callback objects, not BLEManager methods.
// This pointer lets callbacks reach the single BLEManager instance safely.
BLEManager *activeBLEManager = nullptr;

class FrontendBLEServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *pServer, NimBLEConnInfo &connInfo) override {
    (void)pServer;
    (void)connInfo;

    if (activeBLEManager != nullptr) {
      activeBLEManager->setClientConnected(true);
    }
  }

  void onDisconnect(NimBLEServer *pServer, NimBLEConnInfo &connInfo, int reason) override {
    (void)pServer;
    (void)connInfo;
    (void)reason;

    if (activeBLEManager != nullptr) {
      activeBLEManager->setClientConnected(false);
    }

    // Restart advertising so the frontend can reconnect after disconnecting.
    NimBLEDevice::startAdvertising();
  }
};

class MotorCommandCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *pCharacteristic, NimBLEConnInfo &connInfo) override {
    (void)connInfo;

    std::string rxValue = pCharacteristic->getValue();

    if (rxValue.length() == 0) {
      return;
    }

    int level = -1;

    // Normal frontend path: one raw byte with value 0 through 10.
    if (rxValue.length() == 1) {
      uint8_t rawByte = (uint8_t)rxValue[0];

      if (rawByte <= Config::MAX_LEVEL) {
        level = (int)rawByte;
      } else {
        // Helpful fallback for BLE testing tools that send ASCII digits.
        char c = (char)rawByte;
        if (c >= '0' && c <= '9') {
          level = c - '0';
        }
      }
    } else {
      // Helpful fallback for text tools that send strings like "10".
      String textCommand = "";

      for (size_t i = 0; i < rxValue.length(); i++) {
        char c = (char)rxValue[i];

        if (c != '\r' && c != '\n') {
          textCommand += c;
        }
      }

      textCommand.trim();

      if (textCommand.length() > 0) {
        level = textCommand.toInt();
      }
    }

    if (level >= 0 && level <= Config::MAX_LEVEL && activeBLEManager != nullptr) {
      // Do not move the motor inside the BLE callback. Queue it for loop().
      activeBLEManager->queueMotorCommand(level);
    }
  }
};
}  // namespace

void BLEManager::begin() {
  // Register this instance before callbacks can fire.
  activeBLEManager = this;

  NimBLEDevice::init(Config::BLE_DEVICE_NAME);
  NimBLEDevice::setMTU(185);

  bleServer = NimBLEDevice::createServer();
  bleServer->setCallbacks(new FrontendBLEServerCallbacks());

  NimBLEService *bleService = bleServer->createService(Config::BLE_SERVICE_UUID);

  // Potentiometer characteristic supports READ for initial value and NOTIFY for updates.
  blePotCharacteristic = bleService->createCharacteristic(
    Config::BLE_POT_CHARACTERISTIC,
    NIMBLE_PROPERTY::READ |
    NIMBLE_PROPERTY::NOTIFY
  );

  // Motor command characteristic accepts writes from the Web Bluetooth frontend.
  bleMotorCharacteristic = bleService->createCharacteristic(
    Config::BLE_MOTOR_CHARACTERISTIC,
    NIMBLE_PROPERTY::WRITE |
    NIMBLE_PROPERTY::WRITE_NR
  );

  bleMotorCharacteristic->setCallbacks(new MotorCommandCallbacks());

  uint8_t initialPotPacket[5] = {255, 255, 255, 255, 255};
  blePotCharacteristic->setValue(initialPotPacket, 5);

  // Start the GATT service and advertise the service UUID/name.
  bleService->start();

  NimBLEAdvertising *bleAdvertising = NimBLEDevice::getAdvertising();
  bleAdvertising->addServiceUUID(Config::BLE_SERVICE_UUID);
  bleAdvertising->setName(Config::BLE_DEVICE_NAME);

  NimBLEDevice::startAdvertising();

  Serial.println("BLE frontend service started.");
  Serial.print("BLE device name: ");
  Serial.println(Config::BLE_DEVICE_NAME);
  Serial.println("BLE Service UUID: 12345678-1234-1234-1234-1234567890ab");
  Serial.println("BLE Pot Notify UUID: 87654321-4321-4321-4321-9876543210ab");
  Serial.println("BLE Motor Write UUID: 11111111-2222-3333-4444-555555555555");
}

void BLEManager::queueMotorCommand(int level) {
  // Critical section protects the command flag/value shared with loop().
  portENTER_CRITICAL(&bleCommandMux);
  bleRequestedLevel = level;
  bleMotorCommandAvailable = true;
  portEXIT_CRITICAL(&bleCommandMux);
}

bool BLEManager::fetchMotorCommand(int &level) {
  bool available = false;

  // Copy and clear the queued command atomically.
  portENTER_CRITICAL(&bleCommandMux);

  if (bleMotorCommandAvailable) {
    level = bleRequestedLevel;
    bleMotorCommandAvailable = false;
    available = true;
  }

  portEXIT_CRITICAL(&bleCommandMux);

  return available;
}

void BLEManager::sendPotentiometerPacket(const uint8_t *packet, size_t length) {
  // No connected frontend means there is nobody to notify.
  if (bleClientConnected == false) {
    return;
  }

  // Avoid using the characteristic before BLE setup has completed.
  if (blePotCharacteristic == nullptr) {
    return;
  }

  blePotCharacteristic->setValue(packet, length);
  blePotCharacteristic->notify();
}

void BLEManager::setClientConnected(bool connected) {
  bleClientConnected = connected;
}
