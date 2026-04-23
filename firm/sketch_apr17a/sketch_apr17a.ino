#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h> // The magic subscription fix!

// The 5 safe ADC1 pins for your fingers
const int potPins[] = {39, 32, 34, 35, 36}; // Thumb, Index, Middle, Ring, Pinky

#define SERVICE_UUID        "12345678-1234-1234-1234-1234567890ab"
#define CHARACTERISTIC_UUID "87654321-4321-4321-4321-9876543210ab"

BLECharacteristic *pCharacteristic;
bool deviceConnected = false;

// Connection Handlers
class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      Serial.println("Client Connected!");
    };

    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      pServer->getAdvertising()->start();
      Serial.println("Client disconnected. Restarting advertising...");
    }
};

void setup() {
  Serial.begin(115200);

  // Initialize BLE
  BLEDevice::init("ESP32 Smart Glove"); 
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  // Create Characteristic
  pCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ |
                      BLECharacteristic::PROPERTY_NOTIFY
                    );

  // ADD THE DESCRIPTOR FOR CHROME SUBSCRIPTIONS
  pCharacteristic->addDescriptor(new BLE2902()); 

  pService->start();
  pServer->getAdvertising()->start();
  Serial.println("Waiting for a client to connect via Bluetooth...");
}

void loop() {
  if (deviceConnected) {
    uint8_t fingerData[5]; // Array to hold the 5 bytes
    
    // Read and map all 5 potentiometers
    for (int i = 0; i < 5; i++) {
      int rawValue = analogRead(potPins[i]);
      fingerData[i] = map(rawValue, 0, 4095, 0, 255); 
    }

    // Send the 5-byte array over Bluetooth
    pCharacteristic->setValue(fingerData, 5); 
    pCharacteristic->notify(); 

    // Print to Serial for local debugging
    Serial.printf("Sending: T:%d I:%d M:%d R:%d P:%d\n", 
                  fingerData[0], fingerData[1], fingerData[2], fingerData[3], fingerData[4]);

    delay(100); // 10 updates per second
  }
}