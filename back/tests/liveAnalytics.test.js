jest.mock('../models/LiveAnalytics', () => ({
    findOneAndUpdate: jest.fn(),
    find: jest.fn()
}));

const { saveLiveAnalytics, listLiveAnalytics } = require('../controllers/liveAnalyticsController');
const LiveAnalytics = require('../models/LiveAnalytics');

function mockResponse() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

describe('liveAnalyticsController.saveLiveAnalytics Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('saves patient live analytics with Mongo $max for finger angles', async () => {
        const req = {
            body: {
                patient_id: 'PAT-001',
                doctor_id: 'DOC-123',
                exercise_id: 'EX-LIVE-101',
                rep_id: 'live-session-rep-001',
                rep_number: 1,
                force_level: 4,
                max_angles: {
                    thumb: 25.2,
                    index: 40,
                    middle: 41.5,
                    ring: 38,
                    pinky: 22
                }
            }
        };
        const res = mockResponse();
        LiveAnalytics.findOneAndUpdate.mockResolvedValue({ exercise_id: 'EX-LIVE-101' });

        await saveLiveAnalytics(req, res);

        expect(LiveAnalytics.findOneAndUpdate).toHaveBeenCalledWith(
            { patient_id: 'PAT-001', exercise_id: 'EX-LIVE-101', rep_id: 'live-session-rep-001' },
            expect.objectContaining({
                $set: expect.objectContaining({
                    patient_id: 'PAT-001',
                    doctor_id: 'DOC-123',
                    exercise_id: 'EX-LIVE-101',
                    rep_id: 'live-session-rep-001',
                    rep_number: 1,
                    force_level: 4
                }),
                $max: {
                    'max_angles.thumb': 25.2,
                    'max_angles.index': 40,
                    'max_angles.middle': 41.5,
                    'max_angles.ring': 38,
                    'max_angles.pinky': 22
                }
            }),
            { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Live analytics saved.'
        }));
    });

    test('uses authenticated patient id when patient token is present', async () => {
        const req = {
            user: { role: 'patient', sub: 'PAT-AUTH' },
            body: {
                patient_id: 'PAT-SPOOF',
                doctor_id: 'DOC-123',
                exercise_id: 'EX-LIVE-101',
                rep_id: 'live-session-rep-001',
                max_angles: {
                    thumb: 10,
                    index: 11,
                    middle: 12,
                    ring: 13,
                    pinky: 14
                }
            }
        };
        const res = mockResponse();
        LiveAnalytics.findOneAndUpdate.mockResolvedValue({ patient_id: 'PAT-AUTH' });

        await saveLiveAnalytics(req, res);

        expect(LiveAnalytics.findOneAndUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ patient_id: 'PAT-AUTH' }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    patient_id: 'PAT-AUTH',
                    force_level: 1
                })
            }),
            expect.any(Object)
        );
        expect(res.status).toHaveBeenCalledWith(200);
    });

    test('rejects missing finger angle values', async () => {
        const req = {
            body: {
                patient_id: 'PAT-001',
                doctor_id: 'DOC-123',
                exercise_id: 'EX-LIVE-101',
                rep_id: 'live-session-rep-001',
                max_angles: {
                    thumb: 10,
                    index: 11
                }
            }
        };
        const res = mockResponse();

        await saveLiveAnalytics(req, res);

        expect(LiveAnalytics.findOneAndUpdate).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'max_angles with all 5 finger values is required.' });
    });

    test('rejects missing rep_id', async () => {
        const req = {
            body: {
                patient_id: 'PAT-001',
                doctor_id: 'DOC-123',
                exercise_id: 'EX-LIVE-101',
                max_angles: {
                    thumb: 10,
                    index: 11,
                    middle: 12,
                    ring: 13,
                    pinky: 14
                }
            }
        };
        const res = mockResponse();

        await saveLiveAnalytics(req, res);

        expect(LiveAnalytics.findOneAndUpdate).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'rep_id is required.' });
    });

    test('lists latest analytics for selected doctor and patient', async () => {
        const req = {
            user: { role: 'doctor', sub: 'DOC-123' },
            query: {
                patient_id: 'PAT-001',
                doctor_id: 'DOC-SPOOF'
            }
        };
        const res = mockResponse();
        const docs = [{ patient_id: 'PAT-001', doctor_id: 'DOC-123', exercise_id: 'EX-1' }];
        const lean = jest.fn().mockResolvedValue(docs);
        const sort = jest.fn().mockReturnValue({ lean });
        LiveAnalytics.find.mockReturnValue({ sort });

        await listLiveAnalytics(req, res);

        expect(LiveAnalytics.find).toHaveBeenCalledWith({
            patient_id: 'PAT-001',
            doctor_id: 'DOC-123'
        });
        expect(sort).toHaveBeenCalledWith({ updatedAt: -1, createdAt: -1 });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ analytics: docs });
    });

    test('requires patient_id when listing analytics', async () => {
        const req = {
            user: { role: 'doctor', sub: 'DOC-123' },
            query: {}
        };
        const res = mockResponse();

        await listLiveAnalytics(req, res);

        expect(LiveAnalytics.find).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'patient_id is required.' });
    });
});
