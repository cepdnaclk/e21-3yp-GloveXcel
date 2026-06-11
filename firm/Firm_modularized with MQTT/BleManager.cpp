#include "BleManager.h"
#include "Config.h"

// Define the static instance pointer
BleManager* BleManager::instance = nullptr;

class FrontendBLEServerCallbacks : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer *pServer, NimBLEConnInfo &connInfo) override {
        if (BleManager::getInstance()) {
            BleManager::getInstance()->setConnected(true);
        }
    }

    void onDisconnect(NimBLEServer *pServer, NimBLEConnInfo &connInfo, int reason) override {
        if (BleManager::getInstance()) {
            BleManager::getInstance()->setConnected(false);
        }
        NimBLEDevice::startAdvertising();
    }
};

class MotorCommandCallbacks : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic *pCharacteristic, NimBLEConnInfo &connInfo) override {
        std::string rxValue = pCharacteristic->getValue();

        if (rxValue.length() == 0) {
            return;
        }

        int level = -1;

        // Frontend sends Uint8Array([level]).
        // Example: level 5 is byte value 5, not ASCII character '5'.
        if (rxValue.length() == 1) {
            uint8_t rawByte = (uint8_t)rxValue[0];

            if (rawByte <= MAX_LEVEL) {
                level = (int)rawByte;
            } else {
                // Optional support for text tools that send ASCII '0' to '9'.
                char c = (char)rawByte;
                if (c >= '0' && c <= '9') {
                    level = c - '0';
                }
            }
        } else {
            // Optional support for text tools that send "10".
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

        if (level >= 0 && level <= MAX_LEVEL) {
            if (BleManager::getInstance()) {
                BleManager::getInstance()->queueMotorCommand(level);
            }
        }
    }
};

BleManager::BleManager(const char* name, const char* sUuid, const char* pUuid, const char* mUuid) {
    deviceName = name;
    serviceUuid = sUuid;
    potUuid = pUuid;
    motorUuid = mUuid;
    bleServer = nullptr;
    blePotCharacteristic = nullptr;
    bleMotorCharacteristic = nullptr;
    clientConnected = false;
    motorCommandAvailable = false;
    requestedLevel = 0;
    bleCommandMux = portMUX_INITIALIZER_UNLOCKED;

    // Set singleton instance
    instance = this;
}

void BleManager::setConnected(bool connected) {
    clientConnected = connected;
}

void BleManager::queueMotorCommand(int level) {
    portENTER_CRITICAL(&bleCommandMux);
    requestedLevel = level;
    motorCommandAvailable = true;
    portEXIT_CRITICAL(&bleCommandMux);
}

void BleManager::begin() {
    NimBLEDevice::init(deviceName);
    NimBLEDevice::setMTU(185);

    bleServer = NimBLEDevice::createServer();
    bleServer->setCallbacks(new FrontendBLEServerCallbacks());

    NimBLEService *bleService = bleServer->createService(serviceUuid);

    blePotCharacteristic = bleService->createCharacteristic(
        potUuid,
        NIMBLE_PROPERTY::READ |
        NIMBLE_PROPERTY::NOTIFY
    );

    bleMotorCharacteristic = bleService->createCharacteristic(
        motorUuid,
        NIMBLE_PROPERTY::WRITE |
        NIMBLE_PROPERTY::WRITE_NR
    );

    bleMotorCharacteristic->setCallbacks(new MotorCommandCallbacks());

    uint8_t initialPotPacket[5] = {255, 255, 255, 255, 255};
    blePotCharacteristic->setValue(initialPotPacket, 5);

    bleService->start();

    NimBLEAdvertising *bleAdvertising = NimBLEDevice::getAdvertising();
    bleAdvertising->addServiceUUID(serviceUuid);
    bleAdvertising->setName(deviceName);

    NimBLEDevice::startAdvertising();

    Serial.println("BLE frontend service started.");
    Serial.print("BLE device name: ");
    Serial.println(deviceName);
    Serial.println("BLE Service UUID: 12345678-1234-1234-1234-1234567890ab");
    Serial.println("BLE Pot Notify UUID: 87654321-4321-4321-4321-9876543210ab");
    Serial.println("BLE Motor Write UUID: 11111111-2222-3333-4444-555555555555");
}

bool BleManager::isConnected() const {
    return clientConnected;
}

bool BleManager::fetchMotorCommand(int &level) {
    bool available = false;

    portENTER_CRITICAL(&bleCommandMux);
    if (motorCommandAvailable) {
        level = requestedLevel;
        motorCommandAvailable = false;
        available = true;
    }
    portEXIT_CRITICAL(&bleCommandMux);

    return available;
}

void BleManager::sendPotValues(const int rawValues[5]) {
    if (!clientConnected || blePotCharacteristic == nullptr) {
        return;
    }

    uint8_t potPacket[5];

    for (int i = 0; i < 5; i++) {
        int scaledValue = map(rawValues[i], 0, 4095, 0, 255);
        potPacket[i] = (uint8_t)constrain(scaledValue, 0, 255);
    }

    blePotCharacteristic->setValue(potPacket, 5);
    blePotCharacteristic->notify();
}
