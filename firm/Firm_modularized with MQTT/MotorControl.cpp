#include "MotorControl.h"
#include "Config.h"

// File-local static state for ISR use
namespace {
    volatile long rawEncoderTicks = 0;
    volatile int lastEncoded = 0;
    int isrPinC1 = 0;
    int isrPinC2 = 0;

    void IRAM_ATTR updateEncoder() {
        int MSB = digitalRead(isrPinC1);
        int LSB = digitalRead(isrPinC2);

        int encoded = (MSB << 1) | LSB;
        int sum = (lastEncoded << 2) | encoded;

        if (sum == 0b1101 || sum == 0b0100 || sum == 0b0010 || sum == 0b1011) {
            rawEncoderTicks++;
        }
        if (sum == 0b1110 || sum == 0b0111 || sum == 0b0001 || sum == 0b1000) {
            rawEncoderTicks--;
        }
        lastEncoded = encoded;
    }
}

MotorControl::MotorControl(int ain1, int ain2, int pwma, int stby, int encC1, int encC2) {
    pinAin1 = ain1;
    pinAin2 = ain2;
    pinPwma = pwma;
    pinStby = stby;
    pinEncC1 = encC1;
    pinEncC2 = encC2;
    holdEnabled = false;
    currentLevel = 0;
    holdTargetTicks = 0;
    hapticsCallback = nullptr;
}

void MotorControl::begin() {
    pinMode(pinAin1, OUTPUT);
    pinMode(pinAin2, OUTPUT);
    pinMode(pinStby, OUTPUT);

    pinMode(pinEncC1, INPUT_PULLUP);
    pinMode(pinEncC2, INPUT_PULLUP);

    // Bind local pins for ISR access
    isrPinC1 = pinEncC1;
    isrPinC2 = pinEncC2;

    // Read initial encoder state
    int MSB = digitalRead(pinEncC1);
    int LSB = digitalRead(pinEncC2);
    lastEncoded = (MSB << 1) | LSB;

    // Attach encoder interrupts
    attachInterrupt(digitalPinToInterrupt(pinEncC1), updateEncoder, CHANGE);
    attachInterrupt(digitalPinToInterrupt(pinEncC2), updateEncoder, CHANGE);

    // Configure PWM for motor speed
    ledcAttach(pinPwma, PWM_FREQ, PWM_RESOLUTION);

    digitalWrite(pinStby, HIGH);
    motorStopCoast();
}

void MotorControl::update() {
    holdPositionControl();
}

void MotorControl::setHapticsCallback(void (*callback)()) {
    hapticsCallback = callback;
}

long MotorControl::getRawTicks() {
    noInterrupts();
    long ticks = rawEncoderTicks;
    interrupts();
    return ticks;
}

long MotorControl::getExtensionTicks() {
    long ticks = getRawTicks();
    if (ticks < 0) {
        ticks = -ticks;
    }
    return ticks;
}

void MotorControl::zeroEncoder() {
    noInterrupts();
    rawEncoderTicks = 0;
    interrupts();
}

void MotorControl::zeroPositionAndRelease() {
    holdEnabled = false;
    zeroEncoder();
    motorStopCoast();
    currentLevel = 0;
    holdTargetTicks = 0;
}

void MotorControl::releaseMotor() {
    holdEnabled = false;
    motorStopCoast();
}

void MotorControl::motorBrake() {
    ledcWrite(pinPwma, 0);
    digitalWrite(pinStby, HIGH);
    digitalWrite(pinAin1, HIGH);
    digitalWrite(pinAin2, HIGH);
}

void MotorControl::motorStopCoast() {
    ledcWrite(pinPwma, 0);
    digitalWrite(pinAin1, LOW);
    digitalWrite(pinAin2, LOW);
}

void MotorControl::motorForwardRaw(int speedValue) {
    speedValue = constrain(speedValue, 0, 255);
    digitalWrite(pinStby, HIGH);
    digitalWrite(pinAin1, HIGH);
    digitalWrite(pinAin2, LOW);
    ledcWrite(pinPwma, speedValue);
}

void MotorControl::motorReverseRaw(int speedValue) {
    speedValue = constrain(speedValue, 0, 255);
    digitalWrite(pinStby, HIGH);
    digitalWrite(pinAin1, LOW);
    digitalWrite(pinAin2, HIGH);
    ledcWrite(pinPwma, speedValue);
}

void MotorControl::motorIncreaseForce(int speedValue) {
    if (!MOTOR_DIR_INVERT) {
        motorForwardRaw(speedValue);
    } else {
        motorReverseRaw(speedValue);
    }
}

void MotorControl::motorDecreaseForce(int speedValue) {
    if (!MOTOR_DIR_INVERT) {
        motorReverseRaw(speedValue);
    } else {
        motorForwardRaw(speedValue);
    }
}

double MotorControl::forceToExtensionM(double forceN) {
    return forceN / SPRING_K;
}

double MotorControl::extensionToThetaRad(double extensionM) {
    return extensionM / SPOOL_RADIUS_M;
}

double MotorControl::radiansToDegrees(double radians) {
    return radians * 180.0 / PI;
}

long MotorControl::degreesToTicks(double degrees) {
    double revolutions = degrees / 360.0;
    double ticks = revolutions * TICKS_PER_OUTPUT_REV;
    return lround(ticks);
}

long MotorControl::levelToTargetTicks(int level) {
    double forceN = (double)level;
    double extensionM = forceToExtensionM(forceN);
    double thetaRad = extensionToThetaRad(extensionM);
    double degrees = radiansToDegrees(thetaRad);
    return degreesToTicks(degrees);
}

void MotorControl::printLevelCalculation(int level) {
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

void MotorControl::moveToTargetTicks(long targetTicks) {
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

        // Stuck safety
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

        // Keep vibration motor update cycle running during motor transition
        if (hapticsCallback != nullptr) {
            hapticsCallback();
        }
    }

    motorBrake();
}

void MotorControl::holdPositionControl() {
    if (!holdEnabled) {
        return;
    }

    long currentTicks = getExtensionTicks();
    long errorTicks = holdTargetTicks - currentTicks;
    long absError = abs(errorTicks);

    if (absError <= HOLD_TOLERANCE_TICKS) {
        motorBrake();
    } else if (errorTicks > 0) {
        motorIncreaseForce(HOLD_CORRECT_SPEED);
    } else {
        motorDecreaseForce(HOLD_CORRECT_SPEED);
    }
}

void MotorControl::moveToLevel(int level) {
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
    Serial.println(getRawTicks());
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
    Serial.println(getRawTicks());
    Serial.print("Final extension ticks: ");
    Serial.println(getExtensionTicks());
    Serial.println();
    Serial.println("Enter next level:");
}

int MotorControl::getCurrentLevel() const {
    return currentLevel;
}

bool MotorControl::isHoldEnabled() const {
    return holdEnabled;
}

long MotorControl::getHoldTargetTicks() const {
    return holdTargetTicks;
}
