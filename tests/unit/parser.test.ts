import { describe, it, expect, beforeEach } from 'vitest';
import { detectFormat, parseSpecToCSM } from '../../workers/parser';

describe('Parser - detectFormat', () => {
  it('should detect OpenAPI 3.0 format from JSON string', () => {
    const spec = JSON.stringify({ openapi: '3.0.0', info: { title: 'Test' }, paths: {} });
    const result = detectFormat(spec);
    expect(result).toBe('openapi');
  });

  it('should detect OpenAPI 2.0 (Swagger) format from JSON string', () => {
    const spec = JSON.stringify({ swagger: '2.0', info: { title: 'Test' }, paths: {} });
    const result = detectFormat(spec);
    expect(result).toBe('openapi');
  });

  it('should detect GraphQL format from JSON string', () => {
    const spec = JSON.stringify({ data: { __schema: { queryType: { name: 'Query' } } } });
    const result = detectFormat(spec);
    expect(result).toBe('graphql');
  });

  it('should detect OpenAPI format from YAML string', () => {
    const spec = `openapi: 3.0.0\ninfo:\n  title: Test\npaths: {}`;
    const result = detectFormat(spec);
    expect(result).toBe('openapi');
  });

  it('should detect XML format', () => {
    const spec = '<?xml version="1.0"?><root></root>';
    const result = detectFormat(spec);
    expect(result).toBe('xml');
  });

  it('should return "text" for unknown formats', () => {
    const spec = 'Just some random text content';
    const result = detectFormat(spec);
    expect(result).toBe('text');
  });

  it('should use filename extension as fallback', () => {
    const spec = 'some content';
    expect(detectFormat(spec, 'api.yaml')).toBe('openapi');
    expect(detectFormat(spec, 'schema.graphql')).toBe('graphql');
    expect(detectFormat(spec, 'service.xml')).toBe('xml');
  });
});

describe('Parser - parseSpecToCSM with OpenAPI', () => {
  const mockEnv = {
    AI: {
      run: async () => ({ response: 'Mock AI response' })
    } as any,
    TOOL_REGISTRY: {} as any,
    SESSION_STATE: {} as any,
    ANALYTICS: {
      idFromName: () => ({ toString: () => 'analytics-id' }),
      get: () => ({ fetch: async () => new Response(JSON.stringify({ success: true })) })
    } as any
  };

  it('should parse OpenAPI 3.0 spec with GET endpoint', async () => {
    const spec = {
      openapi: '3.0.0',
      info: {
        title: 'Pet Store API',
        version: '1.0.0',
        description: 'A simple pet store API'
      },
      paths: {
        '/pets': {
          get: {
            summary: 'List all pets',
            operationId: 'listPets',
            responses: {
              '200': {
                description: 'Success'
              }
            }
          }
        }
      }
    };

    const result = await parseSpecToCSM(JSON.stringify(spec), 'openapi.json', mockEnv);

    expect(result.format).toBe('openapi');
    expect(result.csm.name).toBe('Pet Store API');
    expect(result.csm.version).toBe('1.0.0');
    expect(result.csm.summary).toBe('A simple pet store API');
    expect(result.csm.endpoints).toHaveLength(1);
    expect(result.csm.endpoints[0].method).toBe('GET');
    expect(result.csm.endpoints[0].path).toBe('/pets');
    expect(result.csm.endpoints[0].description).toBe('List all pets');
  });

  it('should parse multiple HTTP methods', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'API', version: '1.0.0' },
      paths: {
        '/users': {
          get: { summary: 'Get users' },
          post: { summary: 'Create user' },
          put: { summary: 'Update user' },
          delete: { summary: 'Delete user' }
        }
      }
    };

    const result = await parseSpecToCSM(JSON.stringify(spec), 'api.json', mockEnv);
    expect(result.csm.endpoints).toHaveLength(4);
    expect(result.csm.endpoints.map((e: any) => e.method)).toEqual(['GET', 'POST', 'PUT', 'DELETE']);
  });

  it('should parse OpenAPI YAML format', async () => {
    const yamlSpec = `openapi: 3.0.0
info:
  title: YAML API
  version: 1.0.0
paths:
  /health:
    get:
      summary: Health check`;

    const result = await parseSpecToCSM(yamlSpec, 'api.yaml', mockEnv);
    expect(result.format).toBe('openapi');
    expect(result.csm.name).toBe('YAML API');
    expect(result.csm.endpoints.length).toBeGreaterThan(0);
  });

  it('should merge path-level parameters with operation-level overrides', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Params API' },
      paths: {
        '/items/{itemId}': {
          parameters: [
            {
              name: 'itemId',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            },
            {
              name: 'locale',
              in: 'query',
              schema: { type: 'string' }
            }
          ],
          get: {
            parameters: [
              {
                name: 'locale',
                in: 'query',
                required: true,
                schema: { type: 'string' }
              },
              {
                name: 'filter',
                in: 'query',
                schema: { type: 'string' }
              }
            ],
            responses: {}
          }
        }
      }
    };

    const result = await parseSpecToCSM(JSON.stringify(spec), 'params.json', mockEnv);
    const endpoint = result.csm.endpoints[0];

    expect(endpoint.pathParams).toEqual(['itemId']);
    expect(endpoint.query).toMatchObject({
      locale: { required: true },
      filter: { required: undefined }
    });
  });

  it('should respect security overrides when determining authRequired', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Security API' },
      components: {
        securitySchemes: {
          ApiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key'
          }
        }
      },
      security: [{ ApiKeyAuth: [] }],
      paths: {
        '/public': {
          get: {
            security: [],
            responses: {}
          }
        },
        '/private': {
          get: {
            responses: {}
          }
        }
      }
    };

    const result = await parseSpecToCSM(JSON.stringify(spec), 'security.json', mockEnv);
    const publicEndpoint = result.csm.endpoints.find((ep: any) => ep.path === '/public');
    const privateEndpoint = result.csm.endpoints.find((ep: any) => ep.path === '/private');

    expect(publicEndpoint?.authRequired).toBe(false);
    expect(privateEndpoint?.authRequired).toBe(true);
  });
});

