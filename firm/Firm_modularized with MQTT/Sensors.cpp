#include "Sensors.h"

Sensors::Sensors(const int potPins[5]) {
    for (int i = 0; i < 5; i++) {
        pins[i] = potPins[i];
    }
}

void Sensors::begin() {
    analogReadResolution(12); // 12-bit resolution (0 to 4095)
    for (int i = 0; i < 5; i++) {
        analogSetPinAttenuation(pins[i], ADC_11db);
    }
}

int Sensors::readPotValue(int index) const {
    if (index < 0 || index >= 5) {
        return 0;
    }
    int pin = pins[index];
    int val1 = analogRead(pin);
    int val2 = analogRead(pin);
    int val3 = analogRead(pin);
    return (val1 + val2 + val3) / 3;
}

void Sensors::getRawValues(int values[5]) const {
    for (int i = 0; i < 5; i++) {
        values[i] = readPotValue(i);
    }
}

void Sensors::getScaledValues(int values[5]) const {
    for (int i = 0; i < 5; i++) {
        int raw = readPotValue(i);
        int scaled = map(raw, 0, 4095, 0, 255);
        values[i] = constrain(scaled, 0, 255);
    }
}

void Sensors::getFlexPercentages(int values[5]) const {
    for (int i = 0; i < 5; i++) {
        int raw = readPotValue(i);
        int percentage = map(raw, 0, 4095, 0, 100);
        values[i] = constrain(percentage, 0, 100);
    }
}
