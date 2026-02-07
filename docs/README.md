---
layout: home
permalink: index.html
repository-name: e21-3yp-GloveXcel
title: GloveXcel: Smart Rehabilitation at Home
---

# RehabGlove: Smart Rehabilitation at Home

---

## Team
- E/21/006, Abeykoon A.M.U.I.B., [e21006@eng.pdn.ac.lk](mailto:e21006@eng.pdn.ac.lk)
- E/21/007, Abeynayake A.G.C.D., [e21007@eng.pdn.ac.lk](mailto:e21007@eng.pdn.ac.lk)
- E/21/124, Ekanayake E.M.D.A., [e21124@eng.pdn.ac.lk](mailto:e21124@eng.pdn.ac.lk)
- E/21/410, THILAKARATHNE L.R.O.S., [e21410@eng.pdn.ac.lk](mailto:e21410@eng.pdn.ac.lk)

<!-- Image (photo/drawing of the final hardware) should be here -->

<!-- This is a sample image, to show how to add images to your page. To learn more options, please refer [this](https://projects.ce.pdn.ac.lk/docs/faq/how-to-add-an-image/) -->

<!-- ![Sample Image](./images/sample.png) -->

#### Table of Contents
1. [Introduction](#introduction)
2. [Solution Architecture](#solution-architecture)
3. [Hardware & Software Designs](#hardware-and-software-designs)
4. [Testing](#testing)
5. [Detailed Budget](#detailed-budget)
6. [Conclusion](#conclusion)
7. [Links](#links)

## Introduction

### **The Real World Problem**
Rehabilitation for conditions like stroke, arthritis, and post-surgery often comes with challenges such as:
- **Limited Access to Therapy**: Patients struggle with traveling to therapy centers, especially if they have mobility issues or live in remote areas.
- **Lack of Real-Time Feedback**: Home-based rehabilitation often lacks the instant feedback that helps ensure exercises are performed correctly.
- **Inconsistent Tracking**: It’s hard to measure and adjust therapy plans when progress isn’t tracked effectively.

### **The Solution**
**RehabGlove** provides a wearable solution that uses motion sensors and real-time feedback to guide patients through rehabilitation exercises at home. Key features include:
- **Motion Tracking**: Accurate tracking of hand and finger movements using embedded sensors.
- **Real-Time Feedback**: Instant notifications through vibration motors when movements deviate from prescribed therapy.
- **Remote Therapist Monitoring**: Therapists can monitor progress and adjust therapy via a mobile app.
- **Self-Guided Mode**: Patients can follow pre-programmed exercises and upload progress data for later review by their therapists.

### **Impact**
RehabGlove empowers patients to carry out rehabilitation exercises effectively at home while ensuring real-time feedback and progress tracking. It reduces the need for frequent clinic visits, making rehabilitation more accessible and efficient.

## Solution Architecture

### **High-Level Diagram**
[Insert Diagram of the Solution Architecture]

The system consists of several components working in sync:
- **Sensors**: Potentiometers and accelerometers to track finger movements.
- **Microcontroller**: An ESP32 to process data and communicate with the mobile app.
- **Feedback Mechanism**: Vibration motors to provide real-time corrections to the patient.

## Hardware and Software Designs

### **Hardware Components**
- **Sensor Array**: Potentiometers, strain gauges, and accelerometers to measure joint movements.
- **Control Unit**: ESP32 microcontroller for data processing and communication.
- **Feedback System**: Vibration motors for haptic feedback to the patient.

### **Software**
- **Mobile App**: Displays 3D hand models, tracks progress, and allows remote therapist adjustments.
- **Cloud Storage**: Secure cloud storage for session data and progress tracking.

## Testing

### **Hardware Testing**
- Prototype testing for sensor accuracy, feedback response, and overall glove comfort.
- Real-world testing with patients to assess the effectiveness of the real-time feedback.

### **Software Testing**
- Testing of mobile app functionality, including progress tracking and remote therapist monitoring.
- Data synchronization between mobile app and cloud.

## Detailed Budget

| **Item**                | **Quantity** | **Unit Cost** | **Total**     |
|-------------------------|--------------|---------------|---------------|
| Potentiometers          | 4            | 500 LKR       | 2000 LKR      |
| Strain Gauges           | 4            | 400 LKR       | 1600 LKR      |
| ESP32 Microcontroller   | 1            | 1500 LKR      | 1500 LKR      |
| Vibration Motors        | 4            | 500 LKR       | 2000 LKR      |
| Rechargeable Batteries  | 2            | 600 LKR       | 1200 LKR      |
| Development & Testing   | -            | -             | 5000 LKR      |
| **Total Cost**          |              |               | **14,300 LKR**|

## Conclusion

The **RehabGlove** system offers a convenient and effective solution for home-based rehabilitation. With real-time feedback, progress tracking, and remote therapist monitoring, it enhances recovery outcomes and makes rehabilitation more accessible. Future developments will expand the range of exercises and integrate additional tracking features for more comprehensive recovery.

## Links

- [Project Repository](https://github.com/cepdnaclk/{{ page.repository-name }}){:target="_blank"}
- [Project Page](https://cepdnaclk.github.io/{{ page.repository-name }}){:target="_blank"}
- [Department of Computer Engineering](http://www.ce.pdn.ac.lk/)
- [University of Peradeniya](https://eng.pdn.ac.lk/)

[//]: # (Please refer this to learn more about Markdown syntax)
[//]: # (https://github.com/adam-p/markdown-here/wiki/Markdown-Cheatsheet)