describe('Parser - parseSpecToCSM with GraphQL', () => {
  const mockEnv = {
    AI: {
      run: async () => ({ response: 'Mock AI response' })
    } as any,
    TOOL_REGISTRY: {} as any,
    SESSION_STATE: {} as any,
    ANALYTICS: {
      idFromName: () => ({ toString: () => 'analytics-id' }),
      get: () => ({ fetch: async () => new Response(JSON.stringify({ success: true })) })
    } as any
  };

  it('should parse GraphQL introspection with queries', async () => {
    const schema = {
      data: {
        __schema: {
          queryType: { name: 'Query' },
          types: [
            {
              name: 'Query',
              kind: 'OBJECT',
              fields: [
                {
                  name: 'users',
                  description: 'Get all users',
                  args: []
                },
                {
                  name: 'user',
                  description: 'Get user by ID',
                  args: [{ name: 'id', type: { name: 'ID' } }]
                }
              ]
            }
          ]
        }
      }
    };

    const result = await parseSpecToCSM(JSON.stringify(schema), 'schema.graphql', mockEnv);

    expect(result.format).toBe('graphql');
    expect(result.csm.name).toBe('GraphQL API');
    expect(result.csm.endpoints.length).toBeGreaterThanOrEqual(2);
    const queryEndpoint = result.csm.endpoints.find((e: any) => e.description?.includes('users'));
    expect(queryEndpoint).toBeDefined();
    expect(queryEndpoint?.method).toBe('POST');
  });

  it('should parse mutations', async () => {
    const schema = {
      data: {
        __schema: {
          queryType: { name: 'Query' },
          mutationType: { name: 'Mutation' },
          types: [
            {
              name: 'Query',
              kind: 'OBJECT',
              fields: []
            },
            {
              name: 'Mutation',
              kind: 'OBJECT',
              fields: [
                {
                  name: 'createUser',
                  description: 'Create a new user',
                  args: [
                    { name: 'name', type: { name: 'String' } },
                    { name: 'email', type: { name: 'String' } }
                  ]
                }
              ]
            }
          ]
        }
      }
    };

    const result = await parseSpecToCSM(JSON.stringify(schema), 'schema.graphql', mockEnv);
    const mutationEndpoint = result.csm.endpoints.find((e: any) => e.description?.includes('createUser'));
    expect(mutationEndpoint).toBeDefined();
    expect(mutationEndpoint?.description).toContain('createUser');
  });
});

describe('Parser - parseSpecToCSM edge cases', () => {
  const mockEnv = {
    AI: {
      run: async () => ({ 
        response: JSON.stringify({
          name: 'Inferred API',
          endpoints: [{ id: 'ep0', method: 'GET', path: '/', description: 'Inferred endpoint' }]
        })
      })
    } as any,
    TOOL_REGISTRY: {} as any,
    SESSION_STATE: {} as any,
    ANALYTICS: {
      idFromName: () => ({ toString: () => 'analytics-id' }),
      get: () => ({ fetch: async () => new Response(JSON.stringify({ success: true })) })
    } as any
  };

  it('should handle plain text with AI inference', async () => {
    const plainText = 'This is a simple REST API for managing users';

    const result = await parseSpecToCSM(plainText, 'readme.txt', mockEnv);

    expect(result.format).toBe('text');
    expect(result.csm).toBeDefined();
    expect(result.csm.endpoints.length).toBeGreaterThan(0);
  });

  it('should handle invalid JSON gracefully', async () => {
    const invalidJson = '{ invalid json }';

    const result = await parseSpecToCSM(invalidJson, 'invalid.json', mockEnv);

    // Should fallback to text parsing with AI
    expect(result).toBeDefined();
    expect(result.csm).toBeDefined();
    expect(result.logs).toBeDefined();
  });

  it('should add placeholder endpoint if none found', async () => {
    const emptySpec = {
      openapi: '3.0.0',
      info: { title: 'Empty API' },
      paths: {}
    };

    const result = await parseSpecToCSM(JSON.stringify(emptySpec), 'empty.json', mockEnv);

    expect(result.csm.endpoints.length).toBeGreaterThan(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
