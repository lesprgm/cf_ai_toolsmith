import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../../workers/durable_objects/ToolRegistry';

class MockStorage {
  private store = new Map<string, any>();

  async put(key: string, value: any) {
    this.store.set(key, value);
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.store.get(key);
  }

  async list<T>(options?: { prefix?: string }): Promise<Array<[string, T]>> {
    const entries = Array.from(this.store.entries()) as Array<[string, T]>;
    if (!options?.prefix) {
      return entries;
    }
    return entries.filter(([key]) => key.startsWith(options.prefix!));
  }
}

class MockState {
  storage = new MockStorage();
}

describe('ToolRegistry durable object', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry(new MockState() as any, {});
  });

  const jsonResponse = async (res: Response) => {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };

  it('installs a tool and returns informative error on invocation in local dev', async () => {
    const code = `
import something from 'node:fs';
const suffix = '!'; 
export default async function handler(params) {
  return { echo: (params?.message || '') + suffix };
}
export const identity = (value) => value;
`;

    const installReq = new Request('http://internal/install', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'echo',
        code,
        exports: ['default', 'identity'],
        installedAt: new Date().toISOString(),
      }),
    });

    const installRes = await registry.fetch(installReq);
    expect(installRes.status).toBe(200);
    expect(await jsonResponse(installRes)).toMatchObject({ success: true, toolId: 'echo' });

    const invokeReq = new Request('http://internal/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolName: 'echo', params: { message: 'Hi' } }),
    });

    const invokeRes = await registry.fetch(invokeReq);
    expect(invokeRes.status).toBe(501);
    expect(await jsonResponse(invokeRes)).toMatchObject({
      error: expect.stringContaining('Dynamic connector execution is unavailable'),
    });
  });
});
