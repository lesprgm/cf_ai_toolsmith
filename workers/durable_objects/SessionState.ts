export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
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
      const message: Message = await request.json();
      message.timestamp = new Date().toISOString();

      const history: Message[] = (await this.state.storage.get('history')) || [];
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

    if (url.pathname === '/clear' && request.method === 'DELETE') {
      await this.state.storage.delete('history');
      return jsonResp({ success: true });
    }

    return jsonResp({ error: 'Not found' }, 404);
  }
}

function jsonResp(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
