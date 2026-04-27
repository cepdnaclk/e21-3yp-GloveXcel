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

// Start Server
const PORT = process.env.PORT || 3000;
connectDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Database connection error:', err);
    process.exit(1);
  });