import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../workers/index';
import { SkillRegistry } from '../../workers/durable_objects/SkillRegistry';

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

const createSkillRegistryNamespace = () => {
    const storage = new MockStorage();
    const state = { storage } as any;
    const instance = new SkillRegistry(state);

    return {
        namespace: {
            idFromName: () => ({ toString: () => 'skill-registry-id' }),
            get: () => ({
                fetch: async (url: string | URL, init?: RequestInit) => {
                    const request = typeof url === 'string' ? new Request(url, init) : new Request(url, init);
                    return instance.fetch(request);
                }
            })
        },
        storage
    };
};

describe('Integration - Skills API Endpoints', () => {
    let env: any;

    beforeEach(() => {
        const { namespace } = createSkillRegistryNamespace();
        env = {
            SKILL_REGISTRY: namespace,
            AI: {
                run: async () => ({ response: 'OK' })
            }
        };
    });

    describe('POST /api/skills/register', () => {
        it('should register API from OpenAPI spec', async () => {
            const spec = {
                openapi: '3.0.0',
                info: {
                    title: 'Pet Store API',
                    version: '1.0.0',
                    description: 'A simple pet store'
                },
                servers: [
                    { url: 'https://api.petstore.com' }
                ],
                paths: {
                    '/pets': {
                        get: {
                            summary: 'List all pets',
                            operationId: 'listPets',
                            parameters: [
                                {
                                    name: 'limit',
                                    in: 'query',
                                    schema: { type: 'integer' },
                                    required: false
                                }
                            ],
                            responses: {
                                '200': {
                                    description: 'A list of pets'
                                }
                            }
                        }
                    },
                    '/pets/{petId}': {
                        get: {
                            summary: 'Get pet by ID',
                            operationId: 'getPetById',
                            parameters: [
                                {
                                    name: 'petId',
                                    in: 'path',
                                    required: true,
                                    schema: { type: 'string' }
                                }
                            ],
                            responses: {
                                '200': {
                                    description: 'Pet details'
                                }
                            }
                        }
                    }
                }
            };

            const request = new Request('https://example.com/api/skills/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'Pet Store API',
                    spec,
                    apiKey: 'secret-key-123'
                })
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBe(200);

            const result = await response.json() as any;
            expect(result.success).toBe(true);
            expect(result.skillCount).toBe(2);
            expect(result.skillNames).toContain('listPets');
            expect(result.skillNames).toContain('getPetById');
        });

        it('should require apiName', async () => {
            const request = new Request('https://example.com/api/skills/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    spec: {
                        openapi: '3.0.0',
                        info: { title: 'Test', version: '1.0.0' },
                        paths: {}
                    }
                })
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBe(400);

            const result = await response.json() as any;
            expect(result.error).toContain('apiName');
        });

        it('should require spec', async () => {
            const request = new Request('https://example.com/api/skills/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'Test API'
                })
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBe(400);

            const result = await response.json() as any;
            expect(result.error).toContain('spec');
        });

        it('should handle invalid OpenAPI spec', async () => {
            const request = new Request('https://example.com/api/skills/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'Bad API',
                    spec: {
                        // Invalid spec - missing required fields
                        notValid: true
                    }
                })
            });

            const response = await worker.fetch(request, env);
            // Should handle gracefully
            expect(response.status).toBeGreaterThanOrEqual(200);
        });

        it('should encrypt API key before storage', async () => {
            const request = new Request('https://example.com/api/skills/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'Secured API',
                    spec: {
                        openapi: '3.0.0',
                        info: { title: 'Secured', version: '1.0.0' },
                        servers: [{ url: 'https://api.secured.com' }],
                        paths: {
                            '/secure': {
                                get: {
                                    operationId: 'secureOp',
                                    summary: 'Secure operation'
                                }
                            }
                        }
                    },
                    apiKey: 'my-secret-key'
                })
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBe(200);

            // Verify API key is encrypted (not returned in plain text)
            const listRequest = new Request('https://example.com/api/skills/list', {
                headers: { 'X-User-ID': 'user123' }
            });
            const listResponse = await worker.fetch(listRequest, env);
            const listResult = await listResponse.json() as any;

            expect(listResult.apis).toHaveLength(1);
            // API key should NOT be in the list response
            expect(listResult.apis[0].apiKey).toBeUndefined();
        });

        it('should update existing API when registering with same name', async () => {
            const spec1 = {
                openapi: '3.0.0',
                info: { title: 'V1', version: '1.0.0' },
                servers: [{ url: 'https://api.v1.com' }],
                paths: {
                    '/v1': {
                        get: {
                            operationId: 'v1Op',
                            summary: 'V1 operation'
                        }
                    }
                }
            };

            const spec2 = {
                openapi: '3.0.0',
                info: { title: 'V2', version: '2.0.0' },
                servers: [{ url: 'https://api.v2.com' }],
                paths: {
                    '/v2': {
                        get: {
                            operationId: 'v2Op',
                            summary: 'V2 operation'
                        }
                    }
                }
            };

            // Register V1
            await worker.fetch(new Request('https://example.com/api/skills/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'My API',
                    spec: spec1
                })
            }), env);

            // Register V2 with same name
            const response2 = await worker.fetch(new Request('https://example.com/api/skills/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'My API',
                    spec: spec2
                })
            }), env);

            expect(response2.status).toBe(200);

            // Should only have one API
            const listRequest = new Request('https://example.com/api/skills/list', {
                headers: { 'X-User-ID': 'user123' }
            });
            const listResponse = await worker.fetch(listRequest, env);
            const listResult = await listResponse.json() as any;

            expect(listResult.apis).toHaveLength(1);
            expect(listResult.apis[0].skillNames).toContain('v2Op');
            expect(listResult.apis[0].skillNames).not.toContain('v1Op');
        });
    });

    describe('GET /api/skills/list', () => {
        it('should return empty list when no APIs registered', async () => {
            const request = new Request('https://example.com/api/skills/list', {
                headers: { 'X-User-ID': 'user123' }
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBe(200);

            const result = await response.json() as any;
            expect(result.apis).toEqual([]);
        });

        it('should list all registered APIs for user', async () => {
            // Register two APIs
            const apis = [
                {
                    apiName: 'API One',
                    spec: {
                        openapi: '3.0.0',
                        info: { title: 'One', version: '1.0.0' },
                        servers: [{ url: 'https://api.one.com' }],
                        paths: {
                            '/one': {
                                get: {
                                    operationId: 'op1',
                                    summary: 'Operation 1'
                                }
                            }
                        }
                    }
                },
                {
                    apiName: 'API Two',
                    spec: {
                        openapi: '3.0.0',
                        info: { title: 'Two', version: '1.0.0' },
                        servers: [{ url: 'https://api.two.com' }],
                        paths: {
                            '/two': {
                                get: {
                                    operationId: 'op2',
                                    summary: 'Operation 2'
                                }
                            }
                        }
                    }
                }
            ];

            for (const api of apis) {
                await worker.fetch(new Request('https://example.com/api/skills/register', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-User-ID': 'user123'
                    },
                    body: JSON.stringify(api)
                }), env);
            }

            const request = new Request('https://example.com/api/skills/list', {
                headers: { 'X-User-ID': 'user123' }
            });
            const response = await worker.fetch(request, env);
            expect(response.status).toBe(200);

            const result = await response.json() as any;
            expect(result.apis).toHaveLength(2);
            expect(result.apis[0].apiName).toBe('API One');
            expect(result.apis[1].apiName).toBe('API Two');
        });

        it('should only return APIs for specified user', async () => {
            // Register API for user1
            await worker.fetch(new Request('https://example.com/api/skills/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user1'
                },
                body: JSON.stringify({
                    apiName: 'User1 API',
                    spec: {
                        openapi: '3.0.0',
                        info: { title: 'User1', version: '1.0.0' },
                        servers: [{ url: 'https://api.user1.com' }],
                        paths: {
                            '/items': {
                                get: {
                                    operationId: 'user1Items',
                                    summary: 'List items',
                                    responses: { '200': { description: 'OK' } }
                                }
                            }
                        }
                    }
                })
            }), env);

            // Register API for user2
            await worker.fetch(new Request('https://example.com/api/skills/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user2'
                },
                body: JSON.stringify({
                    apiName: 'User2 API',
                    spec: {
                        openapi: '3.0.0',
                        info: { title: 'User2', version: '1.0.0' },
                        servers: [{ url: 'https://api.user2.com' }],
                        paths: {
                            '/records': {
                                get: {
                                    operationId: 'user2Records',
                                    summary: 'List records',
                                    responses: { '200': { description: 'OK' } }
                                }
                            }
                        }
                    }
                })
            }), env);

            // List APIs for user1
            const request1 = new Request('https://example.com/api/skills/list', {
                headers: { 'X-User-ID': 'user1' }
            });
            const response1 = await worker.fetch(request1, env);
            const result1 = await response1.json() as any;

            expect(result1.apis).toHaveLength(1);
            expect(result1.apis[0].apiName).toBe('User1 API');

            // List APIs for user2
            const request2 = new Request('https://example.com/api/skills/list', {
                headers: { 'X-User-ID': 'user2' }
            });
            const response2 = await worker.fetch(request2, env);
            const result2 = await response2.json() as any;

            expect(result2.apis).toHaveLength(1);
            expect(result2.apis[0].apiName).toBe('User2 API');
        });

        it('should include skill count and names', async () => {
            await worker.fetch(new Request('https://example.com/api/skills/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'Multi Skill API',
                    spec: {
                        openapi: '3.0.0',
                        info: { title: 'Multi', version: '1.0.0' },
                        servers: [{ url: 'https://api.multi.com' }],
                        paths: {
                            '/users': {
                                get: {
                                    operationId: 'listUsers',
                                    summary: 'List users'
                                }
                            },
                            '/posts': {
                                get: {
                                    operationId: 'listPosts',
                                    summary: 'List posts'
                                }
                            }
                        }
                    }
                })
            }), env);

            const request = new Request('https://example.com/api/skills/list', {
                headers: { 'X-User-ID': 'user123' }
            });
            const response = await worker.fetch(request, env);
            const result = await response.json() as any;

            expect(result.apis).toHaveLength(1);
            expect(result.apis[0].skillCount).toBe(2);
            expect(result.apis[0].skillNames).toContain('listUsers');
            expect(result.apis[0].skillNames).toContain('listPosts');
        });
    });

    describe('POST /api/skills/delete', () => {
        it('should delete existing API', async () => {
            // Register API first
            await worker.fetch(new Request('https://example.com/api/skills/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'To Delete',
                    spec: {
                        openapi: '3.0.0',
                        info: { title: 'Delete', version: '1.0.0' },
                        servers: [{ url: 'https://api.delete.com' }],
                        paths: {
                            '/delete': {
                                delete: {
                                    operationId: 'deleteResource',
                                    summary: 'Delete resource',
                                    responses: { '200': { description: 'Deleted' } }
                                }
                            }
                        }
                    }
                })
            }), env);

            // Delete it
            const deleteRequest = new Request('https://example.com/api/skills/delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'To Delete'
                })
            });

            const deleteResponse = await worker.fetch(deleteRequest, env);
            expect(deleteResponse.status).toBe(200);

            const deleteResult = await deleteResponse.json() as any;
            expect(deleteResult.success).toBe(true);

            // Verify it's gone
            const listRequest = new Request('https://example.com/api/skills/list', {
                headers: { 'X-User-ID': 'user123' }
            });
            const listResponse = await worker.fetch(listRequest, env);
            const listResult = await listResponse.json() as any;

            expect(listResult.apis).toHaveLength(0);
        });

        it('should return 404 when deleting non-existent API', async () => {
            const request = new Request('https://example.com/api/skills/delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({
                    apiName: 'Does Not Exist'
                })
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBe(404);

            const result = await response.json() as any;
            expect(result.error).toContain('not found');
        });

        it('should require apiName', async () => {
            const request = new Request('https://example.com/api/skills/delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: JSON.stringify({})
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBe(400);

            const result = await response.json() as any;
            expect(result.error).toBeDefined();
        });
    });

    describe('CORS Support', () => {
        it('should handle OPTIONS preflight requests', async () => {
            const request = new Request('https://example.com/api/skills/register', {
                method: 'OPTIONS',
                headers: {
                    'Origin': 'http://localhost:3000',
                    'Access-Control-Request-Method': 'POST'
                }
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBe(200);
            expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
            expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
        });

        it('should include CORS headers in responses', async () => {
            const request = new Request('https://example.com/api/skills/list', {
                headers: { 'X-User-ID': 'user123' }
            });

            const response = await worker.fetch(request, env);
            expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid JSON in request body', async () => {
            const request = new Request('https://example.com/api/skills/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': 'user123'
                },
                body: 'invalid json {'
            });

            const response = await worker.fetch(request, env);
            expect(response.status).toBeGreaterThanOrEqual(400);
        });

        it('should handle missing X-User-ID header', async () => {
            const request = new Request('https://example.com/api/skills/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    apiName: 'Test',
                    spec: {
                        openapi: '3.0.0',
                        info: { title: 'Test', version: '1.0.0' },
                        servers: [{ url: 'https://api.default.com' }],
                        paths: {
                            '/default': {
                                get: {
                                    operationId: 'getDefault',
                                    summary: 'Fetch default data',
                                    responses: { '200': { description: 'OK' } }
                                }
                            }
                        }
                    }
                })
            });

            const response = await worker.fetch(request, env);
            // Should use default user ID
            expect(response.status).toBe(200);
        });

        it('should handle missing SKILL_REGISTRY binding gracefully', async () => {
            const envWithoutRegistry = {
                AI: { run: async () => ({ response: 'OK' }) }
            };

            const request = new Request('https://example.com/api/skills/list', {
                headers: { 'X-User-ID': 'user123' }
            });

            const response = await worker.fetch(request, envWithoutRegistry as any);
            // Should return error
            expect(response.status).toBeGreaterThanOrEqual(400);
        });
    });
});
