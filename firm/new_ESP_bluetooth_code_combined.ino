#include <Arduino.h>
#include <NimBLEDevice.h>
#include <math.h>

/*
  ESP32 Combined Code

  Function 1:
    TB6612FNG + N20 Encoder Motor Force Level Control with Hold Position

  Function 2:
    5 Potentiometer Reader

  Function 3:
    Vibration Motor PWM Cycle
      Medium vibration -> 2 seconds
      Strong vibration -> 2 seconds
      OFF              -> 2 seconds

  Added Function 4:
    BLE Web Bluetooth connection for frontend doctor.html

  Frontend BLE UUIDs used in doctor.html:
    Service UUID:
      12345678-1234-1234-1234-1234567890ab

    Potentiometer Notify Characteristic UUID:
      87654321-4321-4321-4321-9876543210ab

    Motor Command Write Characteristic UUID:
      11111111-2222-3333-4444-555555555555

  Motor Commands:
    From Serial Monitor:
      Z  -> zero encoder at 0 N position
      P  -> print current motor position
      R  -> release motor / coast stop
      0  -> move to 0 N position
      1  -> move to 1 N force position and hold
      ...
      10 -> move to 10 N force position and hold

    From Frontend BLE:
      One byte value:
        0  -> move to 0 N position
        1  -> move to 1 N force position and hold
        ...
        10 -> move to 10 N force position and hold

  Potentiometer Output:
    Serial Monitor:
      GPIO36 = value | GPIO39 = value | GPIO34 = value | GPIO35 = value | GPIO32 = value
      Values are original ESP32 ADC values from 0 to 4095.

    Frontend BLE:
      Sends 5 bytes through BLE notification.
      Each potentiometer value is scaled from 0-4095 to 0-255
      because the frontend reads Uint8 values.

  IMPORTANT:
    Serial Monitor baud rate: 115200
    Line ending: Newline

    For frontend:
      Open doctor.html from localhost or HTTPS.
      Browser Web Bluetooth does not work properly from normal file:// pages.
*/

// =====================================================
// BLE settings for frontend doctor.html
// =====================================================
#define BLE_DEVICE_NAME "ESP32_FORCE_MOTOR"

#define BLE_SERVICE_UUID        "12345678-1234-1234-1234-1234567890ab"
#define BLE_POT_CHARACTERISTIC  "87654321-4321-4321-4321-9876543210ab"
#define BLE_MOTOR_CHARACTERISTIC "11111111-2222-3333-4444-555555555555"

NimBLEServer *bleServer = nullptr;
NimBLECharacteristic *blePotCharacteristic = nullptr;
NimBLECharacteristic *bleMotorCharacteristic = nullptr;

bool bleClientConnected = false;

// BLE command queue
portMUX_TYPE bleCommandMux = portMUX_INITIALIZER_UNLOCKED;
bool bleMotorCommandAvailable = false;
int bleRequestedLevel = 0;

// =====================================================
// TB6612FNG motor pins
// =====================================================
#define AIN1 16
#define AIN2 17
#define PWMA 5
#define STBY 4

// =====================================================
// Encoder pins
// =====================================================
#define ENC_C1 19
#define ENC_C2 18

// =====================================================
// Vibration motor pin
// =====================================================
#define VIBRATION_MOTOR_PIN 15

// =====================================================
// Potentiometer pins
// =====================================================
const int potPins[5] = {
  36,
  39,
  34,
  35,
  32
};

// Pot refresh rate
// 20 ms = 50 readings per second
const unsigned long printInterval = 20;
unsigned long previousPrintTime = 0;

// =====================================================
// Vibration motor settings
// =====================================================
#define VIBRATION_PWM_FREQ 5000
#define VIBRATION_PWM_RESOLUTION 8

const unsigned long vibrationInterval = 2000;

unsigned long previousVibrationTime = 0;
int vibrationState = 0;

// vibrationState:
// 0 = medium vibration
// 1 = strong vibration
// 2 = off

// =====================================================
// Spring and mechanical values
// =====================================================
#define SPRING_K 182.0
#define SPOOL_RADIUS_M 0.004
#define MAX_LEVEL 10

/*
  Encoder ticks per one output shaft revolution.

  Common N20 example:
    7 PPR encoder
    50:1 gearbox
    quadrature x4

    7 * 50 * 4 = 1400 ticks/rev
*/
#define TICKS_PER_OUTPUT_REV 1400.0

