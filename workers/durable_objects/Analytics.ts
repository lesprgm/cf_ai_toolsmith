export interface AnalyticsEvent {
  id: string;
  type: 'parse' | 'generate' | 'verify' | 'install' | 'deploy' | 'template-install' | 'test';
  details?: Record<string, any>;
  timestamp: string;
}

export class AnalyticsTracker {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/log' && request.method === 'POST') {
      const event = (await request.json()) as AnalyticsEvent;
      const events = (await this.state.storage.get<AnalyticsEvent[]>('events')) || [];
      events.push(event);
      const trimmed = events.slice(-200);
      await this.state.storage.put('events', trimmed);
      return jsonResponse({ success: true });
    }

    if (url.pathname === '/events' && request.method === 'GET') {
      const events = (await this.state.storage.get<AnalyticsEvent[]>('events')) || [];
      return jsonResponse({ events });
    }

    if (url.pathname === '/clear' && request.method === 'DELETE') {
      await this.state.storage.delete('events');
      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: 'Not found' }, 404);
  }
}

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
