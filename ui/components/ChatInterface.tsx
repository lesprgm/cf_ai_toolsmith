import { useEffect, useRef, useState } from 'react';

const API_BASE =
  (import.meta.env.VITE_WORKER_BASE_URL as string | undefined)?.replace(/\/$/, '') || '';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export type PersonaKey = 'default' | 'tutor' | 'deployment' | 'troubleshooter';

interface ChatInterfaceProps {
  sessionId: string;
  persona: PersonaKey;
  onPersonaChange: (persona: PersonaKey) => void;
}

const PERSONA_OPTIONS: { value: PersonaKey; label: string; description: string }[] = [
  { value: 'default', label: 'General Assistant', description: 'General guidance for ToolSmith workflow.' },
  { value: 'tutor', label: 'Connector Tutor', description: 'Explain concepts and best practices in detail.' },
  { value: 'deployment', label: 'Deployment Assistant', description: 'Focus on deploying workers and managing environments.' },
  { value: 'troubleshooter', label: 'Troubleshooter', description: 'Diagnose and resolve issues in the pipeline.' },
];

export default function ChatInterface({ sessionId, persona, onPersonaChange }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (messagesEndRef.current as any)?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !sessionId) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId,
        },
        body: JSON.stringify({
          message: input,
          persona,
        }),
      });

      if (!response.ok) {
        throw new Error(`Chat failed: ${response.statusText}`);
      }

      const data = await response.json() as { response: string };

      const assistantMessage: Message = {
        role: 'assistant',
        content: data.response || 'No response',
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="card h-full flex flex-col">
      <div className="p-4 border-b border-slate-200 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Chat with AI</h3>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <label htmlFor="persona-select" className="font-medium text-slate-600">
              Persona
            </label>
            <select
              id="persona-select"
              value={persona}
              onChange={(e) => onPersonaChange(e.target.value as PersonaKey)}
              className="border border-slate-300 rounded px-2 py-1 text-slate-900 bg-white text-xs"
            >
              {PERSONA_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          {PERSONA_OPTIONS.find((option) => option.value === persona)?.description}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-96">
        {messages.length === 0 ? (
          <div className="text-center text-slate-500 py-8">
            <p className="mb-2">💬 Start a conversation</p>
            <p className="text-sm">Ask questions or interact with your deployed tools</p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                  msg.role === 'user'
                    ? 'bg-cloudflare-orange text-white'
                    : 'bg-slate-100 text-slate-900'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                <p className="text-xs mt-1 opacity-70">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))
        )}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-200 rounded-lg px-4 py-2">
              <div className="flex space-x-2">
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:0.1s]"></div>
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:0.2s]"></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-slate-200">
        <div className="flex space-x-2">
          <input
            type="text"
            className="input flex-1"
            placeholder="Type your message..."
            value={input}
            onChange={(e) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              setInput((e.target as any).value);
            }}
            onKeyPress={handleKeyPress}
            disabled={isLoading || !sessionId}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim() || !sessionId}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
