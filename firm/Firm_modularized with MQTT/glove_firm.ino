#include "Config.h"
#include "Haptics.h"
#include "MotorControl.h"
#include "Sensors.h"
#include "NetworkManager.h"
#include "BleManager.h"

// =====================================================
// Instantiate global objects
// =====================================================
Haptics hapticFeedback(PIN_VIBRATION_MOTOR, VIBRATION_PWM_FREQ, VIBRATION_PWM_RESOLUTION, VIBRATION_INTERVAL);
MotorControl forceMotor(PIN_AIN1, PIN_AIN2, PIN_PWMA, PIN_STBY, PIN_ENC_C1, PIN_ENC_C2);
Sensors sensors(POT_PINS);

GloveNetworkManager networkManager(
    WIFI_SSID,
    WIFI_PASSWORD,
    MQTT_HOST,
    MQTT_PORT,
    MQTT_USERNAME,
    MQTT_PASSWORD,
    MQTT_TOPIC,
    MQTT_STATUS_TOPIC,
    MQTT_DEVICE_ID,
    MQTT_PUBLISH_INTERVAL,
    WIFI_RECONNECT_INTERVAL
);

BleManager bleManager(
    BLE_DEVICE_NAME,
    BLE_SERVICE_UUID,
    BLE_POT_CHARACTERISTIC,
    BLE_MOTOR_CHARACTERISTIC
);

// Timer for non-blocking serial and BLE updates
unsigned long previousPrintTime = 0;

// Forward declarations for local helpers
void printCurrentPosition();
void processSerialCommand(String input);

// =====================================================
// Haptics callback wrapper
// Passed to forceMotor to update vibration during travels
// =====================================================
void updateHapticsWrapper() {
    hapticFeedback.update();
}

// =====================================================
// Setup
// =====================================================
void setup() {
    Serial.begin(115200);
    delay(1000);

    // Start haptics first
    hapticFeedback.begin();

    // Attach haptics callback to motor control before starting it
    forceMotor.setHapticsCallback(updateHapticsWrapper);
    forceMotor.begin();

    // Start sensors and communication channels
    sensors.begin();
    bleManager.begin();
    networkManager.begin();

    // Display boot messages
    Serial.println();
    Serial.println("ESP32 Combined System Started");
    Serial.println("--------------------------------------------");
    Serial.println("Function 1: TB6612FNG N20 Force Level Hold Control");
    Serial.println("Function 2: 5 Potentiometer Reader");
    Serial.println("Function 3: Vibration Motor PWM Cycle");
    Serial.println("Function 4: Frontend BLE Web Bluetooth Control");
    Serial.println("Function 5: MQTT Live Potentiometer/Finger Data Publisher");
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
    Serial.print("GPIO");
    Serial.println(PIN_VIBRATION_MOTOR);
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
    Serial.println("MQTT:");
    Serial.print("Host: ");
    Serial.println(MQTT_HOST);
    Serial.print("Topic: ");
    Serial.println(MQTT_TOPIC);
    Serial.println();
    Serial.println("IMPORTANT:");
    Serial.println("1. Keep spring at 0 N starting position.");
    Serial.println("2. For Serial Monitor test, type Z to zero encoder.");
    Serial.println("3. For frontend test, power up ESP32 at the 0 N starting position.");
    Serial.println("4. Then select motor level 0 to 10 from frontend.");
    Serial.println();
}

// =====================================================
// Loop
// =====================================================
void loop() {
    // 1. Run low-level controller tasks
    forceMotor.update();
    hapticFeedback.update();
    networkManager.update();

    // 2. Read and map flex sensor values
    int rawValues[5];
    sensors.getRawValues(rawValues);

    // 3. Print values and notify BLE client on printInterval timer
    unsigned long currentTime = millis();

    if (currentTime - previousPrintTime >= PRINT_INTERVAL) {
        previousPrintTime = currentTime;

        for (int i = 0; i < 5; i++) {
            Serial.print("GPIO");
            Serial.print(POT_PINS[i]);
            Serial.print(" = ");
            Serial.print(rawValues[i]);

            if (i < 4) {
                Serial.print(" | ");
            }
        }

        Serial.println();

        bleManager.sendPotValues(rawValues);
    }

    // 4. Publish values to MQTT cloud dashboard on publishInterval timer
    int flexValues[5];
    sensors.getFlexPercentages(flexValues);

    networkManager.publishPotValues(
        rawValues,
        flexValues,
        forceMotor.getCurrentLevel(),
        forceMotor.isHoldEnabled()
    );

    // 5. Check and handle incoming frontend BLE motor command
    int bleLevel = 0;

    if (bleManager.fetchMotorCommand(bleLevel)) {
        forceMotor.moveToLevel(bleLevel);
    }

    // 6. Check and handle incoming Serial Monitor command
    if (Serial.available() > 0) {
        String input = Serial.readStringUntil('\n');
        processSerialCommand(input);
    }
}

// =====================================================
// Print current motor position details to Serial
// =====================================================
void printCurrentPosition() {
    long rawTicks = forceMotor.getRawTicks();
    long extensionTicks = forceMotor.getExtensionTicks();

    Serial.println();

    Serial.print("Current level command: ");
    Serial.println(forceMotor.getCurrentLevel());

    Serial.print("Raw encoder ticks: ");
    Serial.println(rawTicks);

    Serial.print("Extension ticks: ");
    Serial.println(extensionTicks);

    Serial.print("Hold target ticks: ");
    Serial.println(forceMotor.getHoldTargetTicks());

    Serial.print("Hold enabled: ");

    if (forceMotor.isHoldEnabled()) {
        Serial.println("YES");
    } else {
        Serial.println("NO");
    }

    Serial.print("Vibration state: ");

    int vibState = hapticFeedback.getVibrationState();

    if (vibState == 0) {
        Serial.println("Medium");
    } else if (vibState == 1) {
        Serial.println("Strong");
    } else {
        Serial.println("OFF");
    }
}

// =====================================================
// Process Serial commands (Z, P, R, 0-10)
// =====================================================
void processSerialCommand(String input) {
    input.trim();

    if (input.length() == 0) {
        return;
    }

    if (input == "Z" || input == "z") {
        forceMotor.zeroPositionAndRelease();

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
        forceMotor.releaseMotor();

        Serial.println();
        Serial.println("Motor released. Hold disabled.");

        return;
    }

    int level = input.toInt();
    forceMotor.moveToLevel(level);
}