#include <Arduino.h>
#include <NimBLEDevice.h>
#include <math.h>

// ===================== Motor pins =====================
#define AIN1 2
#define AIN2 4
#define PWMA 5
#define STBY 19

#define ENC_C1 21
#define ENC_C2 18

// ===================== Finger sensor pins =====================
// The 5 safe ADC1 pins for your fingers: Thumb, Index, Middle, Ring, Pinky
const int potPins[] = {39, 32, 34, 35, 36};

// ===================== BLE UUIDs =====================
static const char* SERVICE_UUID        = "12345678-1234-1234-1234-1234567890ab";
static const char* MOTOR_CMD_UUID      = "11111111-2222-3333-4444-555555555555";
static const char* FINGER_DATA_UUID    = "87654321-4321-4321-4321-9876543210ab";

// Fixed BLE passkey for pairing
static const uint32_t BLE_PASSKEY = 123456;

// ===================== Encoder / motor settings =====================
const long COUNTS_PER_OUTPUT_REV = 840;

const int PWM_FREQ = 20000;
const int PWM_RES  = 8;

const int MAX_PWM      = 220;
const int MOVE_MIN_PWM = 90;

// Holding power increases by force level
const int HOLD_PWM_BASE = 35;
const int HOLD_PWM_STEP = 8;

// ===================== Spring / axle system =====================
const float SPRING_K = 182.0f;
const float AXLE_RADIUS_M = 0.004f;  // 4 mm radius

const int MIN_LEVEL = 1;
const int MAX_LEVEL = 10;

// Level 1 = 1 N, Level 10 = 10 N
const float FORCE_PER_LEVEL_N = 1.0f;

// ===================== PID tuning =====================
float KP = 0.8f;
float KI = 0.03f;
float KD = 0.08f;

const long BRAKE_BAND_COUNTS = 2;

volatile long encoderCount = 0;

long zeroCounts = 0;
long targetCounts = 0;

int currentLevel = 0;
bool holdActive = false;

float integral = 0.0f;
long prevError = 0;
unsigned long prevControlTime = 0;
unsigned long lastPrint = 0;
unsigned long lastFingerNotify = 0;

// ===================== BLE =====================
NimBLEServer* pServer = nullptr;
NimBLECharacteristic* motorCmdChar = nullptr;
NimBLECharacteristic* fingerDataChar = nullptr;

bool deviceConnected = false;

// ===================== Function declarations =====================
void IRAM_ATTR encoderISR_C1();
void IRAM_ATTR encoderISR_C2();

void motorForward(int speedVal);
void motorReverse(int speedVal);
void motorCoast();
void motorBrake();

long getEncoderCount();
float countsToAngle(long counts);
long angleToCounts(float angleDeg);

float levelToForce(int level);
float forceToLength(float forceN);
float lengthToAngleDeg(float lengthM);

void commandLevel(int level);
void updatePositionController();

void setupBLE();
void updateFingerNotify();

// ===================== BLE callbacks =====================
class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo) override {
    deviceConnected = true;
    Serial.println("Client connected");
    NimBLEDevice::stopAdvertising();
  }

  void onDisconnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo, int reason) override {
    deviceConnected = false;
    Serial.println("Client disconnected");
    NimBLEDevice::startAdvertising();
  }
};

class MotorCommandCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pCharacteristic, NimBLEConnInfo& connInfo) override {
    std::string value = pCharacteristic->getValue();

    if (value.empty()) {
      Serial.println("BLE command ignored: empty value");
      return;
    }

    int level = -1;

    // Option 1: text payload like "1", "2", ..., "10"
    bool isTextNumber = true;
    for (size_t i = 0; i < value.size(); i++) {
      if (value[i] < '0' || value[i] > '9') {
        isTextNumber = false;
        break;
      }
    }

    if (isTextNumber) {
      String s = "";
      for (size_t i = 0; i < value.size(); i++) {
        s += (char)value[i];
      }
      level = s.toInt();
    }
    // Option 2: one raw byte: 1..10
    else if (value.size() == 1) {
      level = (uint8_t)value[0];
    }
    // Option 3: int16 little-endian: 1..10
    else if (value.size() == 2) {
      int16_t received = (int16_t)((uint8_t)value[0] | ((uint8_t)value[1] << 8));
      level = received;
    }

    if (level >= MIN_LEVEL && level <= MAX_LEVEL) {
      Serial.print("BLE level command received: ");
      Serial.println(level);
      commandLevel(level);
    } else {
      Serial.print("BLE command ignored. Invalid level: ");
      Serial.println(level);
      Serial.println("Send only level 1 to 10.");
    }
  }
};

