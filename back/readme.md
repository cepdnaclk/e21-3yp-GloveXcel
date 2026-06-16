# GloveXcel Backend API Reference

Node.js / Express backend service handling user authentication, glove sensor streaming data, calibration limits for both doctors and patients, motor forces, exercises, and rehabilitation sessions.

---

## Getting Started

### 1. Requirements
- Node.js (v16.0.0 or higher)
- MongoDB Database (Atlas cluster or local instance)

### 2. Installation
Navigate to the backend directory and install dependencies:
```bash
cd back
npm install
```

### 3. Environment Variables
Create a `.env` file in the `back` directory:
```env
MONGO_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/glovexcel
PORT=3000
JWT_SECRET=your_jwt_secret_key_here
```

### 4. Running the Server
Run the production server:
```bash
npm start
```
Or run the development server:
```bash
npm run dev
```
The server will start on `http://localhost:3000`.

---

## API Endpoints Reference

All endpoints are prefixed with `/api`.

### 1. Authentication (`/api/auth`)

| Method | Endpoint | Description | Auth Required? |
|--------|----------|-------------|----------------|
| **POST** | `/api/auth/admin/signup` | Registers a new Administrator user. | No |
| **POST** | `/api/auth/admin/login` | Logins an Administrator user. | No |
| **GET** | `/api/auth/admin/doctor-requests` | Retrieves list of pending doctor registration requests. | Yes (Admin) |
| **GET** | `/api/auth/admin/approved-doctors` | Retrieves list of approved doctor profiles. | Yes (Admin) |
| **POST** | `/api/auth/doctor/signup` | Submits a sign-up request for a Doctor. | No |
| **POST** | `/api/auth/doctor/login` | Logins an approved Doctor. | No |
| **POST** | `/api/auth/patient/signup` | Registers a new Patient. | No |
| **POST** | `/api/auth/patient/login` | Logins a Patient. | No |
| **POST** | `/api/auth/login` | Unified authentication login route. | No |
| **GET** | `/api/auth/hospitals` | Lists all registered hospitals/clinics. | No |
| **POST** | `/api/auth/hospitals` | Registers a new hospital/clinic. | No |
| **GET** | `/api/auth/patients` | Lists all patients assigned to this doctor. | Yes (Doctor/Admin) |

---

### 2. Doctor Calibration (`/api/doctor-cal`)
*These endpoints manage the calibration limits for the doctor's glove (used as reference targets/biofeedback).*

| Method | Endpoint | Description |
|--------|----------|-------------|
| **GET** | `/api/doctor-cal/:doctor_id` | Gets the saved calibration document (Min/Max values) for a doctor. |
| **POST** | `/api/doctor-cal/:doctor_id/max/thumb` | Saves the maximum flexion raw value for the doctor's thumb. |
| **POST** | `/api/doctor-cal/:doctor_id/min/thumb` | Saves the minimum flexion raw value for the doctor's thumb. |
| **POST** | `/api/doctor-cal/:doctor_id/max/fingers` | Saves maximum raw values for non-thumb fingers (Index, Middle, Ring, Pinky). |
| **POST** | `/api/doctor-cal/:doctor_id/min/fingers` | Saves minimum raw values for non-thumb fingers (Index, Middle, Ring, Pinky). |

---

### 3. Patient Calibration (`/api/patient-cal`)
*These endpoints manage the calibration limits and target compliance metrics for patients.*

| Method | Endpoint | Description |
|--------|----------|-------------|
| **GET** | `/api/patient-cal/:patient_id` | Gets the saved calibration document for a patient. |
| **POST** | `/api/patient-cal/:patient_id/max/thumb` | Saves the maximum flexion raw value for the patient's thumb. |
| **POST** | `/api/patient-cal/:patient_id/min/thumb` | Saves the minimum flexion raw value for the patient's thumb. |
| **POST** | `/api/patient-cal/:patient_id/max/fingers` | Saves maximum raw values for patient non-thumb fingers. |
| **POST** | `/api/patient-cal/:patient_id/min/fingers` | Saves minimum raw values for patient non-thumb fingers. |

---

### 4. Glove Sensor Data (`/api/data`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| **POST** | `/api/data` | Receives and saves a batch of real-time glove sensor readings. |
| **GET** | `/api/data/:patient_id` | Fetches recent time-series glove sensor packets for a patient. |

---

### 5. Exercises & Plans (`/api/exercises`, `/api/therapy-plans`, `/api/exercise-max`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| **POST** | `/api/exercises` | Creates and stores a new exercise configuration (max angles, target reps, etc). |
| **GET** | `/api/exercises` | Lists all saved exercises. |
| **GET** | `/api/exercise-max/:exercise_id` | Gets the max angle requirements for a specific exercise ID. |
| **POST** | `/api/therapy-plans` | Creates and assigns a therapy plan for a patient. |

---

### 6. Therapy Sessions & Force Control (`/api/therapy-sessions`, `/api/forces`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| **GET** | `/api/therapy-sessions/patient/:patient_id` | Lists all history logs of therapy sessions performed by a patient. |
| **POST** | `/api/forces` | Sets the resistive/feedback force level target. |
| **GET** | `/api/forces` | Gets the current force feedback level. |