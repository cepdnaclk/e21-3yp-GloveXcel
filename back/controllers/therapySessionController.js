const { getPool } = require('../config/supabaseDb');

const getPatientSessions = async (req, res) => {
    const { patient_id } = req.params;

    try {
        const pool = getPool();
        
        // This SQL query joins the Sessions table with the Plans table 
        // so we can filter by patient_id and see the exercise_id!
        const query = `
            SELECT 
                ts.session_id, 
                ts.session_date, 
                ts.completed_reps, 
                ts.completed_sets, 
                ts.status,
                tp.plan_id, 
                tp.exercise_id
            FROM Therapy_Sessions ts
            JOIN Therapy_Plans tp ON ts.plan_id = tp.plan_id
            WHERE tp.patient_id = $1
            ORDER BY ts.session_date DESC;
        `;
        
        const result = await pool.query(query, [patient_id]);

        res.status(200).json({
            message: 'Patient sessions retrieved successfully',
            count: result.rows.length,
            data: result.rows
        });
    } catch (error) {
        console.error('Error fetching patient sessions:', error);
        res.status(500).json({ error: 'Failed to fetch sessions', details: error.message });
    }
};

module.exports = { getPatientSessions };