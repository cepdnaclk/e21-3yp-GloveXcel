const { getPool, ensureDoctorAndPatientExist } = require('../config/supabaseDb');
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

        if (req.user && !['doctor', 'admin'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Only doctors or admins can create exercises.' });
        }

        const effectiveDoctorId = req.user?.role === 'doctor'
            ? req.user.sub
            : doctor_id;

        if (!patient_id || !effectiveDoctorId) {
            return res.status(400).json({ error: 'patient_id and doctor_id are required.' });
        }

        const pool = getPool();
        await ensureDoctorAndPatientExist(pool, effectiveDoctorId, patient_id);
        const today = new Date().toISOString().slice(0, 10);
        const effectiveStartDate = start_date || today;
        const effectiveEndDate = end_date || effectiveStartDate;

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
            effectiveStartDate, 
            effectiveEndDate,
            patient_id || null,
            effectiveDoctorId || null
        ];

        const result = await pool.query(query, values);

        await ExerciseMax.findOneAndUpdate(
            { exercise_id },
            {
                $set: {
                    exercise_id,
                    doctor_id: effectiveDoctorId,
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
    const requestedPatientId = req.query.patient_id;
    const effectivePatientId = req.user?.role === 'patient'
        ? req.user.sub
        : requestedPatientId;

    if (!effectivePatientId) {
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
            [effectivePatientId]
        );

        return res.status(200).json({ exercises: result.rows });
    } catch (error) {
        console.error('Error listing exercises:', error);
        return res.status(500).json({ error: 'Failed to list exercises', details: error.message });
    }
};

module.exports = { createExercise, listExercises };
