import { describe, it, expect, beforeEach } from 'vitest';
import { SkillRegistry, type SkillDefinition } from '../../workers/durable_objects/SkillRegistry';

class MockStorage {
    private store = new Map<string, any>();

    async put(key: string, value: any) {
        this.store.set(key, value);
    }

    async get<T>(key: string): Promise<T | undefined> {
        return this.store.get(key);
    }

    async delete(key: string) {
        this.store.delete(key);
    }

    async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
        const entries = Array.from(this.store.entries()) as Array<[string, T]>;
        if (!options?.prefix) {
            return new Map(entries);
        }
        return new Map(entries.filter(([key]) => key.startsWith(options.prefix!)));
    }
}

class MockState {
    storage = new MockStorage();
}

describe('SkillRegistry Durable Object', () => {
    let registry: SkillRegistry;

    const createSkill = (name: string, description: string): SkillDefinition => ({
        name,
        description,
        operationId: name,
        method: 'GET',
        path: `/${name}`,
        parameters: [],
        baseUrl: 'https://api.test.com'
    });

    beforeEach(() => {
        registry = new SkillRegistry(new MockState() as any);
    });

    const jsonResponse = async (res: Response) => {
        const text = await res.text();
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    };

    describe('POST /register - Register API', () => {
        it('should register a new API with skills', async () => {
            const request = new Request('http://internal/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'Pet Store API',
                    baseUrl: 'https://api.petstore.com',
                    skills: [createSkill('listPets', 'List all pets')],
                    encryptedApiKey: 'encrypted-key-123',
                    metadata: {
                        title: 'Pet Store API',
                        version: '1.0.0'
                    }
                })
            });

            const response = await registry.fetch(request);
            expect(response.status).toBe(200);

            const result = await jsonResponse(response);
            expect(result.success).toBe(true);
            expect(result.message).toBeDefined();
            expect(result.skillCount).toBe(1);
        });

        it('should require apiName', async () => {
            const request = new Request('http://internal/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    baseUrl: 'https://api.test.com',
                    skills: []
                })
            });

            const response = await registry.fetch(request);
            expect(response.status).toBe(400);

            const result = await jsonResponse(response);
            expect(result.error).toContain('apiName');
        });

        it('should require baseUrl', async () => {
            const request = new Request('http://internal/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'Test API',
                    skills: []
                })
            });

            const response = await registry.fetch(request);
            expect(response.status).toBe(400);

            const result = await jsonResponse(response);
            expect(result.error).toContain('baseUrl');
        });

        it('should require skills', async () => {
            const request = new Request('http://internal/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'Test API',
                    baseUrl: 'https://api.test.com'
                })
            });

            const response = await registry.fetch(request);
            expect(response.status).toBe(400);

            const result = await jsonResponse(response);
            expect(result.error).toContain('skills');
        });

        it('should handle APIs with no operations', async () => {
            const request = new Request('http://internal/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'Empty API',
                    baseUrl: 'https://api.empty.com',
                    skills: []
                })
            });

            const response = await registry.fetch(request);
            expect(response.status).toBe(200);

            const result = await jsonResponse(response);
            expect(result.success).toBe(true);
            expect(result.skillCount).toBe(0);
        });

        it('should store API key securely', async () => {
            const request = new Request('http://internal/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'Secured API',
                    baseUrl: 'https://api.secured.com',
                    skills: [createSkill('secureOp', 'Secure operation')],
                    encryptedApiKey: 'super-secret-key'
                })
            });

            const response = await registry.fetch(request);
            expect(response.status).toBe(200);

            // Verify API was stored
            const listRequest = new Request('http://internal/list', {
                headers: { 'X-User-ID': 'user123' }
            });
            const listResponse = await registry.fetch(listRequest);
            const listResult = await jsonResponse(listResponse);

            expect(listResult.apis).toHaveLength(1);
            expect(listResult.apis[0].apiName).toBe('Secured API');
            expect(listResult.apis[0].skillCount).toBe(1);
        });

        it('should overwrite existing API with same name', async () => {
            // Register first time
            const request1 = new Request('http://internal/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'My API',
                    baseUrl: 'https://api.v1.com',
                    skills: [createSkill('v1Op', 'V1 operation')]
                })
            });

            await registry.fetch(request1);

            // Register again with updated skills
            const request2 = new Request('http://internal/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'My API',
                    baseUrl: 'https://api.v2.com',
                    skills: [
                        createSkill('v2Op1', 'V2 operation 1'),
                        createSkill('v2Op2', 'V2 operation 2')
                    ]
                })
            });

            const response2 = await registry.fetch(request2);
            expect(response2.status).toBe(200);

            // Should only have one API with 2 skills
            const listRequest = new Request('http://internal/list', {
                headers: { 'X-User-ID': 'user123' }
            });
            const listResponse = await registry.fetch(listRequest);
            const listResult = await jsonResponse(listResponse);

            expect(listResult.apis).toHaveLength(1);
            expect(listResult.apis[0].baseUrl).toBe('https://api.v2.com');
            expect(listResult.apis[0].skillCount).toBe(2);
        });
    });

    describe('GET /list - List APIs', () => {
        it('should return empty list when no APIs registered', async () => {
            const request = new Request('http://internal/list', {
                headers: { 'X-User-ID': 'user123' }
            });
            const response = await registry.fetch(request);
            expect(response.status).toBe(200);

            const result = await jsonResponse(response);
            expect(result.apis).toEqual([]);
        });

        it('should list all registered APIs for user', async () => {
            // Register multiple APIs
            const apis = [
                {
                    apiName: 'API One',
                    baseUrl: 'https://api.one.com',
                    skills: [createSkill('op1', 'Operation 1')]
                },
                {
                    apiName: 'API Two',
                    baseUrl: 'https://api.two.com',
                    skills: [createSkill('op2', 'Operation 2')]
                }
            ];

            for (const api of apis) {
                await registry.fetch(new Request('http://internal/register', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-User-ID': 'user123'
                    },
                    body: JSON.stringify(api)
                }));
            }

            const request = new Request('http://internal/list', {
                headers: { 'X-User-ID': 'user123' }
            });
            const response = await registry.fetch(request);
            expect(response.status).toBe(200);

            const result = await jsonResponse(response);
            expect(result.apis).toHaveLength(2);
            expect(result.apis[0].apiName).toBe('API One');
            expect(result.apis[1].apiName).toBe('API Two');
        });

        it('should only return APIs for specified user', async () => {
            // Register API for user1
            await registry.fetch(new Request('http://internal/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user1'
                },
                body: JSON.stringify({
                    apiName: 'User1 API',
                    baseUrl: 'https://api.user1.com',
                    skills: [createSkill('user1Op', 'User 1 operation')]
                })
            }));

            // Register API for user2
            await registry.fetch(new Request('http://internal/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user2'
                },
                body: JSON.stringify({
                    apiName: 'User2 API',
                    baseUrl: 'https://api.user2.com',
                    skills: [createSkill('user2Op', 'User 2 operation')]
                })
            }));

            // List APIs for user1
            const request1 = new Request('http://internal/list', {
                headers: { 'X-User-ID': 'user1' }
            });
            const response1 = await registry.fetch(request1);
            const result1 = await jsonResponse(response1);

            expect(result1.apis).toHaveLength(1);
            expect(result1.apis[0].apiName).toBe('User1 API');

            // List APIs for user2
            const request2 = new Request('http://internal/list', {
                headers: { 'X-User-ID': 'user2' }
            });
            const response2 = await registry.fetch(request2);
            const result2 = await jsonResponse(response2);

            expect(result2.apis).toHaveLength(1);
            expect(result2.apis[0].apiName).toBe('User2 API');
        });
    });

    describe('POST /delete - Delete API', () => {
        it('should delete existing API', async () => {
            // Register API first
            await registry.fetch(new Request('http://internal/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'To Delete',
                    baseUrl: 'https://api.delete.com',
                    skills: [createSkill('deleteOp', 'Delete operation')]
                })
            }));

            // Delete it
            const deleteRequest = new Request('http://internal/delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'To Delete'
                })
            });

            const deleteResponse = await registry.fetch(deleteRequest);
            expect(deleteResponse.status).toBe(200);

            const deleteResult = await jsonResponse(deleteResponse);
            expect(deleteResult.success).toBe(true);

            // Verify it's gone
            const listRequest = new Request('http://internal/list', {
                headers: { 'X-User-ID': 'user123' }
            });
            const listResponse = await registry.fetch(listRequest);
            const listResult = await jsonResponse(listResponse);

            expect(listResult.apis).toHaveLength(0);
        });

        it('should return 404 when deleting non-existent API', async () => {
            const request = new Request('http://internal/delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'Does Not Exist'
                })
            });

            const response = await registry.fetch(request);
            expect(response.status).toBe(404);

            const result = await jsonResponse(response);
            expect(result.error).toContain('not found');
        });

        it('should require apiName', async () => {
            const request = new Request('http://internal/delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({})
            });

            const response = await registry.fetch(request);
            expect(response.status).toBe(400);

            const result = await jsonResponse(response);
            expect(result.error).toContain('apiName');
        });
    });

    describe('POST /get-skills - Get Skills', () => {
        it('should return all skills for user', async () => {
            // Register API with multiple skills
            await registry.fetch(new Request('http://internal/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'Multi Skill API',
                    baseUrl: 'https://api.multi.com',
                    skills: [
                        createSkill('listUsers', 'List users'),
                        createSkill('listPosts', 'List posts')
                    ]
                })
            }));

            const request = new Request('http://internal/get-skills', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({})
            });
            const response = await registry.fetch(request);
            expect(response.status).toBe(200);

            const result = await jsonResponse(response);
            expect(result.apis).toBeDefined();
            expect(result.apis['Multi Skill API']).toBeDefined();
            expect(result.apis['Multi Skill API'].skills).toHaveLength(2);
        });

        it('should return skills for specific API', async () => {
            // Register two APIs
            await registry.fetch(new Request('http://internal/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'API 1',
                    baseUrl: 'https://api.one.com',
                    skills: [createSkill('op1', 'Op 1')],
                    encryptedApiKey: 'key1'
                })
            }));

            await registry.fetch(new Request('http://internal/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'API 2',
                    baseUrl: 'https://api.two.com',
                    skills: [createSkill('op2', 'Op 2')],
                    encryptedApiKey: 'key2'
                })
            }));

            const request = new Request('http://internal/get-skills', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'API 1'
                })
            });
            const response = await registry.fetch(request);
            expect(response.status).toBe(200);

            const result = await jsonResponse(response);
            expect(result.skills).toHaveLength(1);
            expect(result.skills[0].name).toBe('op1');
            expect(result.apiKey).toBe('key1');
            expect(result.baseUrl).toBe('https://api.one.com');
        });

        it('should return empty when no skills', async () => {
            const request = new Request('http://internal/get-skills', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({})
            });
            const response = await registry.fetch(request);
            expect(response.status).toBe(200);

            const result = await jsonResponse(response);
            expect(result.apis).toEqual({});
        });

        it('should return 404 when specific API is missing but user exists', async () => {
            // Seed registry with a different API for the same user so the user record exists
            await registry.fetch(new Request('http://internal/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'Existing',
                    baseUrl: 'https://api.existing.com',
                    skills: [createSkill('existingOp', 'Existing operation')]
                })
            }));

            const request = new Request('http://internal/get-skills', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'Non Existent'
                })
            });
            const response = await registry.fetch(request);
            expect(response.status).toBe(404);

            const result = await jsonResponse(response);
            expect(result.error).toContain('not found');
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid JSON in request body', async () => {
            const request = new Request('http://internal/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: 'invalid json {'
            });

            const response = await registry.fetch(request);
            expect(response.status).toBeGreaterThanOrEqual(400);
        });

        it('should handle unknown routes', async () => {
            const request = new Request('http://internal/unknown-route', {
                headers: { 'X-User-ID': 'user123' }
            });
            const response = await registry.fetch(request);
            expect(response.status).toBe(404);
        });

        it('should handle CORS preflight requests', async () => {
            const request = new Request('http://internal/register', {
                method: 'OPTIONS',
                headers: { 'X-User-ID': 'user123' }
            });
            const response = await registry.fetch(request);
            expect(response.status).toBe(204);
            expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
        });
    });
});