// =====================================================
// ESP32 PWM settings
// Arduino ESP32 Core 3.x
// =====================================================
#define PWM_FREQ 20000
#define PWM_RESOLUTION 8

// =====================================================
// Motor speed settings
// =====================================================
#define NORMAL_SPEED 160
#define SLOW_SPEED 90
#define SLOW_DOWN_TICKS 80
#define POSITION_TOLERANCE_TICKS 5

// =====================================================
// Hold control settings
// =====================================================
#define HOLD_TOLERANCE_TICKS 8
#define HOLD_CORRECT_SPEED 85

/*
  If the motor physically rotates the wrong direction,
  change this from false to true.

  false = AIN1 HIGH, AIN2 LOW increases spring force
  true  = AIN1 LOW, AIN2 HIGH increases spring force
*/
#define MOTOR_DIR_INVERT false

// Safety settings
#define MOVE_TIMEOUT_MS 10000
#define ENCODER_STUCK_TIME_MS 500

// =====================================================
// Encoder variables
// =====================================================
volatile long rawEncoderTicks = 0;
volatile int lastEncoded = 0;

// =====================================================
// Hold variables
// =====================================================
bool holdEnabled = false;
int currentLevel = 0;
long holdTargetTicks = 0;

// =====================================================
// Forward declarations
// =====================================================
void moveToLevel(int level);
void processSerialCommand(String input);
void setupBLE();
void queueBLEMotorCommand(int level);
bool fetchBLEMotorCommand(int &level);
void sendPotValuesToBLE();

// =====================================================
// BLE server callbacks
// =====================================================
class FrontendBLEServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *pServer, NimBLEConnInfo &connInfo) override {
    bleClientConnected = true;
  }

  void onDisconnect(NimBLEServer *pServer, NimBLEConnInfo &connInfo, int reason) override {
    bleClientConnected = false;
    NimBLEDevice::startAdvertising();
  }
};

// =====================================================
// BLE motor command characteristic callback
// Frontend sends one byte: 0 to 10.
// We do not move the motor inside this callback.
// We only queue the command and process it safely in loop().
// =====================================================
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
      queueBLEMotorCommand(level);
    }
  }
};

// =====================================================
// Queue BLE motor command safely
// =====================================================
void queueBLEMotorCommand(int level) {
  portENTER_CRITICAL(&bleCommandMux);
  bleRequestedLevel = level;
  bleMotorCommandAvailable = true;
  portEXIT_CRITICAL(&bleCommandMux);
}

// =====================================================
// Fetch BLE motor command safely
// =====================================================
bool fetchBLEMotorCommand(int &level) {
  bool available = false;

  portENTER_CRITICAL(&bleCommandMux);

  if (bleMotorCommandAvailable) {
    level = bleRequestedLevel;
    bleMotorCommandAvailable = false;
    available = true;
  }

  portEXIT_CRITICAL(&bleCommandMux);

  return available;
}

// =====================================================
// BLE setup for frontend
// =====================================================
void setupBLE() {
  NimBLEDevice::init(BLE_DEVICE_NAME);
  NimBLEDevice::setMTU(185);

  bleServer = NimBLEDevice::createServer();
  bleServer->setCallbacks(new FrontendBLEServerCallbacks());

  NimBLEService *bleService = bleServer->createService(BLE_SERVICE_UUID);

  blePotCharacteristic = bleService->createCharacteristic(
    BLE_POT_CHARACTERISTIC,
    NIMBLE_PROPERTY::READ |
    NIMBLE_PROPERTY::NOTIFY
  );

  bleMotorCharacteristic = bleService->createCharacteristic(
    BLE_MOTOR_CHARACTERISTIC,
    NIMBLE_PROPERTY::WRITE |
    NIMBLE_PROPERTY::WRITE_NR
  );

  bleMotorCharacteristic->setCallbacks(new MotorCommandCallbacks());

  uint8_t initialPotPacket[5] = {255, 255, 255, 255, 255};
  blePotCharacteristic->setValue(initialPotPacket, 5);

  bleService->start();

  NimBLEAdvertising *bleAdvertising = NimBLEDevice::getAdvertising();
  bleAdvertising->addServiceUUID(BLE_SERVICE_UUID);
  bleAdvertising->setName(BLE_DEVICE_NAME);

  NimBLEDevice::startAdvertising();

  Serial.println("BLE frontend service started.");
  Serial.print("BLE device name: ");
  Serial.println(BLE_DEVICE_NAME);
  Serial.println("BLE Service UUID: 12345678-1234-1234-1234-1234567890ab");
  Serial.println("BLE Pot Notify UUID: 87654321-4321-4321-4321-9876543210ab");
  Serial.println("BLE Motor Write UUID: 11111111-2222-3333-4444-555555555555");
}

