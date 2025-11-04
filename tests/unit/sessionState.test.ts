import { describe, it, expect, beforeEach } from 'vitest';
import { SessionState } from '../../workers/durable_objects/SessionState';

class MockStorage {
    private store = new Map<string, any>();

    async get<T>(key: string): Promise<T | undefined> {
        return this.store.get(key);
    }

    async put(key: string, value: any): Promise<void> {
        this.store.set(key, value);
    }

    async delete(key: string): Promise<void> {
        this.store.delete(key);
    }

    snapshot(key: string) {
        return this.store.get(key);
    }
}

describe('SessionState', () => {
    let sessionState: SessionState;
    let storage: MockStorage;

    beforeEach(() => {
        storage = new MockStorage();
        const state = { storage } as any;
        sessionState = new SessionState(state, {});
    });

    const jsonResponse = async (res: Response) => {
        const text = await res.text();
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    };

    describe('Message History', () => {
        it('starts with empty history', async () => {
            const req = new Request('http://internal/get-history');
            const res = await sessionState.fetch(req);
            const history = await jsonResponse(res);

            expect(Array.isArray(history)).toBe(true);
            expect(history).toHaveLength(0);
        });

        it('adds user messages to history', async () => {
            const req = new Request('http://internal/add-message', {
                method: 'POST',
                body: JSON.stringify({ role: 'user', content: 'Hello' })
            });

            const res = await sessionState.fetch(req);
            expect(res.status).toBe(200);

            const history = storage.snapshot('history');
            expect(history).toHaveLength(1);
            expect(history[0]).toMatchObject({
                role: 'user',
                content: 'Hello'
            });
        });

        it('adds assistant messages to history', async () => {
            const req = new Request('http://internal/add-message', {
                method: 'POST',
                body: JSON.stringify({ role: 'assistant', content: 'Hi there!' })
            });

            await sessionState.fetch(req);

            const history = storage.snapshot('history');
            expect(history[0]).toMatchObject({
                role: 'assistant',
                content: 'Hi there!'
            });
        });

        it('maintains conversation order', async () => {
            await sessionState.fetch(new Request('http://internal/add-message', {
                method: 'POST',
                body: JSON.stringify({ role: 'user', content: 'First' })
            }));

            await sessionState.fetch(new Request('http://internal/add-message', {
                method: 'POST',
                body: JSON.stringify({ role: 'assistant', content: 'Second' })
            }));

            await sessionState.fetch(new Request('http://internal/add-message', {
                method: 'POST',
                body: JSON.stringify({ role: 'user', content: 'Third' })
            }));

            const history = storage.snapshot('history');
            expect(history).toHaveLength(3);
            expect(history[0].content).toBe('First');
            expect(history[1].content).toBe('Second');
            expect(history[2].content).toBe('Third');
        });

        it('handles messages with metadata', async () => {
            await sessionState.fetch(new Request('http://internal/add-message', {
                method: 'POST',
                body: JSON.stringify({
                    role: 'assistant',
                    content: 'Response',
                    metadata: { toolCalls: ['weather'], timestamp: '2025-11-04' }
                })
            }));

            const history = storage.snapshot('history');
            expect(history[0].metadata).toMatchObject({
                toolCalls: ['weather'],
                timestamp: '2025-11-04'
            });
        });
    });

    describe('History Management', () => {
        it('clears history', async () => {
            await sessionState.fetch(new Request('http://internal/add-message', {
                method: 'POST',
                body: JSON.stringify({ role: 'user', content: 'Message' })
            }));

            expect(storage.snapshot('history')).toHaveLength(1);

            const clearReq = new Request('http://internal/clear-history', { method: 'POST' });
            const res = await sessionState.fetch(clearReq);
            expect(res.status).toBe(200);

            const history = storage.snapshot('history');
            expect(history).toHaveLength(0);
        });

        it('retrieves full history', async () => {
            await sessionState.fetch(new Request('http://internal/add-message', {
                method: 'POST',
                body: JSON.stringify({ role: 'user', content: 'Hi' })
            }));

            await sessionState.fetch(new Request('http://internal/add-message', {
                method: 'POST',
                body: JSON.stringify({ role: 'assistant', content: 'Hello' })
            }));

            const getReq = new Request('http://internal/get-history');
            const res = await sessionState.fetch(getReq);
            const history = await jsonResponse(res);

            expect(history).toHaveLength(2);
        });
    });

    describe('Scenarios', () => {
        it('stores test scenarios', async () => {
            const scenario = {
                name: 'Test API',
                url: 'https://api.test.com',
                method: 'GET',
                expectedStatus: 200
            };

            const req = new Request('http://internal/scenarios/add', {
                method: 'POST',
                body: JSON.stringify(scenario)
            });

            const res = await sessionState.fetch(req);
            expect(res.status).toBe(200);

            const scenarios = storage.snapshot('scenarios');
            expect(Array.isArray(scenarios)).toBe(true);
            expect(scenarios).toHaveLength(1);
            expect(scenarios[0]).toMatchObject(scenario);
        });

        it('retrieves all scenarios', async () => {
            await storage.put('scenarios', [
                { name: 'Test 1', url: 'https://api.test.com/1' },
                { name: 'Test 2', url: 'https://api.test.com/2' }
            ]);

            const req = new Request('http://internal/scenarios/list');
            const res = await sessionState.fetch(req);
            const scenarios = await jsonResponse(res);

            expect(scenarios).toHaveLength(2);
        });

        it('deletes a scenario by index', async () => {
            await storage.put('scenarios', [
                { name: 'Test 1', url: 'https://api.test.com/1' },
                { name: 'Test 2', url: 'https://api.test.com/2' },
                { name: 'Test 3', url: 'https://api.test.com/3' }
            ]);

            const req = new Request('http://internal/scenarios/delete/1', {
                method: 'DELETE'
            });

            const res = await sessionState.fetch(req);
            expect(res.status).toBe(200);

            const scenarios = storage.snapshot('scenarios');
            expect(scenarios).toHaveLength(2);
            expect(scenarios[0].name).toBe('Test 1');
            expect(scenarios[1].name).toBe('Test 3');
        });

        it('handles scenario run with mock results', async () => {
            await storage.put('scenarios', [
                { name: 'Test', url: 'https://api.test.com', expectedStatus: 200 }
            ]);

            const req = new Request('http://internal/scenarios/run', {
                method: 'POST',
                body: JSON.stringify({ trigger: 'manual' })
            });

            const res = await sessionState.fetch(req);
            const result = await jsonResponse(res);

            expect(result.results).toBeDefined();
            expect(Array.isArray(result.results)).toBe(true);
        });
    });

    describe('Session Metadata', () => {
        it('stores arbitrary session data', async () => {
            await sessionState.fetch(new Request('http://internal/set-metadata', {
                method: 'POST',
                body: JSON.stringify({
                    key: 'user_preference',
                    value: { theme: 'dark', language: 'en' }
                })
            }));

            const metadata = storage.snapshot('user_preference');
            expect(metadata).toMatchObject({
                theme: 'dark',
                language: 'en'
            });
        });

        it('retrieves session metadata', async () => {
            await storage.put('custom_data', { setting: 'value' });

            const req = new Request('http://internal/get-metadata?key=custom_data');
            const res = await sessionState.fetch(req);
            const data = await jsonResponse(res);

            expect(data).toMatchObject({ setting: 'value' });
        });
    });

    describe('Error Handling', () => {
        it('returns 400 for invalid message format', async () => {
            const req = new Request('http://internal/add-message', {
                method: 'POST',
                body: JSON.stringify({ role: 'user' }) // missing content
            });

            const res = await sessionState.fetch(req);
            expect(res.status).toBe(400);
        });

        it('returns 404 for unknown routes', async () => {
            const req = new Request('http://internal/unknown-route');
            const res = await sessionState.fetch(req);
            expect(res.status).toBe(404);
        });

        it('handles malformed JSON in POST requests', async () => {
            const req = new Request('http://internal/add-message', {
                method: 'POST',
                body: 'invalid json'
            });

            const res = await sessionState.fetch(req);
            expect(res.status).toBeGreaterThanOrEqual(400);
        });
    });
});
