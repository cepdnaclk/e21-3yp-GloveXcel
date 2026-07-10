const { patientSignup } = require('../controllers/authController');
const db = require('../config/supabaseDb');
const bcrypt = require('bcryptjs');

// Mock PostgreSQL and bcryptjs modules
jest.mock('../config/supabaseDb', () => {
    const mockQuery = jest.fn();
    return {
        getPool: jest.fn(() => ({
            query: mockQuery
        })),
        ensureDoctorAndPatientExist: jest.fn(),
        ensureChannelRequestsTable: jest.fn()
    };
});

jest.mock('bcryptjs', () => ({
    hash: jest.fn(() => Promise.resolve('hashed_password_123'))
}));

const mockPool = db.getPool();

function mockResponse() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

describe('Member 1 - authController.patientSignup Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('TS-001: Valid equivalence class - standard signup', async () => {
        const req = {
            body: {
                name: 'John Doe',
                age: 30,
                email: 'john@test.com',
                primary_hospital_id: 'H001',
                password: 'SecurePassword123'
            }
        };
        const res = mockResponse();

        mockPool.query.mockResolvedValueOnce({ rowCount: 0 }); // Email lookup
        mockPool.query.mockResolvedValueOnce({ rowCount: 1 }); // Hospital lookup
        mockPool.query.mockResolvedValueOnce({
            rows: [{
                patient_id: 'PAT-123',
                name: 'John Doe',
                age: 30,
                email: 'john@test.com',
                primary_hospital_id: 'H001'
            }]
        }); // Insert

        await patientSignup(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Patient account created successfully.',
            patient: expect.objectContaining({ name: 'John Doe', patient_id: 'PAT-123' })
        }));
    });

    test('TS-002: Lower age boundary - exact 0', async () => {
        const req = {
            body: {
                name: 'Baby Patient',
                age: 0,
                email: 'baby@test.com',
                primary_hospital_id: 'H001',
                password: 'pass'
            }
        };
        const res = mockResponse();

        mockPool.query.mockResolvedValueOnce({ rowCount: 0 });
        mockPool.query.mockResolvedValueOnce({ rowCount: 1 });
        mockPool.query.mockResolvedValueOnce({
            rows: [{ patient_id: 'PAT-0', name: 'Baby Patient', age: 0, email: 'baby@test.com', primary_hospital_id: 'H001' }]
        });

        await patientSignup(req, res);
        expect(res.status).toHaveBeenCalledWith(201);
    });

    test('TS-003: Just below lower boundary - age -1', async () => {
        const req = {
            body: {
                name: 'Invalid Age',
                age: -1,
                email: 'invalid@test.com',
                primary_hospital_id: 'H001',
                password: 'pass'
            }
        };
        const res = mockResponse();

        await patientSignup(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'Age must be a valid non-negative number.' });
    });

    test('TS-004: Missing required field - empty name', async () => {
        const req = {
            body: {
                name: '',
                age: 25,
                email: 'test@test.com',
                primary_hospital_id: 'H001',
                password: 'pass'
            }
        };
        const res = mockResponse();

        await patientSignup(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('Patient signup requires')
        }));
    });

    test('TS-005: Invalid type - age is "thirty"', async () => {
        const req = {
            body: {
                name: 'Test Patient',
                age: 'thirty',
                email: 'thirty@test.com',
                primary_hospital_id: 'H001',
                password: 'pass'
            }
        };
        const res = mockResponse();

        await patientSignup(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'Age must be a valid non-negative number.' });
    });

    test('TS-006: Duplicate email registry', async () => {
        const req = {
            body: {
                name: 'Duplicate',
                age: 25,
                email: 'duplicate@test.com',
                primary_hospital_id: 'H001',
                password: 'pass'
            }
        };
        const res = mockResponse();

        mockPool.query.mockResolvedValueOnce({ rowCount: 1 }); // Email lookup matches existing

        await patientSignup(req, res);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({ message: 'Patient account already exists for this email.' });
    });

    test('TS-007: Non-existent hospital ID', async () => {
        const req = {
            body: {
                name: 'No Hospital',
                age: 25,
                email: 'nohosp@test.com',
                primary_hospital_id: 'H999',
                password: 'pass'
            }
        };
        const res = mockResponse();

        mockPool.query.mockResolvedValueOnce({ rowCount: 0 }); // Email check passes
        mockPool.query.mockResolvedValueOnce({ rowCount: 0 }); // Hospital does not exist

        await patientSignup(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'Selected primary_hospital_id does not exist.' });
    });

    test('TS-008: Null input - email is null', async () => {
        const req = {
            body: {
                name: 'Null Email',
                age: 25,
                email: null,
                primary_hospital_id: 'H001',
                password: 'pass'
            }
        };
        const res = mockResponse();

        await patientSignup(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('Patient signup requires')
        }));
    });
});