// =====================================================
// Potentiometer reading function
// =====================================================
int readPotValue(int pin) {
  int value1 = analogRead(pin);
  int value2 = analogRead(pin);
  int value3 = analogRead(pin);

  return (value1 + value2 + value3) / 3;
}

// =====================================================
// Send potentiometer values to frontend through BLE notification
// Frontend expects 5 bytes and reads them with getUint8().
// Therefore each ADC value 0-4095 is scaled to 0-255.
// =====================================================
void sendPotValuesToBLE() {
  if (bleClientConnected == false) {
    return;
  }

  if (blePotCharacteristic == nullptr) {
    return;
  }

  uint8_t potPacket[5];

  for (int i = 0; i < 5; i++) {
    int rawValue = readPotValue(potPins[i]);
    int scaledValue = map(rawValue, 0, 4095, 0, 255);
    scaledValue = constrain(scaledValue, 0, 255);

    potPacket[i] = (uint8_t)scaledValue;
  }

  blePotCharacteristic->setValue(potPacket, 5);
  blePotCharacteristic->notify();
}

// =====================================================
// Potentiometer print function
// Original Serial Monitor output is kept.
// BLE notification output is added.
// =====================================================
void printPotValuesIfNeeded() {
  unsigned long currentTime = millis();

  if (currentTime - previousPrintTime >= printInterval) {
    previousPrintTime = currentTime;

    for (int i = 0; i < 5; i++) {
      int rawValue = readPotValue(potPins[i]);

      Serial.print("GPIO");
      Serial.print(potPins[i]);
      Serial.print(" = ");
      Serial.print(rawValue);

      if (i < 4) {
        Serial.print(" | ");
      }
    }

    Serial.println();

    // Extra Bluetooth frontend output.
    // This does not change the original Serial output functionality.
    sendPotValuesToBLE();
  }
}

// =====================================================
// Vibration motor output function
// =====================================================
void applyVibrationState() {
  if (vibrationState == 0) {
    // Medium vibration
    ledcWrite(VIBRATION_MOTOR_PIN, 120);
  } else if (vibrationState == 1) {
    // Strong vibration
    ledcWrite(VIBRATION_MOTOR_PIN, 255);
  } else {
    // OFF
    ledcWrite(VIBRATION_MOTOR_PIN, 0);
  }
}

// =====================================================
// Vibration motor update function
// Same logic as delay code, but non-blocking
// =====================================================
void updateVibrationMotorIfNeeded() {
  unsigned long currentTime = millis();

  if (currentTime - previousVibrationTime >= vibrationInterval) {
    previousVibrationTime = currentTime;

    vibrationState++;

    if (vibrationState > 2) {
      vibrationState = 0;
    }

    applyVibrationState();
  }
}

// =====================================================
// Encoder interrupt function
// =====================================================
void IRAM_ATTR updateEncoder() {
  int MSB = digitalRead(ENC_C1);
  int LSB = digitalRead(ENC_C2);

  int encoded = (MSB << 1) | LSB;
  int sum = (lastEncoded << 2) | encoded;

  if (
    sum == 0b1101 ||
    sum == 0b0100 ||
    sum == 0b0010 ||
    sum == 0b1011
  ) {
    rawEncoderTicks++;
  }

  if (
    sum == 0b1110 ||
    sum == 0b0111 ||
    sum == 0b0001 ||
    sum == 0b1000
  ) {
    rawEncoderTicks--;
  }

  lastEncoded = encoded;
}

// =====================================================
// Safely get raw encoder ticks
// =====================================================
long getRawEncoderTicks() {
  noInterrupts();
  long ticks = rawEncoderTicks;
  interrupts();

  return ticks;
}

// =====================================================
// Get spring extension ticks
// We use absolute value because encoder may count positive or negative.
// =====================================================
long getExtensionTicks() {
  long ticks = getRawEncoderTicks();

  if (ticks < 0) {
    ticks = -ticks;
  }

  return ticks;
}

// =====================================================
// Zero encoder
// =====================================================
void zeroEncoder() {
  noInterrupts();
  rawEncoderTicks = 0;
  interrupts();
}

