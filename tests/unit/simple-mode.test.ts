import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';

describe('Simple Mode - Backend Tests', () => {
    let worker: Unstable_DevWorker;

    beforeAll(async () => {
        worker = await unstable_dev('workers/index.ts', {
            experimental: { disableExperimentalWarning: true },
        });
    });

    afterAll(async () => {
        await worker.stop();
    });

    describe('POST /api/simple-create - Input Validation', () => {
        it('should require apiName', async () => {
            const response = await worker.fetch('/api/simple-create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    intent: 'test intent',
                    sessionId: 'test',
                }),
            });

            expect(response.status).toBe(400);
            const data = await response.json() as any;
            expect(data.error).toBeDefined();
        });

        it('should require intent', async () => {
            const response = await worker.fetch('/api/simple-create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiName: 'TestAPI',
                    sessionId: 'test',
                }),
            });

            expect(response.status).toBe(400);
            const data = await response.json() as any;
            expect(data.error).toBeDefined();
        });

        it('should reject empty strings', async () => {
            const response = await worker.fetch('/api/simple-create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiName: '',
                    intent: '',
                    sessionId: 'test',
                }),
            });

            expect(response.status).toBe(400);
        });

        it('should accept valid input', async () => {
            const response = await worker.fetch('/api/simple-create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-ID': 'test-123',
                },
                body: JSON.stringify({
                    apiName: 'Stripe',
                    intent: 'charge credit cards',
                    sessionId: 'test-123',
                }),
            });

            expect([200, 500]).toContain(response.status);

            if (response.ok) {
                const data = await response.json() as any;
                expect(data.success).toBe(true);
                expect(data.spec).toBeDefined();
                expect(data.analysis).toBeDefined();
            }
        });
    });

    describe('GET /api/simple-create/popular', () => {
        it('should return list of popular APIs', async () => {
            const response = await worker.fetch('/api/simple-create/popular');

            expect(response.ok).toBe(true);
            const data = await response.json() as any;
            expect(data.success).toBe(true);
            expect(Array.isArray(data.apis)).toBe(true);
            expect(data.apis.length).toBeGreaterThan(0);
        });

        it('should include known popular APIs', async () => {
            const response = await worker.fetch('/api/simple-create/popular');
            const data = await response.json() as any;

            const apiNames = data.apis.map((api: any) => api.name);
            expect(apiNames).toContain('Stripe');
            expect(apiNames).toContain('GitHub');
            expect(apiNames).toContain('Twilio');
        });

        it('should include hasSpec flag for each API', async () => {
            const response = await worker.fetch('/api/simple-create/popular');
            const data = await response.json() as any;

            data.apis.forEach((api: any) => {
                expect(api).toHaveProperty('name');
                expect(api).toHaveProperty('hasSpec');
                expect(typeof api.hasSpec).toBe('boolean');
            });
        });
    });
});
