export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface SandboxScenario {
  id: string;
  name: string;
  description?: string;
  endpointId?: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: any;
  };
  intervalMinutes?: number | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastStatus?: number;
  lastDurationMs?: number;
  lastError?: string;
  lastHeaders?: Record<string, string>;
  lastBodyPreview?: string;
}

interface ScenarioRunResult {
  id: string;
  name: string;
  success: boolean;
  status?: number;
  statusText?: string;
  durationMs?: number;
  error?: string;
  preview?: string;
  headers?: Record<string, string>;
  ranAt: string;
}

export class SessionState {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: any) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // POST /add-message - Add message to history
    if (url.pathname === '/add-message' && request.method === 'POST') {
      const parsed = await readJson(request);
      if (!parsed.ok) {
        return parsed.error;
      }

      const payload = parsed.value;
      const role = typeof payload?.role === 'string' ? payload.role.trim() : '';
      const content = typeof payload?.content === 'string' ? payload.content : '';

      if (!role || !['user', 'assistant', 'system'].includes(role)) {
        return jsonResp({ error: 'Valid role is required' }, 400);
      }
      if (!content || !content.trim().length) {
        return jsonResp({ error: 'Message content is required' }, 400);
      }

      const message: Message & { metadata?: Record<string, any> } = {
        role: role as Message['role'],
        content,
        timestamp: new Date().toISOString(),
      };

      if (payload.metadata && typeof payload.metadata === 'object') {
        message.metadata = payload.metadata;
      }

      const history: Array<typeof message> = (await this.state.storage.get('history')) || [];
      history.push(message);

      // Keep last 100 messages
      if (history.length > 100) {
        history.splice(0, history.length - 100);
      }

      await this.state.storage.put('history', history);

      return jsonResp({ success: true });
    }

    if (url.pathname === '/get-history' && request.method === 'GET') {
      const history: Message[] = (await this.state.storage.get('history')) || [];
      return jsonResp(history);
    }

    if (
      (url.pathname === '/clear-history' && request.method === 'POST') ||
      (url.pathname === '/clear' && request.method === 'DELETE')
    ) {
      await this.state.storage.put('history', []);
      return jsonResp({ success: true });
    }

    if ((url.pathname === '/scenarios' || url.pathname === '/scenarios/list') && request.method === 'GET') {
      const scenarios: SandboxScenario[] = (await this.state.storage.get('scenarios')) || [];
      if (url.pathname === '/scenarios/list') {
        return jsonResp(scenarios);
      }
      return jsonResp({ scenarios });
    }

    if (
      (url.pathname === '/scenarios' && request.method === 'POST') ||
      (url.pathname === '/scenarios/add' && request.method === 'POST')
    ) {
      const parsed = await readJson(request);
      if (!parsed.ok) {
        return parsed.error;
      }
      const payload = parsed.value || {};
      const scenarios: SandboxScenario[] = (await this.state.storage.get('scenarios')) || [];

      const id = typeof payload.id === 'string' && payload.id.trim().length ? payload.id.trim() : this.generateId();
      const existingIndex = scenarios.findIndex((scenario) => scenario.id === id);

      const now = new Date().toISOString();

      const incomingRequest = payload.request && typeof payload.request === 'object' ? payload.request : {};
      const requestUrl = typeof payload.url === 'string' && payload.url.trim().length
        ? payload.url.trim()
        : typeof incomingRequest.url === 'string' && incomingRequest.url.trim().length
          ? incomingRequest.url.trim()
          : '';

      const requestMethod = typeof payload.method === 'string' && payload.method.trim().length
        ? payload.method.trim().toUpperCase()
        : typeof incomingRequest.method === 'string' && incomingRequest.method.trim().length
          ? incomingRequest.method.trim().toUpperCase()
          : 'GET';

      const scenario: SandboxScenario = {
        id,
        name: typeof payload.name === 'string' && payload.name.trim().length ? payload.name.trim() : `Scenario ${id}`,
        description: typeof payload.description === 'string' ? payload.description.trim() || undefined : undefined,
        endpointId: typeof payload.endpointId === 'string' && payload.endpointId.trim().length ? payload.endpointId.trim() : undefined,
        request: {
          url: requestUrl,
          method: requestMethod,
          headers: sanitizeHeaders(payload.headers || incomingRequest.headers),
          body: incomingRequest.body ?? payload.body,
        },
        intervalMinutes: normalizeInterval(payload.intervalMinutes),
        createdAt: existingIndex >= 0 ? scenarios[existingIndex].createdAt : now,
        updatedAt: now,
        lastRunAt: existingIndex >= 0 ? scenarios[existingIndex].lastRunAt : undefined,
        lastStatus: existingIndex >= 0 ? scenarios[existingIndex].lastStatus : undefined,
        lastDurationMs: existingIndex >= 0 ? scenarios[existingIndex].lastDurationMs : undefined,
        lastError: existingIndex >= 0 ? scenarios[existingIndex].lastError : undefined,
        lastHeaders: existingIndex >= 0 ? scenarios[existingIndex].lastHeaders : undefined,
        lastBodyPreview: existingIndex >= 0 ? scenarios[existingIndex].lastBodyPreview : undefined,
      };

      // Preserve top-level compatibility fields for tests/legacy callers
      (scenario as any).url = requestUrl;
      (scenario as any).method = requestMethod;
      if (payload.expectedStatus !== undefined) {
        (scenario as any).expectedStatus = payload.expectedStatus;
      }

      if (!scenario.request.url) {
        return jsonResp({ error: 'Scenario request url is required' }, 400);
      }

      if (existingIndex >= 0) {
        scenarios[existingIndex] = { ...scenarios[existingIndex], ...scenario };
      } else {
        scenarios.push(scenario);
      }

      await this.state.storage.put('scenarios', scenarios);
      return jsonResp({ scenario });
    }

    if (url.pathname.startsWith('/scenarios/delete/') && request.method === 'DELETE') {
      const [, , , indexStr] = url.pathname.split('/');
      const scenarios: SandboxScenario[] = (await this.state.storage.get('scenarios')) || [];

      const index = Number(indexStr);
      if (!Number.isInteger(index)) {
        return jsonResp({ error: 'Scenario index must be an integer' }, 400);
      }

      if (index < 0 || index >= scenarios.length) {
        return jsonResp({ error: 'Scenario not found' }, 404);
      }

      scenarios.splice(index, 1);
      await this.state.storage.put('scenarios', scenarios);
      return jsonResp({ success: true });
    }

    if (url.pathname.startsWith('/scenarios/') && request.method === 'DELETE') {
      const [, , scenarioId] = url.pathname.split('/');
      if (!scenarioId) {
        return jsonResp({ error: 'Scenario ID required' }, 400);
      }

      const scenarios: SandboxScenario[] = (await this.state.storage.get('scenarios')) || [];
      const next = scenarios.filter((scenario) => scenario.id !== scenarioId);

      if (next.length === scenarios.length) {
        return jsonResp({ error: 'Scenario not found' }, 404);
      }

      await this.state.storage.put('scenarios', next);
      return jsonResp({ success: true });
    }

    if (url.pathname === '/scenarios/run' && request.method === 'POST') {
      const parsed = await readJson(request);
      if (!parsed.ok) {
        return parsed.error;
      }

      const payload = parsed.value || {};
      const scenarios: SandboxScenario[] = (await this.state.storage.get('scenarios')) || [];
      const scenarioIds: string[] | undefined = Array.isArray(payload.scenarioIds)
        ? payload.scenarioIds.filter((id: unknown) => typeof id === 'string' && id.trim().length).map((id: string) => id.trim())
        : undefined;

      const selected = scenarioIds && scenarioIds.length
        ? scenarios.filter((scenario) => scenarioIds.includes(scenario.id))
        : scenarios;

      const results: ScenarioRunResult[] = [];
      for (const scenario of selected) {
        const result = await this.executeScenarioRun(scenario);
        results.push(result);
      }

      await this.state.storage.put('scenarios', scenarios);
      return jsonResp({ results });
    }

    if (url.pathname === '/set-metadata' && request.method === 'POST') {
      const parsed = await readJson(request);
      if (!parsed.ok) {
        return parsed.error;
      }

      const payload = parsed.value || {};
      const key = typeof payload.key === 'string' && payload.key.trim().length ? payload.key.trim() : '';

      if (!key) {
        return jsonResp({ error: 'Metadata key is required' }, 400);
      }

      await this.state.storage.put(key, payload.value);
      return jsonResp({ success: true });
    }

    if (url.pathname === '/get-metadata' && request.method === 'GET') {
      const key = url.searchParams.get('key');
      if (!key) {
        return jsonResp({ error: 'Metadata key is required' }, 400);
      }

      const value = await this.state.storage.get(key);
      if (value === undefined) {
        return jsonResp({ error: 'Not found' }, 404);
      }

      return jsonResp(value);
    }

    return jsonResp({ error: 'Not found' }, 404);
  }

  private generateId(): string {
    if (typeof crypto?.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private async executeScenarioRun(scenario: SandboxScenario): Promise<ScenarioRunResult> {
    const ranAt = new Date().toISOString();

    const requestConfig = (scenario.request && typeof scenario.request === 'object')
      ? scenario.request
      : {
        url: (scenario as any).url || '',
        method: (scenario as any).method || 'GET',
        headers: (scenario as any).headers || {},
        body: (scenario as any).body,
      };

    const targetUrl = typeof requestConfig.url === 'string' ? requestConfig.url : '';
    if (!targetUrl) {
      return {
        id: scenario.id,
        name: scenario.name,
        success: false,
        error: 'Scenario request url is required',
        ranAt,
      };
    }

    const headers = { ...(requestConfig.headers || {}) };
    const normalizedHeaders: Record<string, string> = {};
    Object.entries(headers).forEach(([key, value]) => {
      if (typeof key === 'string' && typeof value === 'string') {
        normalizedHeaders[key] = value;
      }
    });

    let payload: BodyInit | undefined;
    if (typeof requestConfig.body === 'string') {
      payload = requestConfig.body;
    } else if (requestConfig.body !== undefined && requestConfig.body !== null) {
      payload = JSON.stringify(requestConfig.body);
      if (!Object.keys(normalizedHeaders).some((key) => key.toLowerCase() === 'content-type')) {
        normalizedHeaders['Content-Type'] = 'application/json';
      }
    }

    const requestInit: RequestInit = {
      method: requestConfig.method || 'GET',
      headers: normalizedHeaders,
      body: payload,
    };

    // Persist normalized request structure for future runs and UI display
    (scenario as any).request = {
      url: targetUrl,
      method: requestInit.method || 'GET',
      headers: normalizedHeaders,
      body: requestConfig.body,
    };

    try {
      const start = Date.now();
      const response = await fetch(targetUrl, requestInit);
      const durationMs = Date.now() - start;
      const responseHeaders = Object.fromEntries(response.headers.entries());
      const bodyText = await response.text();

      scenario.lastRunAt = ranAt;
      scenario.lastStatus = response.status;
      scenario.lastDurationMs = durationMs;
      scenario.lastError = undefined;
      scenario.lastHeaders = responseHeaders;
      scenario.lastBodyPreview = snippet(bodyText);
      scenario.updatedAt = ranAt;

      return {
        id: scenario.id,
        name: scenario.name,
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        durationMs,
        headers: responseHeaders,
        preview: snippet(bodyText),
        ranAt,
      };
    } catch (error) {
      const message = (error as Error).message || 'Unknown error';
      scenario.lastRunAt = ranAt;
      scenario.lastStatus = undefined;
      scenario.lastDurationMs = undefined;
      scenario.lastError = message;
      scenario.updatedAt = ranAt;

      return {
        id: scenario.id,
        name: scenario.name,
        success: false,
        error: message,
        ranAt,
      };
    }
  }
}

function jsonResp(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sanitizeHeaders(headers: any): Record<string, string> {
  if (!headers || typeof headers !== 'object') {
    return {};
  }

  const normalized: Record<string, string> = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (typeof key === 'string' && typeof value === 'string') {
      normalized[key] = value;
    }
  });
  return normalized;
}

function normalizeInterval(value: any): number | null | undefined {
  if (value === null) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }
  return Math.round(numeric);
}

function snippet(value: string, limit = 1200): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}…`;
}

type JsonParseResult = { ok: true; value: any } | { ok: false; error: Response };

async function readJson(request: Request): Promise<JsonParseResult> {
  try {
    const raw = await request.text();
    if (!raw) {
      return { ok: true, value: {} };
    }
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch {
      return { ok: false, error: jsonResp({ error: 'Invalid JSON payload' }, 400) };
    }
  } catch {
    return { ok: false, error: jsonResp({ error: 'Unable to read request body' }, 400) };
  }
}

