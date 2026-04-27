const { getPool } = require('../config/supabaseDb');

const createExercise = async (req, res) => {
    const { exercise_id, description, level, target_reps, target_sets, start_date, end_date } = req.body;

    try {
        const pool = getPool();
        const query = `
            INSERT INTO Exercises 
            (exercise_id, description, level, target_reps, target_sets, start_date, end_date) 
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *;
        `;
        
        const values = [
            exercise_id, 
            description, 
            level || 1, 
            target_reps, 
            target_sets, 
            start_date, 
            end_date
        ];

        const result = await pool.query(query, values);

        res.status(201).json({
            message: 'Exercise created successfully',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Error creating exercise:', error);
        res.status(500).json({ error: 'Failed to create exercise', details: error.message });
    }
};

module.exports = { createExercise };