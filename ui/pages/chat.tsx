import React, { useState, useEffect, useRef } from 'react';
import ConsoleLog from '../components/ConsoleLog';
import { useSession } from '../context/SessionContext';
import { Bot, CheckCircle2, XCircle, MessageCircle, Wrench, Send } from 'lucide-react';

interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    toolExecutions?: Array<{
        tool: string;
        export?: string;
        success: boolean;
        result?: any;
        error?: string;
    }>;
    skillExecutions?: Array<{
        skill: string;
        success: boolean;
        result?: any;
        error?: string;
    }>;
}

interface Tool {
    name: string;
    exports: string[];
    metadata?: {
        description?: string;
        endpoint?: string;
        [key: string]: any;
    };
    installedAt: string;
}

declare const window: any;

const API_BASE = ((import.meta as any).env?.VITE_WORKER_BASE_URL as string | undefined)?.replace(/\/$/, '') || '';

function showAlert(msg: string) {
    if (typeof window !== 'undefined' && window.alert) {
        window.alert(msg);
    } else {
        console.warn('Alert:', msg);
    }
}

export default function ChatPage() {
    const { sessionId } = useSession();
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [loading, setLoading] = useState(false);
    const [tools, setTools] = useState<Tool[]>([]);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetchTools();
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const fetchTools = async () => {
        try {
            const response = await fetch(`${API_BASE}/api/tools`);
            const data = await response.json() as any;
            if (data.tools) {
                setTools(data.tools);
            }
        } catch (error) {
            console.error('Failed to fetch tools:', error);
        }
    };

    const sendMessage = async () => {
        if (!inputValue.trim()) return;

        const userMessage: Message = {
            role: 'user',
            content: inputValue,
        };

        setMessages((prev) => [...prev, userMessage]);
        setInputValue('');
        setLoading(true);

        const assistantMessage: Message = {
            role: 'assistant',
            content: '',
            toolExecutions: undefined,
        };

        setMessages((prev) => [...prev, assistantMessage]);
        const messageIndex = messages.length + 1;

        try {
            const response = await fetch(`${API_BASE}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-ID': sessionId,
                    'X-User-ID': sessionId,
                },
                body: JSON.stringify({
                    message: inputValue,
                    stream: true,
                }),
            });

            const contentType = response.headers.get('content-type');

            if (contentType?.includes('text/event-stream')) {
                const reader = response.body?.getReader();
                const decoder = new TextDecoder();

                if (!reader) {
                    throw new Error('No response body');
                }

                let buffer = '';
                let fullContent = '';
                let toolExecutions: any[] | undefined;
                let skillExecutions: any[] = [];

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') {
                                continue;
                            }

                            try {
                                const parsed = JSON.parse(data);

                                if (parsed.type === 'content') {
                                    fullContent += parsed.data;
                                    setMessages((prev) => {
                                        const updated = [...prev];
                                        updated[messageIndex] = {
                                            ...updated[messageIndex],
                                            content: fullContent,
                                        };
                                        return updated;
                                    });
                                } else if (parsed.type === 'executing_skills') {
                                    // AI is about to execute skills
                                    fullContent += `\n\n🔄 Executing ${parsed.data.count} skill(s)...\n`;
                                    setMessages((prev) => {
                                        const updated = [...prev];
                                        updated[messageIndex] = {
                                            ...updated[messageIndex],
                                            content: fullContent,
                                        };
                                        return updated;
                                    });
                                } else if (parsed.type === 'skill_result') {
                                    // Individual skill execution result
                                    skillExecutions.push(parsed.data);
                                    setMessages((prev) => {
                                        const updated = [...prev];
                                        updated[messageIndex] = {
                                            ...updated[messageIndex],
                                            skillExecutions: [...skillExecutions],
                                        };
                                        return updated;
                                    });
                                } else if (parsed.type === 'tool_executions') {
                                    toolExecutions = parsed.data;
                                    setMessages((prev) => {
                                        const updated = [...prev];
                                        updated[messageIndex] = {
                                            ...updated[messageIndex],
                                            toolExecutions: toolExecutions,
                                        };
                                        return updated;
                                    });
                                } else if (parsed.type === 'skill_executions') {
                                    skillExecutions = parsed.data;
                                    setMessages((prev) => {
                                        const updated = [...prev];
                                        updated[messageIndex] = {
                                            ...updated[messageIndex],
                                            skillExecutions: skillExecutions,
                                        };
                                        return updated;
                                    });
                                } else if (parsed.type === 'error') {
                                    showAlert('Error: ' + parsed.data.message);
                                }
                            } catch (e) {
                                console.error('Failed to parse SSE data:', e);
                            }
                        }
                    }
                }
            } else {
                const data = await response.json() as any;

                setMessages((prev) => {
                    const updated = [...prev];
                    updated[messageIndex] = {
                        role: 'assistant',
                        content: data.response || 'No response',
                        toolExecutions: data.toolExecutions,
                        skillExecutions: data.skillExecutions,
                    };
                    return updated;
                });
            }
        } catch (error) {
            showAlert('Failed to send message: ' + (error as Error).message);
            setMessages((prev) => prev.filter((_, idx) => idx !== messageIndex));
        } finally {
            setLoading(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const clearChat = () => {
        setMessages([]);
    };

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Header */}
                <div className="mb-6">
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">
                        AI Chat
                    </h1>
                    <p className="text-slate-600">
                        Chat with AI that can execute your registered API skills
                    </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    {/* Sidebar - Installed Tools & Console */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-white rounded-xl border-2 border-slate-200 shadow-sm p-6 sticky top-6">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-bold text-slate-900">Installed Tools</h2>
                                <button
                                    onClick={fetchTools}
                                    className="text-orange-600 hover:text-orange-700 text-sm font-medium"
                                    title="Refresh tools"
                                >
                                    ↻
                                </button>
                            </div>

                            {tools.length === 0 ? (
                                <p className="text-sm text-slate-500 italic">
                                    No tools installed yet. Upload a spec and install a connector first!
                                </p>
                            ) : (
                                <div className="space-y-3">
                                    {tools.map((tool, idx) => (
                                        <div
                                            key={idx}
                                            className="p-3 bg-slate-50 rounded-lg border border-slate-200"
                                        >
                                            <div className="font-semibold text-sm text-slate-900 mb-1">
                                                {tool.name}
                                            </div>
                                            {tool.metadata?.description && typeof tool.metadata.description === 'string' && (
                                                <div className="text-xs text-slate-600 mb-2">
                                                    {tool.metadata.description}
                                                </div>
                                            )}
                                            {tool.metadata?.endpoint && typeof tool.metadata.endpoint === 'string' && (
                                                <div className="text-xs text-slate-500 mb-2 font-mono truncate">
                                                    {tool.metadata.endpoint}
                                                </div>
                                            )}
                                            <div className="text-xs text-slate-500">
                                                Exports: {Array.isArray(tool.exports) ? tool.exports.join(', ') : 'none'}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}


                        </div>

                        {/* Console Logs */}
                        <div className="bg-white rounded-xl border-2 border-slate-200 shadow-sm p-4">
                            <h2 className="text-lg font-bold text-slate-900 mb-4">Console</h2>
                            <ConsoleLog sessionId={sessionId} />
                        </div>
                    </div>

                    {/* Main Chat Area */}
                    <div className="lg:col-span-3">
                        <div className="bg-white rounded-xl border-2 border-slate-200 shadow-sm flex flex-col h-[calc(100vh-16rem)]">
                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto p-6 space-y-4">
                                {messages.length === 0 && (
                                    <div className="text-center py-12">
                                        <MessageCircle className="w-16 h-16 mx-auto mb-4 text-slate-400" />
                                        <h3 className="text-xl font-bold text-slate-900 mb-2">
                                            Start a conversation
                                        </h3>
                                        <p className="text-slate-600 max-w-md mx-auto">
                                            Describe your integration needs and I'll design a complete workflow solution
                                        </p>
                                        <div className="mt-6 space-y-2">
                                            <p className="text-sm font-semibold text-slate-700">Try these examples:</p>
                                            <div className="space-y-2 text-sm text-slate-600 max-w-lg mx-auto">
                                                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-left">
                                                    <div className="font-semibold text-blue-700 mb-1">With Registered Skills:</div>
                                                    "List all posts" (JSONPlaceholder)
                                                    <br />"Get post #5" (JSONPlaceholder)
                                                    <br />"Show repos for cloudflare" (GitHub)
                                                </div>
                                                <div className="p-3 bg-orange-50 rounded-lg border border-orange-200 text-left">
                                                    <div className="font-semibold text-orange-700 mb-1">Workflow Design:</div>
                                                    "Sync Stripe customers to Airtable"
                                                    <br />"Process payment and send email"
                                                </div>
                                            </div>
                                            <div className="mt-4 text-xs text-slate-500 flex items-center justify-center gap-1">
                                                <Bot className="w-3 h-3" /> Register API skills on the <strong>Skills</strong> page to enable execution
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {messages.map((msg, idx) => (
                                    <div
                                        key={idx}
                                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                    >
                                        <div
                                            className={`max-w-[80%] rounded-lg p-4 ${msg.role === 'user'
                                                ? 'bg-orange-600 text-white'
                                                : 'bg-slate-100 text-slate-900'
                                                }`}
                                        >
                                            <div className="text-sm font-semibold mb-1 opacity-75">
                                                {msg.role === 'user' ? 'You' : 'AI Assistant'}
                                            </div>
                                            <div className="whitespace-pre-wrap">{msg.content}</div>

                                            {/* Skill Execution Results */}
                                            {msg.skillExecutions && msg.skillExecutions.length > 0 && (
                                                <div className="mt-3 space-y-2">
                                                    <div className="text-xs font-semibold text-blue-600 mb-2 flex items-center gap-1">
                                                        <Bot className="w-4 h-4" /> AI executed {msg.skillExecutions.length} skill{msg.skillExecutions.length !== 1 ? 's' : ''}:
                                                    </div>
                                                    {msg.skillExecutions.map((exec, execIdx) => (
                                                        <div
                                                            key={execIdx}
                                                            className={`text-xs p-3 rounded border-2 ${exec.success
                                                                ? 'bg-blue-50 border-blue-200 text-blue-900'
                                                                : 'bg-red-50 border-red-200 text-red-900'
                                                                }`}
                                                        >
                                                            <div className="font-bold mb-1 flex items-center gap-1">
                                                                {exec.success ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <XCircle className="w-4 h-4 text-red-600" />} {exec.skill}
                                                            </div>
                                                            {exec.success ? (
                                                                <div className="font-mono text-xs overflow-x-auto max-h-48">
                                                                    <pre>{JSON.stringify(exec.result, null, 2)}</pre>
                                                                </div>
                                                            ) : (
                                                                <div className="text-red-700">Error: {exec.error}</div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Tool Execution Results (legacy) */}
                                            {msg.toolExecutions && msg.toolExecutions.length > 0 && (
                                                <div className="mt-3 space-y-2">
                                                    {msg.toolExecutions.map((exec, execIdx) => (
                                                        <div
                                                            key={execIdx}
                                                            className={`text-xs p-3 rounded border-2 ${exec.success
                                                                ? 'bg-green-50 border-green-200 text-green-900'
                                                                : 'bg-red-50 border-red-200 text-red-900'
                                                                }`}
                                                        >
                                                            <div className="font-bold mb-1 flex items-center gap-1">
                                                                <Wrench className="w-4 h-4" /> {exec.tool}
                                                                {exec.export && `.${exec.export}`}
                                                            </div>
                                                            {exec.success ? (
                                                                <div className="font-mono text-xs overflow-x-auto">
                                                                    <pre>{JSON.stringify(exec.result, null, 2)}</pre>
                                                                </div>
                                                            ) : (
                                                                <div className="text-red-700">Error: {exec.error}</div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}

                                {loading && (
                                    <div className="flex justify-start">
                                        <div className="bg-slate-100 rounded-lg p-4">
                                            <div className="flex items-center space-x-2">
                                                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
                                                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-100" />
                                                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-200" />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div ref={messagesEndRef} />
                            </div>

                            {/* Input Area */}
                            <div className="border-t-2 border-slate-200 p-4">
                                <div className="flex items-end space-x-3">
                                    <textarea
                                        value={inputValue}
                                        onChange={(e) => setInputValue(e.target.value)}
                                        onKeyDown={handleKeyPress}
                                        placeholder="Ask AI to use your tools or get help..."
                                        rows={2}
                                        disabled={loading}
                                        className="flex-1 px-4 py-3 border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none disabled:bg-slate-50 disabled:text-slate-500"
                                    />
                                    <div className="flex flex-col space-y-2">
                                        <button
                                            onClick={sendMessage}
                                            disabled={loading || !inputValue.trim()}
                                            className="px-6 py-3 bg-orange-600 text-white font-semibold rounded-lg hover:bg-orange-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors shadow-sm hover:shadow-md flex items-center gap-2"
                                        >
                                            {loading ? '...' : (
                                                <>
                                                    <Send className="w-4 h-4" /> Send
                                                </>
                                            )}
                                        </button>
                                        {messages.length > 0 && (
                                            <button
                                                onClick={clearChat}
                                                disabled={loading}
                                                className="px-6 py-2 text-sm border-2 border-slate-300 text-slate-700 font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                            >
                                                Clear
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="mt-2 text-xs text-slate-500">
                                    Press Enter to send, Shift+Enter for new line
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
