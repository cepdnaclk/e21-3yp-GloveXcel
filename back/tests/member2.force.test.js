jest.mock('../models/Force', () => ({
    findOneAndUpdate: jest.fn()
}));

const { setForceLevel } = require('../controllers/forceController');
const Force = require('../models/Force');

function mockResponse() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

describe('Member 2 - forceController.setForceLevel Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('FL-001: Valid equivalence class - standard set level 5', async () => {
        const req = {
            body: { level: 5, patient_id: 'PAT-001', exercise_id: 'EX-001' }
        };
        const res = mockResponse();

        Force.findOneAndUpdate.mockResolvedValue({ patient_id: 'PAT-001', level: 5, exercise_id: 'EX-001' });

        await setForceLevel(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Force level saved.'
        }));
    });

    test('FL-002: Accepts lower boundary level 1', async () => {
        const req = {
            body: { level: 1, patient_id: 'PAT-001', exercise_id: 'EX-001' }
        };
        const res = mockResponse();
        Force.findOneAndUpdate.mockResolvedValue({ patient_id: 'PAT-001', level: 1 });

        await setForceLevel(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    test('FL-003: Accepts upper boundary level 10', async () => {
        const req = {
            body: { level: 10, patient_id: 'PAT-001', exercise_id: 'EX-001' }
        };
        const res = mockResponse();
        Force.findOneAndUpdate.mockResolvedValue({ patient_id: 'PAT-001', level: 10 });

        await setForceLevel(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    test('FL-004: Rejects level 0', async () => {
        const req = {
            body: { level: 0, patient_id: 'PAT-001', exercise_id: 'EX-001' }
        };
        const res = mockResponse();

        await setForceLevel(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Level must be an integer between 1 and 10.' });
    });

    test('FL-005: Rejects level 11', async () => {
        const req = {
            body: { level: 11, patient_id: 'PAT-001', exercise_id: 'EX-001' }
        };
        const res = mockResponse();

        await setForceLevel(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Level must be an integer between 1 and 10.' });
    });

    test('FL-006: Rejects float level 5.5', async () => {
        const req = {
            body: { level: 5.5, patient_id: 'PAT-001', exercise_id: 'EX-001' }
        };
        const res = mockResponse();

        await setForceLevel(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Level must be an integer between 1 and 10.' });
    });

    test('FL-007: Rejects string level "5"', async () => {
        const req = {
            body: { level: '5', patient_id: 'PAT-001', exercise_id: 'EX-001' }
        };
        const res = mockResponse();

        await setForceLevel(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Level must be an integer between 1 and 10.' });
    });

    test('FL-008: Rejects null level', async () => {
        const req = {
            body: { level: null, patient_id: 'PAT-001', exercise_id: 'EX-001' }
        };
        const res = mockResponse();

        await setForceLevel(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Level must be an integer between 1 and 10.' });
    });

    test('FL-009: Rejects missing patient ID', async () => {
        const req = {
            body: { level: 5, exercise_id: 'EX-001' }
        };
        const res = mockResponse();

        await setForceLevel(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'patient_id is required.' });
        expect(Force.findOneAndUpdate).not.toHaveBeenCalled();
    });
});
