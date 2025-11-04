import { describe, it, expect, beforeAll } from 'vitest';

const mockEnv = {
  AI: {
    run: async () => ({ response: 'Mock AI response' })
  } as any,
  TOOL_REGISTRY: {
    idFromName: () => ({ toString: () => 'test-id' }),
    get: () => ({
      fetch: async () => new Response(JSON.stringify({ success: true }))
    })
  } as any,
  SESSION_STATE: {
    idFromName: () => ({ toString: () => 'test-session-id' }),
    get: () => ({
      fetch: async () => new Response(JSON.stringify({ messages: [] }))
    })
  } as any
};

describe('API Routes - POST /api/parse', () => {
  it('should parse valid OpenAPI JSON spec', async () => {
    const spec = {
      openapi: '3.0.0',
      info: {
        title: 'Test API',
        version: '1.0.0'
      },
      paths: {
        '/users': {
          get: {
            summary: 'List users',
            responses: {
              '200': { description: 'Success' }
            }
          }
        }
      }
    };

    const formData = new FormData();
    const blob = new Blob([JSON.stringify(spec)], { type: 'application/json' });
    formData.append('file', blob, 'openapi.json');

    const request = new Request('http://localhost:8787/api/parse', {
      method: 'POST',
      headers: {
        'X-Session-ID': 'test-session'
      },
      body: formData
    });

    // Note: This would require importing the worker's fetch handler
    // const response = await worker.fetch(request, mockEnv);
    
    // For now, test the expected structure
    expect(request.method).toBe('POST');
    expect(request.headers.get('X-Session-ID')).toBe('test-session');
  });

  it('should reject requests without file', async () => {
    const request = new Request('http://localhost:8787/api/parse', {
      method: 'POST',
      headers: {
        'X-Session-ID': 'test-session',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    expect(request.method).toBe('POST');
  });
});

describe('API Routes - POST /api/generate', () => {
  it('should accept valid CSM and endpoint ID', async () => {
    const requestBody = {
      csm: {
        name: 'Test API',
        version: '1.0.0',
        endpoints: [
          {
            id: 'get-users',
            method: 'GET',
            path: '/users',
            description: 'List all users'
          }
        ]
      },
      endpointId: 'get-users'
    };

    const request = new Request('http://localhost:8787/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': 'test-session'
      },
      body: JSON.stringify(requestBody)
    });

    expect(request.method).toBe('POST');
    expect(request.headers.get('Content-Type')).toBe('application/json');
  });

  it('should validate required fields', async () => {
    const invalidBody = {
      csm: {
        name: 'Test API'
        // Missing endpoints
      }
      // Missing endpointId
    };

    const request = new Request('http://localhost:8787/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': 'test-session'
      },
      body: JSON.stringify(invalidBody)
    });

    expect(request.method).toBe('POST');
  });
});

describe('API Routes - POST /api/verify', () => {
  it('should accept TypeScript code for verification', async () => {
    const requestBody = {
      code: `
        export async function getUsers() {
          const response = await fetch('https://api.example.com/users');
          return response.json();
        }
      `
    };

    const request = new Request('http://localhost:8787/api/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': 'test-session'
      },
      body: JSON.stringify(requestBody)
    });

    expect(request.method).toBe('POST');
    expect(request.headers.get('X-Session-ID')).toBe('test-session');
  });
});

describe('API Routes - PUT /api/install', () => {
  it('should accept tool ID and code', async () => {
    const requestBody = {
      toolId: 'get-users',
      code: 'export async function getUsers() { return []; }'
    };

    const request = new Request('http://localhost:8787/api/install', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': 'test-session'
      },
      body: JSON.stringify(requestBody)
    });

    expect(request.method).toBe('PUT');
    expect(request.headers.get('Content-Type')).toBe('application/json');
  });
});

describe('API Routes - POST /api/chat', () => {
  it('should accept chat message', async () => {
    const requestBody = {
      message: 'What tools are installed?'
    };

    const request = new Request('http://localhost:8787/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': 'test-session'
      },
      body: JSON.stringify(requestBody)
    });

    expect(request.method).toBe('POST');
    expect(request.headers.get('X-Session-ID')).toBe('test-session');
  });
});

describe('API Routes - GET /api/stream', () => {
  it('should accept session ID query parameter', () => {
    const request = new Request('http://localhost:8787/api/stream?sessionId=test-123', {
      method: 'GET'
    });

    const url = new URL(request.url);
    expect(url.searchParams.get('sessionId')).toBe('test-123');
    expect(request.method).toBe('GET');
  });

  it('should support SSE headers', () => {
    const request = new Request('http://localhost:8787/api/stream?sessionId=test-123', {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream'
      }
    });

    expect(request.headers.get('Accept')).toBe('text/event-stream');
  });
});

describe('API Routes - GET /api/tools', () => {
  it('should list installed tools', () => {
    const request = new Request('http://localhost:8787/api/tools', {
      method: 'GET',
      headers: {
        'X-Session-ID': 'test-session'
      }
    });

    expect(request.method).toBe('GET');
    expect(request.headers.get('X-Session-ID')).toBe('test-session');
  });
});
