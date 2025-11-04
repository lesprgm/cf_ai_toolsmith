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

describe('Integration - chat endpoint', () => {
  it('persists chat messages via SessionState durable object', async () => {
    const { namespace, storage } = createSessionStateNamespace();

    const env = {
      AI: {
        run: async () => ({ response: 'Hello from AI' })
      },
      SESSION_STATE: namespace,
      TOOL_REGISTRY: {
        idFromName: () => ({ toString: () => 'tool-registry-id' }),
        get: () => ({
          fetch: async () => new Response(JSON.stringify({ error: 'Tool not found' }), { status: 404 })
        })
      }
    } as any;

    const request = new Request('https://example.com/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': 'session-123'
      },
      body: JSON.stringify({ message: 'Hi there' })
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
});
