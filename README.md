# RehabGlove: Home-Based Rehabilitation System

RehabGlove is an innovative wearable rehabilitation system designed to provide effective, home-based therapy for patients recovering from conditions like stroke, arthritis, and post-surgery. By using advanced motion sensors and real-time feedback, RehabGlove helps ensure proper exercise execution and provides valuable progress tracking, all from the comfort of the patient’s home.

**Key Features**
- **Real-Time Feedback**: Haptic feedback is provided to the patient when movements deviate from the prescribed therapy.
- **Therapist Interaction**: Therapists can monitor patient progress remotely in real-time or through self-guided sessions.
- **Self-Guided Sessions**: Pre-programmed exercises allow patients to independently follow therapy with data uploaded for later review by the therapist.
- **Progress Tracking**: Continuous tracking of finger movements, exercise completion, and improvements over time.

**Hardware Architecture**
The RehabGlove system is built around several key hardware components that ensure accurate movement tracking and responsive feedback:

| **Unit**               | **Hardware Components**                        | **Primary Function**                                               |
|------------------------|------------------------------------------------|--------------------------------------------------------------------|
| **Unit A: Sensor Array**| Potentiometers, strain gauges, accelerometers  | Tracks finger and hand joint movements for accurate data capture.  |
| **Unit B: Feedback Hub**| Vibration motors                               | Provides haptic feedback to the patient in real-time.              |
| **Unit C: Control Hub** | ESP32 microcontroller                          | Processes data from sensors, provides control, and communicates with mobile app/cloud. |
| **Unit D: Resistive Force** | Encoder motor, spring mechanism               | Applies resistive force to simulate therapeutic resistance.        |

**Mobile App & Cloud Connectivity**
- **Wireless Dashboard**: All progress, feedback, and exercise data is streamed in real-time to a smartphone app for both patient and therapist.
- **Cloud Sync**: Session data is logged locally, then synchronized to the cloud for remote monitoring and analysis.
- **Patient & Therapist Interaction**: Both parties can interact through the mobile app to adjust therapy parameters, monitor progress, and review reports.

🛠️ **Installation & Wiring**
The system utilizes a multi-core, shielded communication backbone (Power, Ground, CAN_H, CAN_L) to connect all units seamlessly.

Developed as a 3rd Year Undergraduate Project in Computer Engineering.
