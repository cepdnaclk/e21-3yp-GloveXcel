# GloveXcel Backend

Node.js / Express backend for storing glove sensor data and calibration profiles for doctors and patients.

## Features

- Save glove sensor readings for patients
- Get recent glove data by patient ID
- Store doctor calibration values
- Store patient calibration values
- Uses MongoDB for data storage

## Requirements

- Node.js v16 or higher
- MongoDB database
- MongoDB connection string

## Setup

### 1. Install dependencies

```bash
cd back
npm install

Add environment variables

Create a .env file in the backend folder:
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/dbname
PORT=3000

MONGO_URI is required.
PORT is optional. The default port is 3000

3. Run the server
node server.js

The API will run on:

http://localhost:3000/api