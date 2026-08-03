# GloveXcel

### Smart, visual, home-based hand rehabilitation

![GloveXcel rehabilitation glove prototype](website/Assets/glove.png)

GloveXcel is a wearable hand-rehabilitation system that helps patients complete guided exercises at home while doctors configure exercises and review progress remotely. Five finger sensors are read by an ESP32 and streamed to a browser over Bluetooth Low Energy (BLE). The application converts those readings into calibrated movement, displays a slider for every finger, animates a 3D hand, counts repetitions, and stores session analytics.

> [!IMPORTANT]
> GloveXcel uses **visual feedback, not haptic feedback**. The patient follows five live movement sliders—Thumb, Index, Middle, Ring, and Pinky—together with the 3D hand model. Vibration or haptic features found in older experimental firmware are not part of the current system design.

![GloveXcel patient and doctor interfaces](website/Assets/screens.png)

## Contents

- [How it works](#how-it-works)
- [System architecture](#system-architecture)
- [Visual finger feedback](#visual-finger-feedback)
- [Features](#features)
- [Hardware and software](#hardware-and-software)
- [Getting started](#getting-started)
- [Using GloveXcel](#using-glovexcel)
- [API overview](#api-overview)
- [Repository structure](#repository-structure)
- [Testing and safety](#testing-and-safety)
- [Team](#team)

## How it works

1. Five sensors measure the movement of the patient's thumb and four fingers.
2. The ESP32 sends each sample to the browser as a five-value BLE packet.
3. Patient-specific minimum and maximum calibration values convert raw readings into normalized movement and joint-angle values.
4. Five visual sliders and a 3D hand update in real time.
5. Exercise targets show progress and support automatic repetition detection.
6. Calibration, exercise, force, session, and analytics data are stored for the doctor to review.

```mermaid
flowchart LR
    A[Five finger sensors] --> B[ESP32]
    B -->|5-value BLE packet| C[Web Bluetooth client]
    C --> D[Patient calibration]
    D --> E[Five live movement sliders]
    D --> F[3D hand model]
    D --> G[Target and repetition logic]
    G --> H[Session analytics]
    H --> I[Doctor progress dashboard]
```

## System architecture

```mermaid
flowchart TB
    subgraph Glove[Wearable glove]
        Sensors[Thumb + four finger sensors]
        ESP32[ESP32 BLE controller]
        Resistance[Motor, encoder, and spring resistance unit]
        Sensors --> ESP32
        ESP32 --> Resistance
    end

    subgraph Browser[Browser applications]
        Patient[Patient dashboard]
        Doctor[Doctor dashboard]
        Admin[Admin portal]
        Visual[Visual sliders + 3D hand]
        Patient --> Visual
    end

    subgraph Services[Application services]
        API[Node.js + Express API]
        MQTT[MQTT live data channel]
        Postgres[(PostgreSQL / Supabase)]
        Mongo[(MongoDB)]
    end

    ESP32 <-->|Web Bluetooth| Patient
    Patient <-->|Live sensor sharing| MQTT
    MQTT -->|Remote monitoring| Doctor
    Patient <-->|JSON API| API
    Doctor <-->|JSON API| API
    Admin <-->|JSON API| API
    API --> Postgres
    API --> Mongo
```

PostgreSQL/Supabase stores relational data such as users, hospitals, doctor–patient links, exercises, plans, and sessions. MongoDB stores sensor-oriented documents such as calibration records, force settings, exercise maxima, and live/preloaded analytics. Run the backend with `DB_CLIENT=both` for the complete application.

## Visual finger feedback

The visual feedback system replaces vibration-based guidance.

| Visual channel | What it shows |
|---|---|
| Thumb slider | Current calibrated thumb movement against its target |
| Index slider | Current calibrated index-finger movement against its target |
| Middle slider | Current calibrated middle-finger movement against its target |
| Ring slider | Current calibrated ring-finger movement against its target |
| Pinky slider | Current calibrated little-finger movement against its target |
| Overall indicator | Whether the active fingers are approaching or meeting the selected target |
| 3D hand | A live digital twin of the measured hand pose |

```mermaid
sequenceDiagram
    participant S as Finger sensors
    participant E as ESP32
    participant B as Patient browser
    participant V as Sliders and 3D hand
    participant A as Analytics API

    S->>E: Read five finger positions
    E->>B: Notify five-value BLE packet
    B->>B: Apply patient min/max calibration
    B->>V: Update each finger independently
    B->>B: Compare movement with exercise targets
    B->>A: Save repetition and peak-angle results
```

The sliders provide continuous, finger-by-finger feedback rather than a single pass/fail signal. This makes it clear which finger needs more flexion or extension during an exercise.

## Features

### Patient application

- Patient signup and login, including optional Google authentication through Supabase Auth.
- Doctor discovery and doctor–patient connection requests.
- BLE connection, remembered-device reconnection, notifications, and read-polling fallback.
- Separate minimum and maximum calibration for all five fingers.
- Live raw readings, calibrated angles, five movement sliders, target matching, and overall status.
- Real-time 3D hand visualization using Three.js and a GLB hand model.
- Preloaded exercises and doctor-created live exercises.
- Automatic repetition detection, repetition/set status, and maximum-angle capture.
- Saved session history and analytics.
- Adjustable resistive force levels from 1 to 10 when motor control is available.
- Optional live sensor sharing to a doctor through MQTT.
- Cross-tab glove-state sharing through the browser `BroadcastChannel` API.

### Doctor application

- Signup, login, profile viewing/editing, and administrator approval workflow.
- Patient request approval/rejection and managed patient list.
- Doctor-glove calibration for reference movements.
- Patient rehabilitation setup and selection.
- Preloaded exercise builder with description, dates, repetitions, sets, force level, and five finger targets.
- Live exercise creation from target angles or a captured glove pose.
- Live patient monitoring through MQTT with raw values, converted angles, message rate, and optional 3D model control.
- Compliance visualization, repetition peak detection, and resistive-force configuration.
- Per-finger live/preloaded progress charts and analytics history.

### Administrator and platform

- Administrator signup/login, hospital registration, doctor-request review, and doctor approval.
- Role-aware local authentication with hashed passwords and JWT sessions.
- Optional Google sign-in for doctors and patients.
- REST APIs for users, calibration, glove data, forces, exercises, plans, sessions, and analytics.
- Hybrid PostgreSQL/Supabase and MongoDB persistence.
- Responsive dashboards, a separate public project website, and Jest backend tests.

## Hardware and software

### Hardware

| Component | Purpose |
|---|---|
| ESP32 | Reads sensors, exposes BLE services, and accepts resistance commands |
| Five finger position sensors | Measure Thumb, Index, Middle, Ring, and Pinky movement |
| TB6612FNG motor driver | Drives the resistance motor |
| N20 encoder motor | Adjusts and holds the selected resistance position |
| Spring mechanism | Produces controlled mechanical resistance |
| Power supply and glove assembly | Powers and supports the wearable electronics |

The PCB reference is available at [`firm/PCB.png`](firm/PCB.png).

### Software

| Layer | Technology |
|---|---|
| Firmware | ESP32 Arduino / C++, NimBLE |
| Frontend | HTML, CSS, JavaScript, Web Bluetooth |
| 3D visualization | Three.js, GLTFLoader, GLB hand model |
| Live remote stream | MQTT over secure WebSockets |
| Backend | Node.js, Express |
| Relational data | PostgreSQL / Supabase |
| Sensor and analytics data | MongoDB / Mongoose |
| Authentication | JWT, bcrypt, optional Supabase Google OAuth |
| Tests | Jest |

## Getting started

### Prerequisites

- Node.js 18 or later and npm
- Python 3 or another static HTTP server
- PostgreSQL/Supabase and MongoDB databases
- Chrome or Microsoft Edge for Web Bluetooth
- ESP32 glove hardware for real sensor input

Web Bluetooth requires a secure context. Use `localhost` during development or HTTPS in deployment; do not open the frontend using `file://`.

### 1. Clone the repository

```bash
git clone https://github.com/cepdnaclk/e21-3yp-GloveXcel.git
cd e21-3yp-GloveXcel
```

### 2. Prepare the databases

Create a PostgreSQL database and run [`docs/database_schema_v2.sql`](docs/database_schema_v2.sql). Add at least one hospital before creating doctor or patient accounts, either in SQL or through `POST /api/auth/hospitals`. Create a MongoDB database for calibration, force, sensor, and analytics documents.

### 3. Configure the backend

Create `back/.env`:

```env
PORT=3000
DB_CLIENT=both
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=7d

MONGO_URI=mongodb+srv://USER:PASSWORD@HOST/glovexcel

POSTGRES_HOST=your-project-host
POSTGRES_PORT=5432
POSTGRES_USER=your-database-user
POSTGRES_PASSWORD=your-database-password
POSTGRES_DATABASE=postgres
POSTGRES_SSL=true
POSTGRES_SSL_REJECT_UNAUTHORIZED=false

# Optional Google login
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

The server also reads the project-root `env` file, but `back/.env` is recommended for local secrets. Never commit real credentials.

### 4. Start the API and frontend

In the first terminal:

```bash
cd back
npm install
npm start
```

In a second terminal, from the repository root:

```bash
cd front
python -m http.server 5500
```

Open `http://localhost:5500`. The API uses `http://localhost:3000` by default. For a remote API, set the base URL in the browser console and reload:

```js
localStorage.setItem('apiBaseUrl', 'https://your-api.example.com');
```

### 5. Connect the glove

1. Power the ESP32 glove and confirm that it is advertising BLE.
2. Open the patient dashboard in Chrome or Edge.
3. Select **Connect Glove** and choose the ESP32 device.
4. Complete minimum and maximum patient calibration.
5. Open a live or preloaded exercise and follow the five movement sliders.

The BLE interface uses a sensor characteristic for five-byte finger packets and an optional motor characteristic for resistance commands. UUIDs in [`front/js/bleGloveClient.js`](front/js/bleGloveClient.js) must match the ESP32 firmware.

## Using GloveXcel

```mermaid
flowchart TD
    A[Admin registers hospital and approves doctor] --> B[Doctor and patient accounts]
    B --> C[Patient requests doctor connection]
    C --> D[Doctor approves patient]
    D --> E[Patient and doctor calibrate their gloves]
    E --> F[Doctor creates exercise and finger targets]
    F --> G[Patient selects exercise and connects glove]
    G --> H[Five sliders and 3D hand show movement]
    H --> I[Repetitions and peak angles are recorded]
    I --> J[Doctor reviews progress and adjusts the plan]
```

### Calibration

Calibration records the relaxed and fully moved value for each finger. These personal limits are required because sensor placement and range differ between users. Complete calibration before relying on angles, target matching, or repetition counts.

### Preloaded session

A doctor creates an exercise with five target angles, repetition/set goals, dates, and resistance. The patient selects the exercise and follows the on-screen movement. The application tracks repetitions and saves maximum achieved angles.

### Live session and progress

Every BLE packet is mapped directly to the five sliders and 3D hand. A manual reference or doctor-created exercise can be selected for comparison. With live sharing enabled, the doctor subscribes to the patient's MQTT topic. Live and preloaded analytics store the exercise, repetition, force level, and maximum angle reached by each finger for the progress charts.

## API overview

All API routes use the `/api` prefix.

| Area | Main routes | Purpose |
|---|---|---|
| Authentication | `/api/auth/*` | Accounts, JWT/Google login, hospitals, profiles, and approvals |
| Doctor–patient channels | `/api/channel-requests/*` | Requests, decisions, and patient management |
| Calibration | `/api/doctor-cal/*`, `/api/patient-cal/*` | Five-finger minimum/maximum values |
| Glove data and force | `/api/data/*`, `/api/forces/*` | Sensor packets and resistance levels |
| Exercises | `/api/exercises/*`, `/api/exercise-max/*`, `/api/live-exercises/*` | Preloaded/live exercises and targets |
| Plans and sessions | `/api/therapy-plans/*`, `/api/therapy-sessions/*` | Assignments and session history |
| Analytics | `/api/live-analytics/*`, `/api/preloaded-analytics/*` | Per-repetition finger results |

See [`back/readme.md`](back/readme.md) for the expanded endpoint reference.

## Repository structure

```text
e21-3yp-GloveXcel/
├── back/       Node.js API, models, controllers, routes, and tests
├── front/      Login, admin, patient, and doctor browser applications
├── firm/       ESP32 firmware experiments, structured code, and PCB image
├── website/    Public project landing page
├── docs/       Project metadata and PostgreSQL schema
├── Assets/     Shared photographs and branding assets
└── README.md   Main project documentation
```

Some firmware files preserve earlier vibration experiments as development history. The BLE sensing, visual sliders, 3D hand, analytics, and resistive-force workflow define the current system.

## Testing and safety

Run the backend tests from `back`:

```bash
npm test
```

The Jest suites cover authentication, force handling, exercise creation, live exercises, and live/preloaded analytics. For an end-to-end check, verify all login roles, calibrate all fingers, confirm each slider moves independently, complete a repetition, review it in the doctor dashboard, test resistance control, and confirm MQTT live sharing.

GloveXcel is a third-year undergraduate engineering research prototype, not a certified medical device. Rehabilitation targets and resistance should be selected under qualified clinical supervision. The motor mechanism should have suitable physical limits and an emergency release.

## Team

Department of Computer Engineering, Faculty of Engineering, University of Peradeniya.

| Registration number | Name | Email |
|---|---|---|
| E/21/006 | Abeykoon A.M.U.I.B. | [e21006@eng.pdn.ac.lk](mailto:e21006@eng.pdn.ac.lk) |
| E/21/007 | Abeynayake A.G.C.D. | [e21007@eng.pdn.ac.lk](mailto:e21007@eng.pdn.ac.lk) |
| E/21/124 | Ekanayake E.M.D.A. | [e21124@eng.pdn.ac.lk](mailto:e21124@eng.pdn.ac.lk) |
| E/21/410 | Thilakarathne L.R.O.S. | [e21410@eng.pdn.ac.lk](mailto:e21410@eng.pdn.ac.lk) |

**Supervisor:** Ms. Yasodha Vimukthi — [yasodhav@eng.pdn.ac.lk](mailto:yasodhav@eng.pdn.ac.lk)