// ===================== Setup =====================
void setup() {
  Serial.begin(115200);

  pinMode(AIN1, OUTPUT);
  pinMode(AIN2, OUTPUT);
  pinMode(STBY, OUTPUT);

  pinMode(ENC_C1, INPUT);
  pinMode(ENC_C2, INPUT);

  digitalWrite(STBY, HIGH);

  ledcAttach(PWMA, PWM_FREQ, PWM_RES);
  motorCoast();

  attachInterrupt(digitalPinToInterrupt(ENC_C1), encoderISR_C1, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENC_C2), encoderISR_C2, CHANGE);

  zeroCounts = getEncoderCount();
  targetCounts = zeroCounts;

  holdActive = true;
  prevControlTime = millis();
  lastFingerNotify = millis();

  setupBLE();

  Serial.println("Motor force level control ready");
  Serial.println("Type level 1 to 10 in Serial Monitor.");
  Serial.println("Or send level 1 to 10 via Bluetooth.");
  Serial.println("Level 1 = 1 N");
  Serial.println("Level 10 = 10 N");
  Serial.println("Using spring constant k = 182 N/m");
  Serial.println("Finger data notify characteristic also active.");
}

// ===================== Loop =====================
void loop() {
  updatePositionController();
  updateFingerNotify();

  // Serial fallback testing
  if (Serial.available()) {
    String s = Serial.readStringUntil('\n');
    s.trim();

    if (s.length() > 0) {
      int level = s.toInt();

      if (level >= MIN_LEVEL && level <= MAX_LEVEL) {
        commandLevel(level);
      } else {
        Serial.println("Invalid level. Enter only 1 to 10.");
      }
    }
  }
}

// ===================== Encoder ISR =====================
void IRAM_ATTR encoderISR_C1() {
  bool c1 = digitalRead(ENC_C1);
  bool c2 = digitalRead(ENC_C2);
  encoderCount += (c1 == c2) ? 1 : -1;
}

void IRAM_ATTR encoderISR_C2() {
  bool c1 = digitalRead(ENC_C1);
  bool c2 = digitalRead(ENC_C2);
  encoderCount += (c1 != c2) ? 1 : -1;
}

// ===================== Motor control =====================
void motorForward(int speedVal) {
  speedVal = constrain(speedVal, 0, 255);
  digitalWrite(AIN1, HIGH);
  digitalWrite(AIN2, LOW);
  ledcWrite(PWMA, speedVal);
}

void motorReverse(int speedVal) {
  speedVal = constrain(speedVal, 0, 255);
  digitalWrite(AIN1, LOW);
  digitalWrite(AIN2, HIGH);
  ledcWrite(PWMA, speedVal);
}

void motorCoast() {
  digitalWrite(AIN1, LOW);
  digitalWrite(AIN2, LOW);
  ledcWrite(PWMA, 0);
}

void motorBrake() {
  digitalWrite(AIN1, HIGH);
  digitalWrite(AIN2, HIGH);
  ledcWrite(PWMA, 255);
}

// ===================== Encoder helpers =====================
long getEncoderCount() {
  noInterrupts();
  long c = encoderCount;
  interrupts();
  return c;
}

float countsToAngle(long counts) {
  return (counts * 360.0f) / COUNTS_PER_OUTPUT_REV;
}

long angleToCounts(float angleDeg) {
  return lround((angleDeg * COUNTS_PER_OUTPUT_REV) / 360.0f);
}

// ===================== Force logic =====================
float levelToForce(int level) {
  return level * FORCE_PER_LEVEL_N;
}

float forceToLength(float forceN) {
  return forceN / SPRING_K;
}

float lengthToAngleDeg(float lengthM) {
  float angleRad = lengthM / AXLE_RADIUS_M;
  float angleDeg = angleRad * 180.0f / PI;
  return angleDeg;
}

// ===================== Command force level =====================
void commandLevel(int level) {
  currentLevel = level;

  float targetForceN = levelToForce(level);
  float targetLengthM = forceToLength(targetForceN);
  float targetAngleDeg = lengthToAngleDeg(targetLengthM);

  long targetOffsetCounts = angleToCounts(targetAngleDeg);
  long currentCounts = getEncoderCount();

  targetCounts = zeroCounts + targetOffsetCounts;

  holdActive = true;

  integral = 0.0f;
  prevError = targetCounts - currentCounts;
  prevControlTime = millis();

  float springTorque = targetForceN * AXLE_RADIUS_M;

  Serial.println("--------------------------------------------------");
  Serial.print("Selected level: ");
  Serial.println(level);

  Serial.print("Target force: ");
  Serial.print(targetForceN);
  Serial.println(" N");

  Serial.print("Required spring length: ");
  Serial.print(targetLengthM * 100.0f);
  Serial.println(" cm");

  Serial.print("Required axle angle: ");
  Serial.print(targetAngleDeg);
  Serial.println(" deg");

  Serial.print("Required encoder counts: ");
  Serial.println(targetOffsetCounts);

  Serial.print("Current count: ");
  Serial.println(currentCounts);

  Serial.print("Target count: ");
  Serial.println(targetCounts);

  Serial.print("Spring torque on axle: ");
  Serial.print(springTorque);
  Serial.println(" Nm");
}

