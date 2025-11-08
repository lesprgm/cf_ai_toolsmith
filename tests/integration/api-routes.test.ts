import { describe, it, expect } from 'vitest';
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

const createEnv = () => {
  const { namespace } = createSkillRegistryNamespace();
  return {
    SKILL_REGISTRY: namespace,
    AI: {
      run: async () => ({ response: 'OK' })
    },
    API_KEY_SECRET: 'test-secret-key-1234567890'
  } as any;
};

describe('API Routes - /api/skills/register', () => {
  it('registers skills when spec is provided as a YAML string', async () => {
    const env = createEnv();

    const yamlSpec = `
openapi: 3.0.0
info:
  title: Weather YAML API
  version: 1.0.0
servers:
  - url: https://api.weather.example
paths:
  /weather:
    get:
      operationId: getWeather
      summary: Get the current weather
      responses:
        '200':
          description: OK
`;

    const request = new Request('https://example.com/api/skills/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': 'yaml-user'
      },
      body: JSON.stringify({
        apiName: 'Weather YAML',
        spec: yamlSpec,
        apiKey: 'secret-key'
      })
    });

    const response = await worker.fetch(request, env);
    expect(response.status).toBe(200);

    const result = await response.json() as any;
    expect(result.success).toBe(true);
    expect(result.skillCount).toBe(1);
    expect(result.skillNames).toContain('getWeather');
  });

  it('rejects OpenAPI specs larger than 5MB', async () => {
    const env = createEnv();
    const oversizedPayload = 'x'.repeat(5 * 1024 * 1024 + 10);

    const request = new Request('https://example.com/api/skills/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': 'big-user'
      },
      body: JSON.stringify({
        apiName: 'Huge Spec',
        spec: {
          openapi: '3.0.0',
          info: { title: 'Huge', version: '1.0.0' },
          paths: {},
          components: {},
          padding: oversizedPayload
        }
      })
    });

    const response = await worker.fetch(request, env);
    expect(response.status).toBe(400);

    const result = await response.json() as any;
    expect(result.error).toContain('Spec is too large');
  });
});

describe('API Routes - CORS handling', () => {
  it('responds to OPTIONS preflight requests with permissive headers', async () => {
    const request = new Request('https://example.com/api/skills/register', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST'
      }
    });

    const response = await worker.fetch(request, {} as any);
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
  });
});
