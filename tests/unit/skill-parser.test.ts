import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseOpenAPIToSkills, skillsToAIToolSchemas, executeSkill } from '../../workers/skill-parser';
import type { SkillDefinition } from '../../workers/durable_objects/SkillRegistry';

describe('skill-parser.ts - OpenAPI Parsing', () => {
  describe('parseOpenAPIToSkills', () => {
    it('should parse a valid OpenAPI spec', () => {
      const spec = {
        openapi: '3.0.0',
        info: {
          title: 'Pet Store API',
          version: '1.0.0',
          description: 'A simple pet store API'
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
                  required: false,
                  description: 'Max number of pets to return'
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

      const result = parseOpenAPIToSkills(spec);

      expect(result.skills).toHaveLength(2);
      expect(result.baseUrl).toBe('https://api.petstore.com');
      expect(result.metadata.title).toBe('Pet Store API');
      
      expect(result.skills[0]).toMatchObject({
        name: 'listPets',
        description: 'List all pets',
        method: 'GET',
        path: '/pets',
        baseUrl: 'https://api.petstore.com'
      });
      expect(result.skills[0].parameters).toHaveLength(1);
      expect(result.skills[0].parameters[0]).toMatchObject({
        name: 'limit',
        in: 'query',
        type: 'integer',
        required: false
      });

      expect(result.skills[1]).toMatchObject({
        name: 'getPetById',
        description: 'Get pet by ID',
        method: 'GET',
        path: '/pets/{petId}',
        baseUrl: 'https://api.petstore.com'
      });
      expect(result.skills[1].parameters).toHaveLength(1);
      expect(result.skills[1].parameters[0]).toMatchObject({
        name: 'petId',
        in: 'path',
        required: true
      });
    });

    it('should handle multiple HTTP methods on same path', () => {
      const spec = {
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0.0' },
        servers: [{ url: 'https://api.test.com' }],
        paths: {
          '/items': {
            get: {
              operationId: 'listItems',
              summary: 'List items'
            },
            post: {
              operationId: 'createItem',
              summary: 'Create item',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      };

      const result = parseOpenAPIToSkills(spec);

      expect(result.skills).toHaveLength(2);
      expect(result.skills[0].method).toBe('GET');
      expect(result.skills[0].name).toBe('listItems');
      expect(result.skills[1].method).toBe('POST');
      expect(result.skills[1].name).toBe('createItem');
      expect(result.skills[1].requestBody).toBeDefined();
    });

    it('should use empty baseUrl when servers not specified', () => {
      const spec = {
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {
          '/test': {
            get: {
              operationId: 'testOp',
              summary: 'Test operation'
            }
          }
        }
      };

      const result = parseOpenAPIToSkills(spec);

      expect(result.skills).toHaveLength(1);
      expect(result.baseUrl).toBe('');
    });

    it('should handle specs with no paths', () => {
      const spec = {
        openapi: '3.0.0',
        info: { title: 'Empty API', version: '1.0.0' },
        paths: {}
      };

      const result = parseOpenAPIToSkills(spec);

      expect(result.skills).toHaveLength(0);
    });

    it('should handle Swagger 2.0 specs with host and basePath', () => {
      const spec = {
        swagger: '2.0',
        info: { title: 'Legacy API', version: '1.0.0' },
        host: 'api.legacy.com',
        basePath: '/v1',
        schemes: ['https'],
        paths: {
          '/users': {
            get: {
              operationId: 'listUsers',
              summary: 'List users'
            }
          }
        }
      };

      const result = parseOpenAPIToSkills(spec);

      expect(result.skills).toHaveLength(1);
      expect(result.baseUrl).toBe('https://api.legacy.com/v1');
    });
  });
});

describe('skill-parser.ts - AI Tool Schema Conversion', () => {
  describe('skillsToAIToolSchemas', () => {
    it('should convert skills to AI function schemas', () => {
      const skills: SkillDefinition[] = [
        {
          name: 'listPets',
          description: 'List all pets',
          operationId: 'listPets',
          method: 'GET',
          path: '/pets',
          baseUrl: 'https://api.petstore.com',
          parameters: [
            {
              name: 'limit',
              in: 'query',
              type: 'integer',
              required: false,
              description: 'Max number of pets'
            }
          ]
        },
        {
          name: 'getPetById',
          description: 'Get pet by ID',
          operationId: 'getPetById',
          method: 'GET',
          path: '/pets/{petId}',
          baseUrl: 'https://api.petstore.com',
          parameters: [
            {
              name: 'petId',
              in: 'path',
              type: 'string',
              required: true,
              description: 'Pet ID'
            }
          ]
        }
      ];

      const schemas = skillsToAIToolSchemas(skills);

      expect(schemas).toHaveLength(2);
      
      expect(schemas[0]).toMatchObject({
        type: 'function',
        function: {
          name: 'listPets',
          description: expect.stringContaining('List all pets'),
          parameters: {
            type: 'object',
            properties: {
              limit: {
                type: 'integer',
                description: expect.any(String)
              }
            },
            required: []
          }
        }
      });

      expect(schemas[1]).toMatchObject({
        type: 'function',
        function: {
          name: 'getPetById',
          description: expect.stringContaining('Get pet by ID'),
          parameters: {
            type: 'object',
            properties: {
              petId: {
                type: 'string',
                description: expect.any(String)
              }
            },
            required: ['petId']
          }
        }
      });
    });

    it('should handle skills with no parameters', () => {
      const skills: SkillDefinition[] = [
        {
          name: 'healthCheck',
          description: 'Check API health',
          operationId: 'healthCheck',
          method: 'GET',
          path: '/health',
          baseUrl: 'https://api.test.com',
          parameters: []
        }
      ];

      const schemas = skillsToAIToolSchemas(skills);

      expect(schemas).toHaveLength(1);
      expect(schemas[0].function.parameters).toMatchObject({
        type: 'object',
        properties: {},
        required: []
      });
    });

    it('should handle requestBody in schema', () => {
      const skills: SkillDefinition[] = [
        {
          name: 'createPet',
          description: 'Create a new pet',
          operationId: 'createPet',
          method: 'POST',
          path: '/pets',
          baseUrl: 'https://api.petstore.com',
          parameters: [],
          requestBody: {
            required: true,
            contentType: 'application/json',
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Pet name' },
                age: { type: 'integer', description: 'Pet age' }
              },
              required: ['name']
            }
          }
        }
      ];

      const schemas = skillsToAIToolSchemas(skills);

      expect(schemas).toHaveLength(1);
      expect(schemas[0].function.parameters.properties).toMatchObject({
        body: {
          type: 'object',
          description: 'Request body data'
        }
      });
      expect(schemas[0].function.parameters.required).toContain('body');
    });
  });
});

describe('skill-parser.ts - Skill Execution', () => {
  describe('executeSkill', () => {
    beforeEach(() => {
      globalThis.fetch = vi.fn() as any;
    });

    it('should execute GET request without parameters', async () => {
      const skill: SkillDefinition = {
        name: 'listPets',
        description: 'List pets',
        operationId: 'listPets',
        method: 'GET',
        path: '/pets',
        baseUrl: 'https://api.petstore.com',
        parameters: []
      };

      const params = {};

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: () => 'application/json'
        },
        json: async () => [{ id: 1, name: 'Fluffy' }]
      });

      const result = await executeSkill(skill, params);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.petstore.com/pets',
        expect.objectContaining({
          method: 'GET',
          headers: expect.any(Object)
        })
      );

      expect(result).toMatchObject({
        success: true,
        result: [{ id: 1, name: 'Fluffy' }]
      });
    });

    it('should execute GET request with path parameters', async () => {
      const skill: SkillDefinition = {
        name: 'getPetById',
        description: 'Get pet by ID',
        operationId: 'getPetById',
        method: 'GET',
        path: '/pets/{petId}',
        baseUrl: 'https://api.petstore.com',
        parameters: [
          {
            name: 'petId',
            in: 'path',
            type: 'string',
            required: true
          }
        ]
      };

      const params = { petId: '123' };

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: () => 'application/json'
        },
        json: async () => ({ id: 123, name: 'Fluffy' })
      });

      const result = await executeSkill(skill, params);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.petstore.com/pets/123',
        expect.objectContaining({
          method: 'GET'
        })
      );

      expect(result).toMatchObject({
        success: true,
        result: { id: 123, name: 'Fluffy' }
      });
    });

    it('should execute POST request with body', async () => {
      const skill: SkillDefinition = {
        name: 'createPet',
        description: 'Create pet',
        operationId: 'createPet',
        method: 'POST',
        path: '/pets',
        baseUrl: 'https://api.petstore.com',
        parameters: [],
        requestBody: {
          required: true,
          contentType: 'application/json',
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              age: { type: 'integer' }
            }
          }
        }
      };

      const params = { name: 'Max', age: 3 };

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: {
          get: () => 'application/json'
        },
        json: async () => ({ id: 456, name: 'Max', age: 3 })
      });

      const result = await executeSkill(skill, params);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.petstore.com/pets',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify({ name: 'Max', age: 3 })
        })
      );

      expect(result).toMatchObject({
        success: true,
        result: { id: 456, name: 'Max', age: 3 }
      });
    });

    it('should include API key in Authorization header', async () => {
      const skill: SkillDefinition = {
        name: 'secureOp',
        description: 'Secure operation',
        operationId: 'secureOp',
        method: 'GET',
        path: '/secure',
        baseUrl: 'https://api.secured.com',
        parameters: []
      };

      const params = {};
      const apiKey = 'secret-key-123';

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: () => 'application/json'
        },
        json: async () => ({ secure: 'data' })
      });

      const result = await executeSkill(skill, params, apiKey);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.secured.com/secure',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer secret-key-123'
          })
        })
      );

      expect(result.success).toBe(true);
    });

    it('should handle HTTP errors gracefully', async () => {
      const skill: SkillDefinition = {
        name: 'errorOp',
        description: 'Operation that fails',
        operationId: 'errorOp',
        method: 'GET',
        path: '/error',
        baseUrl: 'https://api.test.com',
        parameters: []
      };

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: {
          get: () => 'text/plain'
        },
        text: async () => 'Resource not found'
      });

      const result = await executeSkill(skill, {});

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('404')
      });
    });

    it('should handle network errors', async () => {
      const skill: SkillDefinition = {
        name: 'networkError',
        description: 'Operation with network error',
        operationId: 'networkError',
        method: 'GET',
        path: '/test',
        baseUrl: 'https://api.test.com',
        parameters: []
      };

      (globalThis.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      const result = await executeSkill(skill, {});

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('Network error')
      });
    });

    it('should handle multiple path parameters', async () => {
      const skill: SkillDefinition = {
        name: 'getResource',
        description: 'Get nested resource',
        operationId: 'getResource',
        method: 'GET',
        path: '/users/{userId}/posts/{postId}',
        baseUrl: 'https://api.test.com',
        parameters: [
          {
            name: 'userId',
            in: 'path',
            type: 'string',
            required: true
          },
          {
            name: 'postId',
            in: 'path',
            type: 'string',
            required: true
          }
        ]
      };

      const params = { userId: 'user123', postId: 'post456' };

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: () => 'application/json'
        },
        json: async () => ({ post: 'data' })
      });

      const result = await executeSkill(skill, params);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.test.com/users/user123/posts/post456',
        expect.any(Object)
      );

      expect(result.success).toBe(true);
    });

    it('should handle query parameters', async () => {
      const skill: SkillDefinition = {
        name: 'searchPosts',
        description: 'Search posts',
        operationId: 'searchPosts',
        method: 'GET',
        path: '/posts',
        baseUrl: 'https://api.test.com',
        parameters: [
          {
            name: 'q',
            in: 'query',
            type: 'string',
            required: false
          },
          {
            name: 'limit',
            in: 'query',
            type: 'integer',
            required: false
          }
        ]
      };

      const params = { q: 'test', limit: 10 };

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: () => 'application/json'
        },
        json: async () => ({ posts: [] })
      });

      const result = await executeSkill(skill, params);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.test.com/posts?q=test&limit=10',
        expect.any(Object)
      );

      expect(result.success).toBe(true);
    });

    it('should handle mixed path and query parameters', async () => {
      const skill: SkillDefinition = {
        name: 'mixedParams',
        description: 'Operation with mixed parameters',
        operationId: 'mixedParams',
        method: 'GET',
        path: '/users/{userId}/posts',
        baseUrl: 'https://api.test.com',
        parameters: [
          {
            name: 'userId',
            in: 'path',
            type: 'string',
            required: true
          },
          {
            name: 'limit',
            in: 'query',
            type: 'integer',
            required: false
          },
          {
            name: 'sort',
            in: 'query',
            type: 'string',
            required: false
          }
        ]
      };

      const params = { userId: 'user123', limit: 5, sort: 'desc' };

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: () => 'application/json'
        },
        json: async () => ({ posts: [] })
      });

      const result = await executeSkill(skill, params);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.test.com/users/user123/posts?limit=5&sort=desc',
        expect.any(Object)
      );

      expect(result.success).toBe(true);
    });
  });
});
