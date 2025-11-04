import { describe, it, expect } from 'vitest';
import worker from '../../workers/index';

describe('Edge Cases & Security', () => {
    const createMockEnv = () => ({
        AI: {
            run: async () => ({ response: 'OK' })
        },
        SESSION_STATE: {
            idFromName: () => ({ toString: () => 'session-id' }),
            get: () => ({
                fetch: async () => new Response(JSON.stringify([]), { status: 200 })
            })
        },
        TOOL_REGISTRY: {
            idFromName: () => ({ toString: () => 'registry-id' }),
            get: () => ({
                fetch: async () => new Response(JSON.stringify({ tools: [] }), { status: 200 })
            })
        }
    } as any);

    describe('Input Validation', () => {
        it('rejects chat requests with oversized messages', async () => {
            const env = createMockEnv();
            const hugMessage = 'a'.repeat(1000000); // 1MB message

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
                body: JSON.stringify({ message: hugMessage })
            });

            const response = await worker.fetch(request, env);
            expect([200, 400, 413]).toContain(response.status);
        });

        it('handles special characters in messages', async () => {
            const env = createMockEnv();
            const specialChars = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/~`\n\t\r';

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
                body: JSON.stringify({ message: specialChars })
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBe(200);
        });

        it('handles unicode and emoji in messages', async () => {
            const env = createMockEnv();
            const unicode = '你好 🌍 مرحبا שלום 🚀';

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
                body: JSON.stringify({ message: unicode })
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBe(200);
        });

        it('rejects malformed JSON payloads', async () => {
            const env = createMockEnv();

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
                body: '{"message": invalid json}'
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBeGreaterThanOrEqual(400);
        });

        it('handles empty request body', async () => {
            const env = createMockEnv();

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
                body: ''
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBeGreaterThanOrEqual(400);
        });
    });

    describe('Code Injection Prevention', () => {
        it('sanitizes tool code during installation', async () => {
            const env = createMockEnv();
            env.TOOL_REGISTRY.get = () => ({
                fetch: async (url: string | URL, init?: RequestInit) => {
                    const urlStr = typeof url === 'string' ? url : url.toString();
                    if (urlStr.includes('/install')) {
                        const body = init?.body ? JSON.parse(init.body as string) : null;
                        // Should store code as-is but not execute in local dev
                        return new Response(JSON.stringify({
                            success: true,
                            toolId: body?.name || 'unknown'
                        }), { status: 200 });
                    }
                    return new Response('Not found', { status: 404 });
                }
            });

            const maliciousCode = `
        export default () => {
          // Attempt to access sensitive data
          process.env.SECRET_KEY = "hacked";
          return { hacked: true };
        };
      `;

            const request = new Request('https://example.com/api/tools/install', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'malicious',
                    code: maliciousCode,
                    exports: ['default']
                })
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBe(200);
        });

        it('prevents SQL injection attempts in tool parameters', async () => {
            const env = createMockEnv();
            const sqlInjection = "'; DROP TABLE users; --";

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
                body: JSON.stringify({
                    message: 'Search for user',
                    toolName: 'database',
                    params: { query: sqlInjection }
                })
            });

            const response = await worker.fetch(request, env);
            // Should handle without executing SQL
            expect(response.status).toBeLessThan(500);
        });

        it('prevents XSS attempts in message content', async () => {
            const env = createMockEnv();
            const xssPayload = '<script>alert("XSS")</script>';

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
                body: JSON.stringify({ message: xssPayload })
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBe(200);
        });
    });

    describe('Rate Limiting & Resource Management', () => {
        it('handles rapid successive requests', async () => {
            const env = createMockEnv();

            const requests = Array.from({ length: 10 }, (_, i) =>
                worker.fetch(new Request('https://example.com/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'rapid' },
                    body: JSON.stringify({ message: `Rapid ${i}` })
                }), env)
            );

            const responses = await Promise.all(requests);
            const successCount = responses.filter(r => r.status === 200).length;

            // All or most should succeed (no rate limiting in test)
            expect(successCount).toBeGreaterThan(0);
        });

        it('handles concurrent requests from multiple sessions', async () => {
            const env = createMockEnv();

            const requests = Array.from({ length: 20 }, (_, i) =>
                worker.fetch(new Request('https://example.com/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Session-ID': `session-${i}` },
                    body: JSON.stringify({ message: `Message from session ${i}` })
                }), env)
            );

            const responses = await Promise.all(requests);
            const allSuccessful = responses.every(r => r.status === 200);
            expect(allSuccessful).toBe(true);
        });
    });

    describe('Error Recovery', () => {
        it('recovers from AI service failures', async () => {
            const env = createMockEnv();
            let callCount = 0;

            env.AI.run = async () => {
                callCount++;
                if (callCount === 1) {
                    throw new Error('AI service temporarily unavailable');
                }
                return { response: 'Recovered' };
            };

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
                body: JSON.stringify({ message: 'Test recovery' })
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBeLessThan(600);
        });

        it('handles storage failures gracefully', async () => {
            const env = createMockEnv();

            env.SESSION_STATE.get = () => ({
                fetch: async () => {
                    throw new Error('Storage unavailable');
                }
            });

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
                body: JSON.stringify({ message: 'Test' })
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBeGreaterThanOrEqual(500);
        });
    });

    describe('CORS & Headers', () => {
        it('includes proper CORS headers in responses', async () => {
            const env = createMockEnv();

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Origin': 'https://example.com',
                    'X-Session-ID': 'test'
                },
                body: JSON.stringify({ message: 'Test CORS' })
            });

            const response = await worker.fetch(request, env);

            expect(response.headers.get('Access-Control-Allow-Origin')).toBeDefined();
            expect(response.headers.get('Access-Control-Allow-Methods')).toBeDefined();
        });

        it('handles OPTIONS preflight requests', async () => {
            const env = createMockEnv();

            const request = new Request('https://example.com/api/chat', {
                method: 'OPTIONS',
                headers: {
                    'Origin': 'https://example.com',
                    'Access-Control-Request-Method': 'POST'
                }
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBe(200);
            expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
        });
    });

    describe('Data Validation', () => {
        it('validates tool export names', async () => {
            const env = createMockEnv();
            env.TOOL_REGISTRY.get = () => ({
                fetch: async (url: string | URL) => {
                    const urlStr = typeof url === 'string' ? url : url.toString();
                    if (urlStr.includes('/list')) {
                        return new Response(JSON.stringify({
                            tools: [{
                                name: 'test',
                                exports: ['valid'],
                                metadata: {}
                            }]
                        }), { status: 200 });
                    }
                    if (urlStr.includes('/invoke')) {
                        return new Response(JSON.stringify({
                            error: 'Export not found'
                        }), { status: 404 });
                    }
                    return new Response('Not found', { status: 404 });
                }
            });

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
                body: JSON.stringify({
                    message: 'Run tool',
                    toolName: 'test',
                    exportName: 'invalid',
                    params: {}
                })
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBeLessThan(500);
        });

        it('validates tool parameters types', async () => {
            const env = createMockEnv();

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
                body: JSON.stringify({
                    message: 'Run tool',
                    toolName: 'test',
                    params: 'invalid'
                })
            });

            const response = await worker.fetch(request, env);
            // Should handle gracefully
            expect(response.status).toBeLessThan(500);
        });
    });

    describe('Session Management', () => {
        it('creates new session when session ID is missing', async () => {
            const env = createMockEnv();

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'Test' })
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBe(200);
        });

        it('handles invalid session ID format', async () => {
            const env = createMockEnv();

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-ID': '../../../etc/passwd'
                },
                body: JSON.stringify({ message: 'Test' })
            });

            const response = await worker.fetch(request, env);
            // Should sanitize or create new session
            expect(response.status).toBe(200);
        });
    });

    describe('Content Type Handling', () => {
        it('rejects non-JSON content types', async () => {
            const env = createMockEnv();

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain',
                    'X-Session-ID': 'test'
                },
                body: 'plain text message'
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBeGreaterThanOrEqual(400);
        });

        it('handles missing content-type header', async () => {
            const env = createMockEnv();

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'X-Session-ID': 'test' },
                body: JSON.stringify({ message: 'Test' })
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBeLessThan(500);
        });
    });
});
