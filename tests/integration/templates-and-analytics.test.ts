import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import worker from '../../workers/index';
import type { Env } from '../../workers/bindings';
import type { AnalyticsEvent } from '../../workers/durable_objects/Analytics';

type DurableObjectStubInstance = {
  fetch(request: Request): Promise<Response>;
};

function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

class MockAnalyticsObject implements DurableObjectStubInstance {
  public events: AnalyticsEvent[] = [];

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/log' && request.method === 'POST') {
      const event = (await request.json()) as AnalyticsEvent;
      this.events.push(event);
      return jsonResponse({ success: true });
    }

    if (url.pathname === '/events' && request.method === 'GET') {
      return jsonResponse({ events: this.events });
    }

    return jsonResponse({ error: 'not_found' }, { status: 404 });
  }
}

interface InstalledTool {
  name: string;
  code: string;
  exports: string[];
  installedAt: string;
  metadata?: Record<string, unknown>;
}

class MockToolRegistryObject implements DurableObjectStubInstance {
  public tools = new Map<string, InstalledTool>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/install' && request.method === 'PUT') {
      const tool = (await request.json()) as InstalledTool;
      this.tools.set(tool.name, tool);
      return jsonResponse({ success: true, toolId: tool.name });
    }

    if (url.pathname === '/list' && request.method === 'GET') {
      return jsonResponse({ tools: Array.from(this.tools.values()) });
    }

    if (url.pathname === '/invoke' && request.method === 'POST') {
      return jsonResponse({ error: 'not_supported' }, { status: 501 });
    }

    return jsonResponse({ error: 'not_found' }, { status: 404 });
  }
}

class MockSessionStateObject implements DurableObjectStubInstance {
  public history: Array<{ role: string; content: string; timestamp: string }> = [];

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/add-message' && request.method === 'POST') {
      const message = (await request.json()) as { role: string; content: string };
      this.history.push({
        role: message.role,
        content: message.content,
        timestamp: new Date().toISOString(),
      });
      if (this.history.length > 100) {
        this.history.splice(0, this.history.length - 100);
      }
      return jsonResponse({ success: true });
    }

    if (url.pathname === '/get-history' && request.method === 'GET') {
      return jsonResponse(this.history);
    }

    return jsonResponse({ error: 'not_found' }, { status: 404 });
  }
}

function createNamespace<T extends DurableObjectStubInstance>(
  factory: () => T,
) {
  const instances = new Map<string, T>();

  const namespace = {
    idFromName(name: string) {
      return { name, toString: () => name };
    },
    get(id: { name?: string; toString(): string }) {
      const key = id.name ?? id.toString();
      if (!instances.has(key)) {
        instances.set(key, factory());
      }
      const instance = instances.get(key)!;
      return {
        fetch(input: RequestInfo | URL, init?: RequestInit) {
          const request = input instanceof Request ? input : new Request(input, init);
          return instance.fetch(request);
        },
      };
    },
  };

  return { namespace: namespace as unknown as DurableObjectNamespace, instances };
}

interface MockEnvResult {
  env: Env;
  analytics: ReturnType<typeof createNamespace<MockAnalyticsObject>>;
  registry: ReturnType<typeof createNamespace<MockToolRegistryObject>>;
}

function createMockEnv(): MockEnvResult {
  const analytics = createNamespace(() => new MockAnalyticsObject());
  const registry = createNamespace(() => new MockToolRegistryObject());
  const sessions = createNamespace(() => new MockSessionStateObject());

  const env = {
    AI: {
      run: vi.fn().mockResolvedValue({ response: 'ok' }),
    },
    ANALYTICS: analytics.namespace,
    TOOL_REGISTRY: registry.namespace,
    SESSION_STATE: sessions.namespace,
  } as unknown as Env;

  return { env, analytics, registry };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Worker routes for templates, analytics, and sandbox', () => {
  it('returns shipped template connectors', async () => {
    const { env } = createMockEnv();
    const request = new Request('https://example.com/api/templates');

    const response = await worker.fetch(request, env);
    const payload = await response.json() as { templates: Array<{ id: string; name: string }> };

    expect(response.status).toBe(200);
    expect(Array.isArray(payload.templates)).toBe(true);
    expect(payload.templates.length).toBeGreaterThan(0);
    expect(payload.templates[0]).toHaveProperty('endpoint');
  });

  it('installs a template connector and records analytics', async () => {
    const { env, analytics, registry } = createMockEnv();
    const request = new Request('https://example.com/api/templates/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'template-petstore-list-pets' }),
    });

    const response = await worker.fetch(request, env);
    const result = await response.json() as { success: boolean; template: { name: string } };

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(result.template.name).toContain('Petstore');

    const registryObject = registry.instances.get('global');
    expect(registryObject).toBeDefined();
    expect(registryObject?.tools.has(result.template.name)).toBe(true);

    const analyticsObject = analytics.instances.get('global');
    expect(analyticsObject?.events.some((event) => event.type === 'template-install')).toBe(true);
  });

  it('rejects sandbox requests without url', async () => {
    const { env } = createMockEnv();
    const request = new Request('https://example.com/api/test-connector', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await worker.fetch(request, env);
    const payload = await response.json() as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe('url is required');
  });

  it('proxies sandbox requests and exposes analytics', async () => {
    const { env, analytics } = createMockEnv();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"ok":true}', {
        status: 201,
        statusText: 'Created',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const request = new Request('https://example.com/api/test-connector', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://api.test.dev/resource',
        method: 'POST',
        headers: { 'X-Test': '1' },
        body: { hello: 'world' },
      }),
    });

    const response = await worker.fetch(request, env);
    const payload = await response.json() as {
      status: number;
      headers: Record<string, string>;
      durationMs: number;
    };

    expect(response.status).toBe(200);
    expect(payload.status).toBe(201);
    expect(payload.headers['content-type']).toContain('application/json');
    expect(fetchSpy).toHaveBeenCalledWith('https://api.test.dev/resource', expect.objectContaining({
      method: 'POST',
    }));

    const analyticsObject = analytics.instances.get('global');
    expect(analyticsObject?.events.some((event) => event.type === 'test')).toBe(true);

    const analyticsResponse = await worker.fetch(
      new Request('https://example.com/api/analytics'),
      env,
    );
    const analyticsPayload = await analyticsResponse.json() as { events: AnalyticsEvent[] };

    expect(analyticsPayload.events.length).toBeGreaterThan(0);
  });
});
