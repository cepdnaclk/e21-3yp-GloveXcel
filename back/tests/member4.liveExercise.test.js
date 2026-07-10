jest.mock('../models/LiveExercise', () => ({
    findOneAndUpdate: jest.fn()
}));

const { createLiveExercise } = require('../controllers/liveExerciseController');
const LiveExercise = require('../models/LiveExercise');

function mockResponse() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

describe('Member 4 - liveExerciseController.createLiveExercise Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('LE-001: Valid equivalence class - standard signup/upsert', async () => {
        const req = {
            body: {
                exercise_id: 'EX-LIVE-101',
                doctor_id: 'DOC-123',
                patient_id: 'PAT-001',
                fingers: {
                    thumb: { min: 5, max: 90, angle: 45, raw: 450 },
                    index: { min: 10, max: 100, angle: 50, raw: 500 },
                    middle: { min: 10, max: 100, angle: 50, raw: 500 },
                    ring: { min: 10, max: 100, angle: 50, raw: 500 },
                    pinky: { min: 5, max: 80, angle: 40, raw: 400 }
                }
            }
        };
        const res = mockResponse();

        LiveExercise.findOneAndUpdate.mockResolvedValue({ exercise_id: 'EX-LIVE-101' });

        await createLiveExercise(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Live exercise saved successfully'
        }));
    });

    test('LE-002: Missing exercise_id', async () => {
        const req = {
            body: {
                fingers: {
                    thumb: { min: 5, max: 90, angle: 45, raw: 450 }
                }
            }
        };
        const res = mockResponse();

        await createLiveExercise(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'exercise_id is required.' });
    });

    test('LE-003: One finger angle contains a non-numeric value', async () => {
        const req = {
            body: {
                exercise_id: 'EX-LIVE-101',
                doctor_id: 'DOC-123',
                patient_id: 'PAT-001',
                fingers: {
                    thumb: { min: 'invalid-non-numeric', max: 90, angle: 45, raw: 450 },
                    index: { min: 10, max: 100, angle: 50, raw: 500 },
                    middle: { min: 10, max: 100, angle: 50, raw: 500 },
                    ring: { min: 10, max: 100, angle: 50, raw: 500 },
                    pinky: { min: 5, max: 80, angle: 40, raw: 400 }
                }
            }
        };
        const res = mockResponse();

        await createLiveExercise(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'fingers with min, max, and angle for all 5 fingers is required.' });
    });

    test('LE-004: One finger is missing the angle field', async () => {
        const req = {
            body: {
                exercise_id: 'EX-LIVE-101',
                doctor_id: 'DOC-123',
                patient_id: 'PAT-001',
                fingers: {
                    thumb: { min: 5, max: 90, raw: 450 },
                    index: { min: 10, max: 100, angle: 50, raw: 500 },
                    middle: { min: 10, max: 100, angle: 50, raw: 500 },
                    ring: { min: 10, max: 100, angle: 50, raw: 500 },
                    pinky: { min: 5, max: 80, angle: 40, raw: 400 }
                }
            }
        };
        const res = mockResponse();

        await createLiveExercise(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'fingers with min, max, and angle for all 5 fingers is required.' });
    });
});
