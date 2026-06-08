const { getPool } = require('../config/supabaseDb');
const ExerciseMax = require('../models/ExerciseMax');

const createExercise = async (req, res) => {
    const {
        exercise_id,
        description,
        level,
        target_reps,
        target_sets,
        start_date,
        end_date,
        patient_id,
        doctor_id,
        max_angles
    } = req.body;

    try {
        if (!exercise_id) {
            return res.status(400).json({ error: 'exercise_id is required.' });
        }

        if (!max_angles || Object.values(max_angles).some((value) => !Number.isFinite(Number(value)))) {
            return res.status(400).json({ error: 'max_angles with all 5 finger values is required.' });
        }

        if (!patient_id || !doctor_id) {
            return res.status(400).json({ error: 'patient_id and doctor_id are required.' });
        }

        const pool = getPool();
        const query = `
            INSERT INTO Exercises 
            (exercise_id, description, level, target_reps, target_sets, start_date, end_date, patient_id, doctor_id) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *;
        `;
        
        const values = [
            exercise_id, 
            description, 
            level || 1, 
            target_reps, 
            target_sets, 
            start_date, 
            end_date,
            patient_id || null,
            doctor_id || null
        ];

        const result = await pool.query(query, values);

        await ExerciseMax.findOneAndUpdate(
            { exercise_id },
            {
                $set: {
                    exercise_id,
                    doctor_id,
                    patient_id,
                    max_angles: {
                        thumb: Number(max_angles.thumb),
                        index: Number(max_angles.index),
                        middle: Number(max_angles.middle),
                        ring: Number(max_angles.ring),
                        pinky: Number(max_angles.pinky)
                    },
                    updatedAt: Date.now()
                },
                $setOnInsert: { createdAt: Date.now() }
            },
            { upsert: true }
        );

        res.status(201).json({
            message: 'Exercise created successfully',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Error creating exercise:', error);
        res.status(500).json({ error: 'Failed to create exercise', details: error.message });
    }
};

const listExercises = async (req, res) => {
    const { patient_id } = req.query;

    if (!patient_id) {
        return res.status(400).json({ error: 'patient_id is required.' });
    }

    try {
        const pool = getPool();
        const result = await pool.query(
            `
            SELECT exercise_id, description, level, target_reps, target_sets,
                   start_date, end_date, patient_id, doctor_id
            FROM Exercises
            WHERE patient_id = $1
            ORDER BY start_date DESC NULLS LAST, exercise_id ASC
            `,
            [patient_id]
        );

        return res.status(200).json({ exercises: result.rows });
    } catch (error) {
        console.error('Error listing exercises:', error);
        return res.status(500).json({ error: 'Failed to list exercises', details: error.message });
    }
};

module.exports = { createExercise, listExercises };