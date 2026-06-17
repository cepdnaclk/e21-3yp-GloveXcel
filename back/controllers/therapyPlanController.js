const { getPool, ensureDoctorAndPatientExist } = require('../config/supabaseDb'); 
const { v4: uuidv4 } = require('uuid');

const createTherapyPlan = async (req, res) => {
    const { doctor_id, patient_id, exercise_id } = req.body;
    
    // Generate a unique ID (matching your VARCHAR(50) requirement)
    const plan_id = `plan_${uuidv4()}`;

    try {
        const pool = getPool(); 
        await ensureDoctorAndPatientExist(pool, doctor_id, patient_id);

        const query = `
            INSERT INTO Therapy_Plans 
            (plan_id, doctor_id, patient_id, exercise_id) 
            VALUES ($1, $2, $3, $4)
            RETURNING *;
        `;
        const values = [plan_id, doctor_id, patient_id, exercise_id];
        
        const result = await pool.query(query, values);

        res.status(201).json({
            message: 'Therapy plan created successfully',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Error creating plan:', error);
        res.status(500).json({ 
            error: 'Failed to create therapy plan',
            details: error.message 
        });
    }
};

module.exports = { createTherapyPlan };