// =====================================================
// Motor brake / hold
// =====================================================
void motorBrake() {
  ledcWrite(PWMA, 0);

  // TB6612FNG short brake mode
  digitalWrite(STBY, HIGH);
  digitalWrite(AIN1, HIGH);
  digitalWrite(AIN2, HIGH);
}

// =====================================================
// Motor coast stop / release
// =====================================================
void motorStopCoast() {
  ledcWrite(PWMA, 0);

  // TB6612FNG coast mode
  digitalWrite(AIN1, LOW);
  digitalWrite(AIN2, LOW);
}

// =====================================================
// Raw motor forward
// =====================================================
void motorForwardRaw(int speedValue) {
  speedValue = constrain(speedValue, 0, 255);

  digitalWrite(STBY, HIGH);

  digitalWrite(AIN1, HIGH);
  digitalWrite(AIN2, LOW);

  ledcWrite(PWMA, speedValue);
}

// =====================================================
// Raw motor reverse
// =====================================================
void motorReverseRaw(int speedValue) {
  speedValue = constrain(speedValue, 0, 255);

  digitalWrite(STBY, HIGH);

  digitalWrite(AIN1, LOW);
  digitalWrite(AIN2, HIGH);

  ledcWrite(PWMA, speedValue);
}

// =====================================================
// Increase spring force direction
// =====================================================
void motorIncreaseForce(int speedValue) {
  if (MOTOR_DIR_INVERT == false) {
    motorForwardRaw(speedValue);
  } else {
    motorReverseRaw(speedValue);
  }
}

// =====================================================
// Decrease spring force direction
// =====================================================
void motorDecreaseForce(int speedValue) {
  if (MOTOR_DIR_INVERT == false) {
    motorReverseRaw(speedValue);
  } else {
    motorForwardRaw(speedValue);
  }
}

// =====================================================
// Convert force to spring extension
// x = F / k
// =====================================================
double forceToExtensionM(double forceN) {
  return forceN / SPRING_K;
}

// =====================================================
// Convert extension to angle in radians
// theta = s / r
// =====================================================
double extensionToThetaRad(double extensionM) {
  return extensionM / SPOOL_RADIUS_M;
}

// =====================================================
// Convert radians to degrees
// =====================================================
double radiansToDegrees(double radians) {
  return radians * 180.0 / PI;
}

// =====================================================
// Convert degrees to ticks
// =====================================================
long degreesToTicks(double degrees) {
  double revolutions = degrees / 360.0;
  double ticks = revolutions * TICKS_PER_OUTPUT_REV;

  return lround(ticks);
}

// =====================================================
// Convert force level to target ticks
// Level 1 = 1 N
// Level 2 = 2 N
// Level 10 = 10 N
// =====================================================
long levelToTargetTicks(int level) {
  double forceN = (double)level;
  double extensionM = forceToExtensionM(forceN);
  double thetaRad = extensionToThetaRad(extensionM);
  double degrees = radiansToDegrees(thetaRad);

  return degreesToTicks(degrees);
}

