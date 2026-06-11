#pragma once

#include <Arduino.h>

class Sensors {
private:
    int pins[5];

public:
    // Constructor accepts array of 5 potentiometer pin numbers
    Sensors(const int potPins[5]);
    
    // Set up ADC resolution (12-bit) and attenuation (11dB)
    void begin();
    
    // Get average of three analog reads for a specific potentiometer index (0 to 4)
    int readPotValue(int index) const;
    
    // Fills array with raw ADC values (0-4095)
    void getRawValues(int values[5]) const;
    
    // Fills array with scaled values (0-255) for BLE notifications
    void getScaledValues(int values[5]) const;
    
    // Fills array with percentages (0-100) for MQTT dashboard payload
    void getFlexPercentages(int values[5]) const;
};
