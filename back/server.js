require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// --- 1. Connect to MongoDB ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas!'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- 2. Define the Database Structure ---
const sessionSchema = new mongoose.Schema({
    patient_id: { type: String, required: true },
    thumb: { type: Number, required: true },
    index: { type: Number, required: true },
    middle: { type: Number, required: true },
    ring: { type: Number, required: true },
    pinky: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now }
});

const GloveData = mongoose.model('GloveData', sessionSchema);

// --- 3. API Routes ---
// This route SAVES the data
app.post('/api/data', async (req, res) => {
    try {
        const newData = new GloveData(req.body);
        const savedData = await newData.save(); 
        res.status(201).json({ message: 'Saved successfully', data: savedData });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save data' });
    }
});

// This route RETRIEVES the data
app.get('/api/data/:patient_id', async (req, res) => {
    try {
        const { patient_id } = req.params;
        const data = await GloveData.find({ patient_id: patient_id })
                                    .sort({ timestamp: -1 }) // Newest first
                                    .limit(50);
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

// --- 4. Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});