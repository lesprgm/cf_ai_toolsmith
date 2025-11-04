import { useEffect, useRef, useState } from 'react';

const API_BASE =
  (import.meta.env.VITE_WORKER_BASE_URL as string | undefined)?.replace(/\/$/, '') || '';

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

interface ConsoleLogProps {
  sessionId: string;
}

export default function ConsoleLog({ sessionId }: ConsoleLogProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const consoleRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    // Connect to SSE endpoint for realtime logs
    const sseUrl = `${API_BASE}/api/stream?sessionId=${encodeURIComponent(sessionId)}`;

    try {
      const eventSource = new EventSource(sseUrl);

      eventSource.onopen = () => {
        console.log('SSE connected');
        setIsConnected(true);
      };

      eventSource.addEventListener('log', (event) => {
        try {
          const messageEvent = event as MessageEvent;
          const logEntry: LogEntry = JSON.parse(messageEvent.data);
          setLogs((prev) => [...prev, logEntry]);
        } catch (error) {
          console.error('Failed to parse log entry:', error);
        }
      });

      eventSource.addEventListener('ping', () => {
        // Keep-alive ping, no action needed
      });

      eventSource.onerror = () => {
        console.error('SSE connection error');
        setIsConnected(false);
        eventSource.close();
      };

      eventSourceRef.current = eventSource;

      return () => {
        eventSource.close();
      };
    } catch (error) {
      console.error('Failed to connect SSE:', error);
    }
  }, [sessionId]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (consoleRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const element = consoleRef.current as any;
      element.scrollTop = element.scrollHeight;
    }
  }, [logs]);

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error':
        return 'text-red-600';
      case 'warn':
        return 'text-yellow-600';
      case 'debug':
        return 'text-slate-500';
      default:
        return 'text-green-600';
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  return (
    <div className="card h-full flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-slate-200">
        <div className="flex items-center space-x-3">
          <h3 className="text-lg font-semibold text-slate-900">Console</h3>
          <div
            className={`h-2 w-2 rounded-full ${
              isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
            }`}
          ></div>
          <span className="text-xs text-slate-400">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <button
          onClick={clearLogs}
          className="text-xs text-slate-500 hover:text-slate-900 transition-colors"
        >
          Clear
        </button>
      </div>

      <div
        ref={consoleRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-2 bg-slate-100 max-h-96 border border-slate-200"
      >
        {logs.length === 0 ? (
          <div className="text-slate-500 text-center py-8">
            No logs yet. Upload a spec to see realtime processing logs.
          </div>
        ) : (
          logs.map((log, idx) => (
            <div key={idx} className="flex items-start space-x-3 py-1 hover:bg-slate-800/50">
              <span className="text-xs text-slate-500 whitespace-nowrap">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span className={`text-xs font-medium uppercase ${getLevelColor(log.level)}`}>
                [{log.level}]
              </span>
              <span className="flex-1 text-slate-700">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
