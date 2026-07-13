jest.mock('../models/PreloadedAnalytics', () => ({
    findOneAndUpdate: jest.fn(),
    find: jest.fn()
}));

const { savePreloadedAnalytics, listPreloadedAnalytics } = require('../controllers/preloadedAnalyticsController');
const PreloadedAnalytics = require('../models/PreloadedAnalytics');

function mockResponse() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

describe('preloadedAnalyticsController Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('saves patient preloaded analytics with Mongo $max for finger angles', async () => {
        const req = {
            body: {
                patient_id: 'PAT-001',
                doctor_id: 'DOC-123',
                exercise_id: 'EX-PRE-101',
                force_level: 5,
                max_angles: {
                    thumb: 20,
                    index: 35.4,
                    middle: 36,
                    ring: 34.5,
                    pinky: 18
                }
            }
        };
        const res = mockResponse();
        PreloadedAnalytics.findOneAndUpdate.mockResolvedValue({ exercise_id: 'EX-PRE-101' });

        await savePreloadedAnalytics(req, res);

        expect(PreloadedAnalytics.findOneAndUpdate).toHaveBeenCalledWith(
            { patient_id: 'PAT-001', exercise_id: 'EX-PRE-101' },
            expect.objectContaining({
                $set: expect.objectContaining({
                    patient_id: 'PAT-001',
                    doctor_id: 'DOC-123',
                    exercise_id: 'EX-PRE-101',
                    force_level: 5
                }),
                $max: {
                    'max_angles.thumb': 20,
                    'max_angles.index': 35.4,
                    'max_angles.middle': 36,
                    'max_angles.ring': 34.5,
                    'max_angles.pinky': 18
                }
            }),
            { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Preloaded analytics saved.'
        }));
    });

    test('lists latest preloaded analytics for selected doctor and patient', async () => {
        const req = {
            user: { role: 'doctor', sub: 'DOC-123' },
            query: {
                patient_id: 'PAT-001',
                doctor_id: 'DOC-SPOOF'
            }
        };
        const res = mockResponse();
        const docs = [{ patient_id: 'PAT-001', doctor_id: 'DOC-123', exercise_id: 'EX-PRE-1' }];
        const lean = jest.fn().mockResolvedValue(docs);
        const sort = jest.fn().mockReturnValue({ lean });
        PreloadedAnalytics.find.mockReturnValue({ sort });

        await listPreloadedAnalytics(req, res);

        expect(PreloadedAnalytics.find).toHaveBeenCalledWith({
            patient_id: 'PAT-001',
            doctor_id: 'DOC-123'
        });
        expect(sort).toHaveBeenCalledWith({ updatedAt: -1, createdAt: -1 });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ analytics: docs });
    });
});