// ===================== Continuous position hold =====================
void updatePositionController() {
  if (!holdActive) return;

  unsigned long now = millis();
  float dt = (now - prevControlTime) / 1000.0f;

  if (dt <= 0.0f) return;

  prevControlTime = now;

  long currentCounts = getEncoderCount();
  long error = targetCounts - currentCounts;

  if (labs(error) <= BRAKE_BAND_COUNTS) {
    integral = 0.0f;
    prevError = error;
    motorBrake();
    return;
  }

  integral += error * dt;

  if (integral > 1000) integral = 1000;
  if (integral < -1000) integral = -1000;

  float derivative = (error - prevError) / dt;
  prevError = error;

  float output = KP * error + KI * integral + KD * derivative;
  int pwm = (int)fabs(output);

  int dynamicHoldMinPWM = HOLD_PWM_BASE + ((currentLevel - 1) * HOLD_PWM_STEP);

  int minPWM;
  if (labs(error) > 20) {
    minPWM = MOVE_MIN_PWM;
  } else {
    minPWM = dynamicHoldMinPWM;
  }

  if (abs(error) > 2 && pwm < minPWM) {
    pwm = minPWM;
  }
  if (pwm > MAX_PWM) pwm = MAX_PWM;

  if (error > 0) {
    motorForward(pwm);
  } else {
    motorReverse(pwm);
  }

  if (now - lastPrint >= 200) {
    lastPrint = now;

    Serial.print("Level: ");
    Serial.print(currentLevel);

    Serial.print(" | Current angle: ");
    Serial.print(countsToAngle(currentCounts - zeroCounts));

    Serial.print(" deg | Target angle: ");
    Serial.print(countsToAngle(targetCounts - zeroCounts));

    Serial.print(" deg | Error counts: ");
    Serial.print(error);

    Serial.print(" | PWM: ");
    Serial.println(pwm);
  }
}

// ===================== Finger data notify =====================
void updateFingerNotify() {
  if (!deviceConnected || fingerDataChar == nullptr) return;

  unsigned long now = millis();
  if (now - lastFingerNotify < 100) return;  // 10 updates per second
  lastFingerNotify = now;

  uint8_t fingerData[5];

  for (int i = 0; i < 5; i++) {
    int rawValue = analogRead(potPins[i]);
    fingerData[i] = (uint8_t)map(rawValue, 0, 4095, 0, 255);
  }

  fingerDataChar->setValue(fingerData, sizeof(fingerData));
  fingerDataChar->notify();

  Serial.printf("Sending: T:%d I:%d M:%d R:%d P:%d\n",
                fingerData[0], fingerData[1], fingerData[2], fingerData[3], fingerData[4]);
}

// ===================== BLE setup =====================
void setupBLE() {
  NimBLEDevice::init("SmartGloveMotor");

  // Security: bonding + MITM + secure connections
  NimBLEDevice::setSecurityAuth(true, true, true);
  NimBLEDevice::setSecurityPasskey(BLE_PASSKEY);
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_DISPLAY_ONLY);

  NimBLEDevice::setSecurityInitKey(BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID);
  NimBLEDevice::setSecurityRespKey(BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID);

  pServer = NimBLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());
  pServer->advertiseOnDisconnect(true);

  NimBLEService* service = pServer->createService(SERVICE_UUID);

  // Motor command characteristic (same behavior as code 1)
  motorCmdChar = service->createCharacteristic(
    MOTOR_CMD_UUID,
    NIMBLE_PROPERTY::WRITE |
    NIMBLE_PROPERTY::WRITE_ENC |
    NIMBLE_PROPERTY::WRITE_AUTHEN
  );
  motorCmdChar->setCallbacks(new MotorCommandCallbacks());

  // Finger stream characteristic (same UUID/behavior intent as code 2)
  fingerDataChar = service->createCharacteristic(
    FINGER_DATA_UUID,
    NIMBLE_PROPERTY::READ |
    NIMBLE_PROPERTY::NOTIFY
  );

  service->start();

  NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->start();

  Serial.println("BLE combined service started");
  Serial.print("BLE device name: ");
  Serial.println("SmartGloveMotor");
  Serial.print("BLE passkey: ");
  Serial.println(BLE_PASSKEY);
  Serial.println("Characteristics:");
  Serial.print("- Motor command UUID: ");
  Serial.println(MOTOR_CMD_UUID);
  Serial.print("- Finger data UUID: ");
  Serial.println(FINGER_DATA_UUID);
}