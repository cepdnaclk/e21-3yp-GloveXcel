jest.mock('../config/supabaseDb', () => {
    const mockQuery = jest.fn();
    return {
        getPool: jest.fn(() => ({
            query: mockQuery
        })),
        ensureDoctorAndPatientExist: jest.fn()
    };
});

jest.mock('../models/ExerciseMax', () => ({
    findOneAndUpdate: jest.fn()
}));

const { createExercise, listExercises } = require('../controllers/exerciseController');
const db = require('../config/supabaseDb');
const ExerciseMax = require('../models/ExerciseMax');

const mockPool = db.getPool();

function mockResponse() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

describe('Member 3 - exerciseController.createExercise Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('EX-001: Valid equivalence class - standard signup', async () => {
        const req = {
            user: { role: 'doctor', sub: 'DOC-123' },
            body: {
                exercise_id: 'EX-001',
                description: 'Thumb & Index Flexion',
                level: 2,
                target_reps: 10,
                target_sets: 3,
                patient_id: 'PAT-001',
                max_angles: { thumb: 30, index: 45, middle: 45, ring: 45, pinky: 45 }
            }
        };
        const res = mockResponse();

        mockPool.query.mockResolvedValueOnce({
            rows: [{ exercise_id: 'EX-001', description: 'Thumb & Index Flexion' }]
        });
        ExerciseMax.findOneAndUpdate.mockResolvedValue({});

        await createExercise(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Exercise created successfully'
        }));
    });

    test('EX-002: Missing exercise_id', async () => {
        const req = {
            body: {
                description: 'No ID'
            }
        };
        const res = mockResponse();

        await createExercise(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'exercise_id is required.' });
    });

    test('EX-003: Missing finger value in max_angles', async () => {
        const req = {
            body: {
                exercise_id: 'EX-002',
                max_angles: { thumb: 30 }
            }
        };
        const res = mockResponse();

        await createExercise(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'max_angles with all 5 finger values is required.' });
    });

    test('EX-004: One finger angle contains non-numeric value', async () => {
        const req = {
            body: {
                exercise_id: 'EX-002',
                max_angles: { thumb: 30, index: 'not-a-number', middle: 45, ring: 45, pinky: 45 }
            }
        };
        const res = mockResponse();

        await createExercise(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'max_angles with all 5 finger values is required.' });
    });

    test('EX-005: Unauthorized user role', async () => {
        const req = {
            user: { role: 'patient', sub: 'PAT-001' },
            body: {
                exercise_id: 'EX-003',
                max_angles: { thumb: 30, index: 45, middle: 45, ring: 45, pinky: 45 }
            }
        };
        const res = mockResponse();

        await createExercise(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Only doctors or admins can create exercises.' });
    });

    test('EX-006: Doctor listing is filtered to the authenticated doctor', async () => {
        const req = {
            user: { role: 'doctor', sub: 'DOC-123' },
            query: {
                patient_id: 'PAT-001',
                doctor_id: 'DOC-SPOOF'
            }
        };
        const res = mockResponse();
        mockPool.query.mockResolvedValueOnce({
            rows: [{ exercise_id: 'EX-001', patient_id: 'PAT-001', doctor_id: 'DOC-123' }]
        });

        await listExercises(req, res);

        expect(mockPool.query).toHaveBeenCalledWith(
            expect.stringContaining('AND doctor_id = $2'),
            ['PAT-001', 'DOC-123']
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            exercises: [{ exercise_id: 'EX-001', patient_id: 'PAT-001', doctor_id: 'DOC-123' }]
        });
    });

    test('EX-007: Patient listing remains unfiltered by doctor', async () => {
        const req = {
            user: { role: 'patient', sub: 'PAT-001' },
            query: {
                patient_id: 'PAT-SPOOF'
            }
        };
        const res = mockResponse();
        mockPool.query.mockResolvedValueOnce({
            rows: [
                { exercise_id: 'EX-001', patient_id: 'PAT-001', doctor_id: 'DOC-123' },
                { exercise_id: 'EX-002', patient_id: 'PAT-001', doctor_id: 'DOC-456' }
            ]
        });

        await listExercises(req, res);

        expect(mockPool.query).toHaveBeenCalledWith(
            expect.not.stringContaining('AND doctor_id = $2'),
            ['PAT-001']
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            exercises: [
                { exercise_id: 'EX-001', patient_id: 'PAT-001', doctor_id: 'DOC-123' },
                { exercise_id: 'EX-002', patient_id: 'PAT-001', doctor_id: 'DOC-456' }
            ]
        });
    });
});
