# GloveXcel Firmware — Potentiometer Finger Reading

This firmware reads analog values from five potentiometers connected to an ESP32.  
Each potentiometer represents one finger of the smart glove.

The purpose of this part of the firmware is to collect stable finger sensor readings, smooth the values, and convert them into a simple `0–255` range.

---

## Finger Sensors

The glove uses five potentiometers:

| Finger | ESP32 Pin |
|---|---|
| Thumb | GPIO 39 |
| Index | GPIO 32 |
| Middle | GPIO 34 |
| Ring | GPIO 35 |
| Pinky | GPIO 36 |

In the code:

const int potPins[] = {39, 32, 34, 35, 36};

Purpose

This makes finger movement values smoother by reducing small electrical noise.

Stable Reading Function

To reduce noise and sudden spikes, each potentiometer is read multiple times.


Initial Sensor Setup

When the ESP32 starts, it reads the first stable value from each potentiometer:


##Smoothing Filter##
A lower value like 0.05 means:

smoother readings
less noise
slightly slower response

A higher value means:

faster response
more sensitive readings
more noise