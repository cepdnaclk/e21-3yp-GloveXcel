const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from common locations.
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../env') });
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { connectPostgres } = require('./config/supabaseDb');

// Import Routes
const dataRoutes = require('./routes/dataRoutes');
const doctorCalRoutes = require('./routes/doctorCalRoutes');
const patientCalRoutes = require('./routes/patientCalRoutes');
const forceRoutes = require('./routes/forceRoutes');
const authRoutes = require('./routes/authRoutes');
const therapyRoutes = require('./routes/therapyRoutes');
const exerciseRoutes = require('./routes/exerciseRoutes');
const exerciseMaxRoutes = require('./routes/exerciseMaxRoutes');
const liveExerciseRoutes = require('./routes/liveExerciseRoutes');
const liveAnalyticsRoutes = require('./routes/liveAnalyticsRoutes');
const preloadedAnalyticsRoutes = require('./routes/preloadedAnalyticsRoutes');
const therapySessionRoutes = require('./routes/therapySessionRoutes');
const channelRequestRoutes = require('./routes/channelRequestRoutes');

const app = express();
app.use(cors());
app.use(express.json());

async function connectDatabase() {
  const dbClient = (process.env.DB_CLIENT || 'mongo').toLowerCase();

  const shouldConnectMongo = dbClient === 'mongo' || dbClient === 'both';
  const shouldConnectPostgres = dbClient === 'postgres' || dbClient === 'both';

  if (shouldConnectMongo) {
    if (!process.env.MONGO_URI) {
      throw new Error('Missing MONGO_URI. Add it to back/.env or project-root env file.');
    }

    await mongoose.connect(process.env.MONGO_URI, { family: 4 });
    console.log('✅ Connected to MongoDB Atlas!');
  }

  if (shouldConnectPostgres) {
    await connectPostgres();
  }

  if (!shouldConnectMongo && !shouldConnectPostgres) {
    throw new Error('Invalid DB_CLIENT value. Use mongo, postgres, or both.');
  }
}

// Mount API Routes
app.use('/api/data', dataRoutes);
app.use('/api/doctor-cal', doctorCalRoutes);
app.use('/api/patient-cal', patientCalRoutes);
app.use('/api/forces', forceRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/therapy-plans', therapyRoutes);
app.use('/api/exercises', exerciseRoutes);
app.use('/api/exercise-max', exerciseMaxRoutes);
app.use('/api/live-exercises', liveExerciseRoutes);
app.use('/api/live-analytics', liveAnalyticsRoutes);
app.use('/api/preloaded-analytics', preloadedAnalyticsRoutes);
app.use('/api/therapy-sessions', therapySessionRoutes);
app.use('/api/channel-requests', channelRequestRoutes);

// Start Server
const PORT = process.env.PORT || 3000;
connectDatabase()
  .then(() => {
    // Automatically download unpkg mqtt.min.js locally on startup if it does not exist
    const fs = require('fs');
    const https = require('https');
    const dest = path.resolve(__dirname, '../front/js/mqtt.min.js');
    if (!fs.existsSync(dest)) {
      console.log('Downloading mqtt.min.js locally to avoid tracking prevention...');
      https.get('https://unpkg.com/mqtt@5.15.1/dist/mqtt.min.js', (res) => {
        if (res.statusCode === 200) {
          const fileStream = fs.createWriteStream(dest);
          res.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            console.log('✅ Local mqtt.min.js downloaded successfully.');
          });
        } else {
          console.error('Failed to download mqtt.min.js: HTTP ' + res.statusCode);
        }
      }).on('error', (err) => {
        console.error('Error downloading mqtt.min.js:', err);
      });
    }

    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Database connection error:', err);
    process.exit(1);
  });
