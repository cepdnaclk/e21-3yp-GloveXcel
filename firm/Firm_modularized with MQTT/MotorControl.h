#pragma once

#include <Arduino.h>

class MotorControl {
private:
    // Pin assignments
    int pinAin1;
    int pinAin2;
    int pinPwma;
    int pinStby;
    int pinEncC1;
    int pinEncC2;

    // Control and safety state
    bool holdEnabled;
    int currentLevel;
    long holdTargetTicks;
    void (*hapticsCallback)();

    // Private helpers
    void motorForwardRaw(int speedValue);
    void motorReverseRaw(int speedValue);
    void motorIncreaseForce(int speedValue);
    void motorDecreaseForce(int speedValue);
    
    double forceToExtensionM(double forceN);
    double extensionToThetaRad(double extensionM);
    double radiansToDegrees(double radians);
    long degreesToTicks(double degrees);
    long levelToTargetTicks(int level);
    
    void printLevelCalculation(int level);
    void moveToTargetTicks(long targetTicks);
    void holdPositionControl();

public:
    MotorControl(int ain1, int ain2, int pwma, int stby, int encC1, int encC2);
    
    // Initialize pins and interrupt configuration
    void begin();
    
    // Non-blocking update cycle to run the hold control loop
    void update();
    
    // Move to a target force level (0-10) and enable holding (for level > 0)
    void moveToLevel(int level);
    
    // Safely reset/zero the encoder position and clear motor state
    void zeroPositionAndRelease();
    
    // Release the motor (disables hold and coasts)
    void releaseMotor();
    
    // Safety stop modes
    void motorBrake();
    void motorStopCoast();
    
    // Position getters
    long getRawTicks();
    long getExtensionTicks();
    int getCurrentLevel() const;
    bool isHoldEnabled() const;
    long getHoldTargetTicks() const;

    // Register haptics callback to run update during blocking moves
    void setHapticsCallback(void (*callback)());

    void zeroEncoder();
};
