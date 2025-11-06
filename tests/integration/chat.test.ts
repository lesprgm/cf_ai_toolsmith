import { describe, it, expect } from 'vitest';
import worker from '../../workers/index';
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

const createSessionStateNamespace = () => {
  const storage = new MockStorage();
  const state = { storage } as any;
  const instance = new SessionState(state, {});

  return {
    namespace: {
      idFromName: () => ({ toString: () => 'session-id' }),
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

const createSkillRegistryStub = (apis: Record<string, any> = {}) => ({
  idFromName: () => ({ toString: () => 'skill-registry-id' }),
  get: () => ({
    fetch: async (url: string | URL, init?: RequestInit) => {
      const request = typeof url === 'string' ? new Request(url, init) : new Request(url, init);
      if (request.url.includes('/get-skills')) {
        return new Response(JSON.stringify({ apis }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    }
  })
});

describe('Integration - chat endpoint', () => {
  it('persists chat messages via SessionState durable object', async () => {
    const { namespace, storage } = createSessionStateNamespace();

    const env = {
      AI: {
        run: async () => ({ response: 'Hello from AI' })
      },
      SESSION_STATE: namespace,
      SKILL_REGISTRY: createSkillRegistryStub()
    } as any;

    const request = new Request('https://example.com/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': 'session-123'
      },
      body: JSON.stringify({ message: 'Hi there', stream: false })
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ response: 'Hello from AI' });

    const history = storage.snapshot('history');
    expect(Array.isArray(history)).toBe(true);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ role: 'user', content: 'Hi there' });
    expect(history[1]).toMatchObject({ role: 'assistant', content: 'Hello from AI' });
  });

  it('handles missing message parameter', async () => {
    const { namespace } = createSessionStateNamespace();

    const env = {
      AI: { run: async () => ({ response: 'OK' }) },
      SESSION_STATE: namespace,
      SKILL_REGISTRY: createSkillRegistryStub()
    } as any;

    const request = new Request('https://example.com/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
      body: JSON.stringify({}) // missing message
    });

    const response = await worker.fetch(request, env);
    expect(response.status).toBe(400);
    const result = await response.json() as any;
    expect(result.error).toContain('Message is required');
  });

  it('supports custom persona instructions', async () => {
    const { namespace } = createSessionStateNamespace();

    let capturedMessages: any[] = [];
    const env = {
      AI: {
        run: async (_model: string, config: any) => {
          capturedMessages = config.messages;
          return { response: 'Technical response' };
        }
      },
      SESSION_STATE: namespace,
      SKILL_REGISTRY: createSkillRegistryStub()
    } as any;

    const request = new Request('https://example.com/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
      body: JSON.stringify({
        message: 'Explain',
        persona: 'technical'
      })
    });

    await worker.fetch(request, env);

    const systemMessage = capturedMessages.find(m => m.role === 'system');
    expect(systemMessage).toBeDefined();
    expect(systemMessage.content).toContain('technical');
  });

  it('positions AI as a skills-enabled assistant via system prompt', async () => {
    const { namespace } = createSessionStateNamespace();

    let systemPrompt = '';
    const env = {
      AI: {
        run: async (_model: string, config: any) => {
          const systemMsg = config.messages.find((m: any) => m.role === 'system');
          systemPrompt = systemMsg?.content || '';
          return { response: 'Plain text response' };
        }
      },
      SESSION_STATE: namespace,
      SKILL_REGISTRY: createSkillRegistryStub()
    } as any;

    const request = new Request('https://example.com/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
      body: JSON.stringify({ message: 'Test', stream: false })
    });

    await worker.fetch(request, env);

    expect(systemPrompt).toContain('You are a helpful AI assistant.');
    expect(systemPrompt).toContain('ONLY use skills when the user explicitly asks');
  });

  it('includes registered skills in system context', async () => {
    const { namespace } = createSessionStateNamespace();

    let systemContent = '';
    const mockApis = {
      weather: {
        apiName: 'weather',
        skills: [
          { name: 'getWeather', description: 'Get current weather', method: 'GET', path: '/weather', parameters: [] },
          { name: 'getForecast', description: 'Get weather forecast', method: 'GET', path: '/forecast', parameters: [] }
        ],
        baseUrl: 'https://api.weather.example',
        metadata: { title: 'Weather API connector', version: '1.0' }
      }
    };
    const env = {
      AI: {
        run: async (_model: string, config: any) => {
          const systemMsg = config.messages.find((m: any) => m.role === 'system');
          systemContent = systemMsg?.content || '';
          return { response: 'OK' };
        }
      },
      SESSION_STATE: namespace,
      SKILL_REGISTRY: createSkillRegistryStub(mockApis)
    } as any;

    const request = new Request('https://example.com/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
      body: JSON.stringify({ message: 'What skills are available?', stream: false })
    });

    const response = await worker.fetch(request, env);

    expect(systemContent).toContain('weather');
    expect(systemContent).toContain('getWeather');
    expect(systemContent).toContain('getForecast');
  });

  it('returns a graceful response when the AI service fails', async () => {
    const { namespace } = createSessionStateNamespace();

    const env = {
      AI: {
        run: async () => {
          throw new Error('Upstream AI failure');
        }
      },
      SESSION_STATE: namespace,
      SKILL_REGISTRY: createSkillRegistryStub()
    } as any;

    const request = new Request('https://example.com/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
      body: JSON.stringify({ message: 'Hello there', stream: false })
    });

    const response = await worker.fetch(request, env);
    expect(response.status).toBe(200);
    const result = await response.json() as any;

    expect(result.response).toContain('AI service is currently unavailable');
    expect(result.error).toMatchObject({ type: 'ai-unavailable' });
  });

  it.skip('(DEPRECATED - tool execution removed) handles explicit tool invocation', async () => {
    const { namespace } = createSessionStateNamespace();

    const env = {
      AI: {
        run: async () => ({ response: 'Tool executed' })
      },
      SESSION_STATE: namespace,
      TOOL_REGISTRY: {
        idFromName: () => ({ toString: () => 'tool-registry-id' }),
        get: () => ({
          fetch: async (url: string | URL) => {
            const urlStr = typeof url === 'string' ? url : url.toString();
            if (urlStr.includes('/list')) {
              return new Response(JSON.stringify({
                tools: [{ name: 'test', exports: ['default'] }]
              }), { status: 200 });
            }
            if (urlStr.includes('/invoke')) {
              return new Response(JSON.stringify({
                error: 'Dynamic connector execution is unavailable in local dev'
              }), { status: 501 });
            }
            return new Response('Not found', { status: 404 });
          }
        })
      }
    } as any;

    const request = new Request('https://example.com/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
      body: JSON.stringify({
        message: 'Run the tool',
        toolName: 'test',
        exportName: 'default',
        params: { input: 'value' },
        stream: false
      })
    });

    const response = await worker.fetch(request, env);
    const result = await response.json() as any;

    expect(result.toolExecutions).toBeDefined();
    expect(result.toolExecutions).toHaveLength(1);
  });
});
