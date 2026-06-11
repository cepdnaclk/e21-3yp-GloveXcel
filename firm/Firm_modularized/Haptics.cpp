#include "Haptics.h"

Haptics::Haptics(int motorPin, int freq, int resolution, unsigned long interval) {
    pin = motorPin;
    pwmFreq = freq;
    pwmResolution = resolution;
    vibrationInterval = interval;
    previousVibrationTime = 0;
    vibrationState = 0;
}

void Haptics::begin() {
    ledcAttach(pin, pwmFreq, pwmResolution);
    vibrationState = 0;
    previousVibrationTime = millis();
    applyVibrationState();
}

void Haptics::applyVibrationState() {
    if (vibrationState == 0) {
        ledcWrite(pin, 120); // Medium vibration
    } else if (vibrationState == 1) {
        ledcWrite(pin, 255); // Strong vibration
    } else {
        ledcWrite(pin, 0);   // OFF
    }
}

void Haptics::update() {
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

int Haptics::getVibrationState() const {
    return vibrationState;
}
