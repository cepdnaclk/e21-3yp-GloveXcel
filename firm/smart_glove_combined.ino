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
const int potPins[] = {39, 32, 34, 35, 36};
float filteredValues[5] = {0, 0, 0, 0, 0};
float smoothingFactor = 0.05f;

// --- STABILITY SETTINGS ---
#define SAMPLES 16
#define HYSTERESIS_BIT 2
uint8_t lastSentData[5] = {0, 0, 0, 0, 0};

// ===================== BLE UUIDs =====================
static const char* SERVICE_UUID      = "12345678-1234-1234-1234-1234567890ab";
static const char* SENSOR_CHAR_UUID  = "87654321-4321-4321-4321-9876543210ab";
static const char* MOTOR_CMD_UUID    = "11111111-2222-3333-4444-555555555555";

// Fixed BLE passkey for pairing
static const uint32_t BLE_PASSKEY = 123456;

// ===================== Encoder / motor settings =====================
const long COUNTS_PER_OUTPUT_REV = 840;

const int PWM_FREQ = 20000;
const int PWM_RES  = 8;

const int MAX_PWM      = 220;
const int MOVE_MIN_PWM = 70;

// Holding power increases by force level
const int HOLD_PWM_BASE = 35;
const int HOLD_PWM_STEP = 8;

// ===================== Spring / axle system =====================
const float SPRING_K = 182.0f;
const float AXLE_RADIUS_M = 0.004f;

const int MIN_LEVEL = 1;
const int MAX_LEVEL = 10;

// Level 1 = 1 N, Level 10 = 10 N
const float FORCE_PER_LEVEL_N = 1.0f;

// ===================== PID tuning =====================
float KP = 0.8f;
float KI = 0.03f;
float KD = 0.08f;

const long BRAKE_BAND_COUNTS = 1;

volatile long encoderCount = 0;

long zeroCounts = 0;
long targetCounts = 0;

int currentLevel = 0;
bool holdActive = false;

float integral = 0.0f;
long prevError = 0;
unsigned long prevControlTime = 0;
unsigned long lastPrint = 0;

// Return to zero after a test command
const unsigned long AUTO_RETURN_MS = 1500;
bool autoReturnPending = false;
unsigned long autoReturnAtMs = 0;

// ===================== BLE globals =====================
NimBLEServer* pServer = nullptr;
NimBLECharacteristic* motorCmdChar = nullptr;
NimBLECharacteristic* sensorChar = nullptr;

volatile bool bleClientConnected = false;
unsigned long lastBleDisconnectMs = 0;

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

int getStableRead(int pin);
void updateAndNotifyFingerData();

void setupBLE();
void startAdvertisingNow();

// ===================== BLE callbacks =====================
class ServerCallbacks : public NimBLEServerCallbacks {
	void onConnect(NimBLEServer* server, NimBLEConnInfo& connInfo) override {
		bleClientConnected = true;

		// Request a tighter supervision timeout so stale browser links drop faster.
		server->updateConnParams(connInfo.getConnHandle(), 12, 24, 0, 60);

		Serial.println("BLE client connected");
	}

	void onDisconnect(NimBLEServer* server, NimBLEConnInfo& connInfo, int reason) override {
		bleClientConnected = false;
		lastBleDisconnectMs = millis();

		Serial.print("BLE client disconnected, reason: ");
		Serial.println(reason);

		startAdvertisingNow();
	}
};

