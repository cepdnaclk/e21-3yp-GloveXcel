require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

// Import Routes
const dataRoutes = require('./routes/dataRoutes');
const doctorCalRoutes = require('./routes/doctorCalRoutes');
const patientCalRoutes = require('./routes/patientCalRoutes');

const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB (Includes the network fix for Node.js IPv6 behavior)
mongoose.connect(process.env.MONGO_URI, { family: 4 })
  .then(() => console.log('✅ Connected to MongoDB Atlas!'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Mount API Routes
app.use('/api/data', dataRoutes);
app.use('/api/doctor-cal', doctorCalRoutes);
app.use('/api/patient-cal', patientCalRoutes);

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});