// =====================================================
// Print calculation
// =====================================================
void printLevelCalculation(int level) {
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

// =====================================================
// Move to target extension position
// =====================================================
void moveToTargetTicks(long targetTicks) {
  unsigned long moveStartTime = millis();
  unsigned long lastTickChangeTime = millis();

  long lastExtensionTicks = getExtensionTicks();

  while (true) {
    long currentTicks = getExtensionTicks();
    long errorTicks = targetTicks - currentTicks;
    long absError = abs(errorTicks);

    if (absError <= POSITION_TOLERANCE_TICKS) {
      Serial.println("Target reached.");
      break;
    }

    // Timeout safety
    if (millis() - moveStartTime > MOVE_TIMEOUT_MS) {
      Serial.println("ERROR: Move timeout. Motor stopped for safety.");
      break;
    }

    // Encoder stuck safety
    if (currentTicks != lastExtensionTicks) {
      lastExtensionTicks = currentTicks;
      lastTickChangeTime = millis();
    }

    if (millis() - lastTickChangeTime > ENCODER_STUCK_TIME_MS) {
      Serial.println("ERROR: Encoder ticks not changing. Motor stopped for safety.");
      Serial.println("Check encoder wiring ENC_C1 and ENC_C2.");
      break;
    }

    int motorSpeed = NORMAL_SPEED;

    if (absError <= SLOW_DOWN_TICKS) {
      motorSpeed = SLOW_SPEED;
    }

    if (errorTicks > 0) {
      motorIncreaseForce(motorSpeed);
    } else {
      motorDecreaseForce(motorSpeed);
    }

    // Keep vibration motor cycle running while main motor is moving
    updateVibrationMotorIfNeeded();
  }

  // Do not coast here.
  // Brake first, then hold loop will continue controlling position.
  motorBrake();
}

// =====================================================
// Hold target position continuously
// =====================================================
void holdPositionControl() {
  if (holdEnabled == false) {
    return;
  }

  long currentTicks = getExtensionTicks();
  long errorTicks = holdTargetTicks - currentTicks;
  long absError = abs(errorTicks);

  if (absError <= HOLD_TOLERANCE_TICKS) {
    // Position is correct. Keep motor in brake mode.
    motorBrake();
  } else if (errorTicks > 0) {
    // Spring pulled back, so increase force again.
    motorIncreaseForce(HOLD_CORRECT_SPEED);
  } else {
    // Motor moved too far, so release/decrease slightly.
    motorDecreaseForce(HOLD_CORRECT_SPEED);
  }
}

// =====================================================
// Move to force level
// =====================================================
void moveToLevel(int level) {
  if (level < 0 || level > MAX_LEVEL) {
    Serial.println();
    Serial.print("Invalid level. Enter 0 to ");
    Serial.println(MAX_LEVEL);
    return;
  }

  printLevelCalculation(level);

  long currentTicks = getExtensionTicks();
  long targetTicks = levelToTargetTicks(level);
  long neededMove = targetTicks - currentTicks;

  Serial.print("Current raw encoder ticks: ");
  Serial.println(getRawEncoderTicks());

  Serial.print("Current extension ticks: ");
  Serial.println(currentTicks);

  Serial.print("Target extension ticks: ");
  Serial.println(targetTicks);

  Serial.print("Need to move: ");
  Serial.print(neededMove);
  Serial.println(" ticks");

  if (abs(neededMove) <= POSITION_TOLERANCE_TICKS) {
    Serial.println("Already near this level.");
  } else {
    if (neededMove > 0) {
      Serial.println("Direction: Increase spring force");
    } else {
      Serial.println("Direction: Decrease spring force");
    }

    Serial.println("Motor moving...");
    moveToTargetTicks(targetTicks);
  }

  currentLevel = level;
  holdTargetTicks = targetTicks;

  if (level == 0) {
    holdEnabled = false;
    motorStopCoast();
    Serial.println("Level 0 reached. Hold disabled and motor released.");
  } else {
    holdEnabled = true;
    Serial.println("Hold position enabled.");
  }

  Serial.print("Final raw encoder ticks: ");
  Serial.println(getRawEncoderTicks());

  Serial.print("Final extension ticks: ");
  Serial.println(getExtensionTicks());

  Serial.println();
  Serial.println("Enter next level:");
}

// =====================================================
// Print current motor position
// =====================================================
void printCurrentPosition() {
  long rawTicks = getRawEncoderTicks();
  long extensionTicks = getExtensionTicks();

  Serial.println();

  Serial.print("Current level command: ");
  Serial.println(currentLevel);

  Serial.print("Raw encoder ticks: ");
  Serial.println(rawTicks);

  Serial.print("Extension ticks: ");
  Serial.println(extensionTicks);

  Serial.print("Hold target ticks: ");
  Serial.println(holdTargetTicks);

  Serial.print("Hold enabled: ");
  if (holdEnabled) {
    Serial.println("YES");
  } else {
    Serial.println("NO");
  }

  Serial.print("Vibration state: ");
  if (vibrationState == 0) {
    Serial.println("Medium");
  } else if (vibrationState == 1) {
    Serial.println("Strong");
  } else {
    Serial.println("OFF");
  }
}

// =====================================================
// Process original Serial Monitor command
// Original functionality is kept.
// =====================================================
void processSerialCommand(String input) {
  input.trim();

  if (input.length() == 0) {
    return;
  }

  if (input == "Z" || input == "z") {
    holdEnabled = false;
    zeroEncoder();
    motorStopCoast();

    currentLevel = 0;
    holdTargetTicks = 0;

    Serial.println();
    Serial.println("Encoder zeroed.");
    Serial.println("Current position = 0 ticks");
    Serial.println("Now enter level 0 to 10.");
    return;
  }

  if (input == "P" || input == "p") {
    printCurrentPosition();
    return;
  }

  if (input == "R" || input == "r") {
    holdEnabled = false;
    motorStopCoast();

    Serial.println();
    Serial.println("Motor released. Hold disabled.");
    return;
  }

  int level = input.toInt();
  moveToLevel(level);
}

// =====================================================
// Setup
// =====================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  // Motor pin setup
  pinMode(AIN1, OUTPUT);
  pinMode(AIN2, OUTPUT);
  pinMode(STBY, OUTPUT);

  // Encoder pin setup
  pinMode(ENC_C1, INPUT_PULLUP);
  pinMode(ENC_C2, INPUT_PULLUP);

  // Potentiometer ADC setup
  analogReadResolution(12);  // ESP32 ADC range: 0 to 4095

  for (int i = 0; i < 5; i++) {
    analogSetPinAttenuation(potPins[i], ADC_11db);
  }

  // ESP32 Arduino Core 3.x PWM setup for TB6612FNG motor
  ledcAttach(PWMA, PWM_FREQ, PWM_RESOLUTION);

  // ESP32 Arduino Core 3.x PWM setup for vibration motor
  ledcAttach(VIBRATION_MOTOR_PIN, VIBRATION_PWM_FREQ, VIBRATION_PWM_RESOLUTION);

  // Start vibration motor from medium state
  vibrationState = 0;
  previousVibrationTime = millis();
  applyVibrationState();

  // Read initial encoder state
  int MSB = digitalRead(ENC_C1);
  int LSB = digitalRead(ENC_C2);
  lastEncoded = (MSB << 1) | LSB;

  // Attach encoder interrupts
  attachInterrupt(digitalPinToInterrupt(ENC_C1), updateEncoder, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENC_C2), updateEncoder, CHANGE);

  digitalWrite(STBY, HIGH);
  motorStopCoast();

  // Start BLE service for frontend
  setupBLE();

  Serial.println();
  Serial.println("ESP32 Combined System Started");
  Serial.println("--------------------------------------------");
  Serial.println("Function 1: TB6612FNG N20 Force Level Hold Control");
  Serial.println("Function 2: 5 Potentiometer Reader");
  Serial.println("Function 3: Vibration Motor PWM Cycle");
  Serial.println("Function 4: Frontend BLE Web Bluetooth Control");
  Serial.println("--------------------------------------------");
  Serial.println("Spring constant k = 182 N/m");
  Serial.println("Spool radius = 4 mm");
  Serial.println("Max level = 10 N");
  Serial.println();
  Serial.println("Potentiometer pins:");
  Serial.println("Pot 1 -> GPIO36");
  Serial.println("Pot 2 -> GPIO39");
  Serial.println("Pot 3 -> GPIO34");
  Serial.println("Pot 4 -> GPIO35");
  Serial.println("Pot 5 -> GPIO32");
  Serial.println();
  Serial.println("Vibration motor:");
  Serial.println("GPIO25");
  Serial.println("Medium = PWM 120 for 2 seconds");
  Serial.println("Strong = PWM 255 for 2 seconds");
  Serial.println("OFF    = PWM 0 for 2 seconds");
  Serial.println();
  Serial.println("Motor commands:");
  Serial.println("Serial Monitor: Z, P, R, 0 to 10");
  Serial.println("Frontend BLE: 0 to 10 written as one byte to motor characteristic");
  Serial.println();
  Serial.println("Frontend BLE UUIDs:");
  Serial.println("Service: 12345678-1234-1234-1234-1234567890ab");
  Serial.println("Pot notify: 87654321-4321-4321-4321-9876543210ab");
  Serial.println("Motor write: 11111111-2222-3333-4444-555555555555");
  Serial.println();
  Serial.println("IMPORTANT:");
  Serial.println("1. Keep spring at 0 N starting position.");
  Serial.println("2. For Serial Monitor test, type Z to zero encoder.");
  Serial.println("3. For frontend test, power up ESP32 at the 0 N starting position.");
  Serial.println("4. Then select motor level 0 to 10 from frontend.");
  Serial.println();
}

// =====================================================
// Main loop
// =====================================================
void loop() {
  // Motor hold function
  holdPositionControl();

  // Potentiometer reader function
  // Keeps original Serial output and also sends BLE packets to frontend
  printPotValuesIfNeeded();

  // Vibration motor function
  updateVibrationMotorIfNeeded();

  // Frontend BLE motor command reader
  int bleLevel = 0;

  if (fetchBLEMotorCommand(bleLevel)) {
    moveToLevel(bleLevel);
  }

  // Original Serial command reader for motor
  // Kept to avoid changing the original functionality.
  if (Serial.available() > 0) {
    String input = Serial.readStringUntil('\n');
    processSerialCommand(input);
  }
}