class MotorCommandCallbacks : public NimBLECharacteristicCallbacks {
	void onWrite(NimBLECharacteristic* pCharacteristic, NimBLEConnInfo& connInfo) override {
		std::string value = pCharacteristic->getValue();

		if (value.size() == 0) {
			Serial.println("BLE command ignored: empty value");
			return;
		}

		int level = -1;

		// Option 1: frontend sends text like "1", "2", ..., "10"
		bool isTextNumber = true;
		for (int i = 0; i < (int)value.size(); i++) {
			if (value[i] < '0' || value[i] > '9') {
				isTextNumber = false;
				break;
			}
		}

		if (isTextNumber) {
			String s = "";
			for (int i = 0; i < (int)value.size(); i++) {
				s += (char)value[i];
			}
			level = s.toInt();
		}
		// Option 2: frontend sends one raw byte: 1 to 10
		else if (value.size() == 1) {
			level = (uint8_t)value[0];
		}
		// Option 3: frontend sends int16 little-endian: 1 to 10
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

	// Motor GPIO setup
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

	// Sensor ADC setup
	analogReadResolution(12);
	analogSetAttenuation(ADC_11db);
	for (int i = 0; i < 5; i++) {
		filteredValues[i] = getStableRead(potPins[i]);
		lastSentData[i] = (uint8_t)constrain(map((int)filteredValues[i], 0, 4095, 0, 255), 0, 255);
	}

	setupBLE();

	Serial.println("Motor force level control ready");
	Serial.println("Type level 1 to 10 in Serial Monitor.");
	Serial.println("Or send level 1 to 10 via Bluetooth.");
	Serial.println("Level 1 = 1 N");
	Serial.println("Level 10 = 10 N");
	Serial.println("Using spring constant k = 182 N/m");
}

// ===================== Loop =====================
void loop() {
	updatePositionController();

	if (autoReturnPending && millis() >= autoReturnAtMs) {
		autoReturnPending = false;
		currentLevel = 0;
		targetCounts = zeroCounts;
		integral = 0.0f;
		prevError = targetCounts - getEncoderCount();
		prevControlTime = millis();
		holdActive = true;
		Serial.println("Auto-return to zero position.");
	}

	// Send finger data only while BLE client is connected.
	if (bleClientConnected) {
		updateAndNotifyFingerData();
		delay(10);
	}

	// Advertising watchdog: if disconnected and advertising stopped, restart it.
	if (!bleClientConnected) {
		NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
		if (adv && !adv->isAdvertising()) {
			if (millis() - lastBleDisconnectMs > 250) {
				startAdvertisingNow();
			}
		}
	}

	// Serial fallback testing for force command
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

	autoReturnPending = true;
	autoReturnAtMs = millis() + AUTO_RETURN_MS;

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
	if (!holdActive) {
		return;
	}

	unsigned long now = millis();
	float dt = (now - prevControlTime) / 1000.0f;
	if (dt <= 0.0f) {
		return;
	}

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
	int minPWM = (labs(error) > 20) ? MOVE_MIN_PWM : dynamicHoldMinPWM;

	if (pwm > 0 && pwm < minPWM) pwm = minPWM;
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

// ===================== Sensor read/notify helpers =====================
int getStableRead(int pin) {
	long sum = 0;
	for (int i = 0; i < SAMPLES; i++) {
		sum += analogRead(pin);
	}
	return (int)(sum / SAMPLES);
}

void updateAndNotifyFingerData() {
	if (!sensorChar) {
		return;
	}

	uint8_t currentFingerData[5];
	bool dataChanged = false;

	for (int i = 0; i < 5; i++) {
		int stableRaw = getStableRead(potPins[i]);

		filteredValues[i] = (smoothingFactor * stableRaw) + ((1.0f - smoothingFactor) * filteredValues[i]);

		int mappedValue = map((int)filteredValues[i], 0, 4095, 0, 255);
		mappedValue = constrain(mappedValue, 0, 255);

		if (abs(mappedValue - lastSentData[i]) > HYSTERESIS_BIT) {
			currentFingerData[i] = (uint8_t)mappedValue;
			lastSentData[i] = (uint8_t)mappedValue;
			dataChanged = true;
		} else {
			currentFingerData[i] = lastSentData[i];
		}
	}

	if (dataChanged) {
		sensorChar->setValue(currentFingerData, 5);
		sensorChar->notify();

		Serial.printf(
			"T:%d I:%d M:%d R:%d P:%d\n",
			currentFingerData[0],
			currentFingerData[1],
			currentFingerData[2],
			currentFingerData[3],
			currentFingerData[4]
		);
	}
}

// ===================== BLE setup =====================
void startAdvertisingNow() {
	NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
	if (!advertising) {
		return;
	}

	advertising->stop();
	advertising->addServiceUUID(SERVICE_UUID);
	advertising->start();

	Serial.println("BLE advertising started");
}

void setupBLE() {
	NimBLEDevice::init("SmartGloveMotor");

	// Security: bonding + MITM + secure connections
	NimBLEDevice::setSecurityAuth(true, true, true);
	NimBLEDevice::setSecurityPasskey(BLE_PASSKEY);
	NimBLEDevice::setSecurityIOCap(BLE_HS_IO_DISPLAY_ONLY);
	NimBLEDevice::setSecurityInitKey(BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID);
	NimBLEDevice::setSecurityRespKey(BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID);

	// Improve discoverability range
	NimBLEDevice::setPower(ESP_PWR_LVL_P9);

	pServer = NimBLEDevice::createServer();
	pServer->setCallbacks(new ServerCallbacks());
	pServer->advertiseOnDisconnect(true);

	NimBLEService* service = pServer->createService(SERVICE_UUID);

	// Sensor stream characteristic (read + notify)
	sensorChar = service->createCharacteristic(
		SENSOR_CHAR_UUID,
		NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY
	);
	sensorChar->setValue(lastSentData, 5);

	// Motor command characteristic (secured write)
	motorCmdChar = service->createCharacteristic(
		MOTOR_CMD_UUID,
		NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_ENC | NIMBLE_PROPERTY::WRITE_AUTHEN
	);
	motorCmdChar->setCallbacks(new MotorCommandCallbacks());

	service->start();
	startAdvertisingNow();

	Serial.println("BLE combined service started");
	Serial.print("BLE device name: ");
	Serial.println("SmartGloveMotor");
	Serial.print("BLE passkey: ");
	Serial.println(BLE_PASSKEY);
}