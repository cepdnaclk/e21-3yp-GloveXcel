#pragma once

#include <Arduino.h>

class Haptics {
private:
    int pin;
    int pwmFreq;
    int pwmResolution;
    unsigned long vibrationInterval;
    unsigned long previousVibrationTime;
    int vibrationState; // 0 = Medium, 1 = Strong, 2 = OFF

    void applyVibrationState();

public:
    Haptics(int motorPin, int freq = 5000, int resolution = 8, unsigned long interval = 2000);
    
    // Initialize the PWM and set initial state
    void begin();
    
    // Non-blocking update cycle to be called in loops
    void update();

    // Get current state: 0 (Medium), 1 (Strong), 2 (OFF)
    int getVibrationState() const;
};
