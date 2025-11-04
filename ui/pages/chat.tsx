import React, { useState, useEffect, useRef } from 'react';

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
}

interface Tool {
    name: string;
    exports: string[];
    metadata?: {
        description?: string;
        endpoint?: string;
    };
    installedAt: string;
}

declare const window: any;

function showAlert(msg: string) {
    if (typeof window !== 'undefined' && window.alert) {
        window.alert(msg);
    } else {
        console.warn('Alert:', msg);
    }
}

export default function ChatPage() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [loading, setLoading] = useState(false);
    const [tools, setTools] = useState<Tool[]>([]);
    const [autoExecute, setAutoExecute] = useState(true);
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
            const response = await fetch('http://localhost:8787/api/tools');
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

        try {
            const response = await fetch('http://localhost:8787/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: inputValue,
                    autoExecuteTools: autoExecute,
                }),
            });

            const data = await response.json() as any;

            const assistantMessage: Message = {
                role: 'assistant',
                content: data.response || 'No response',
                toolExecutions: data.toolExecutions,
            };

            setMessages((prev) => [...prev, assistantMessage]);
        } catch (error) {
            showAlert('Failed to send message: ' + (error as Error).message);
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
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-4xl font-extrabold text-slate-900 mb-3">
                        AI Chat <span className="text-orange-600">with Tools</span>
                    </h1>
                    <p className="text-slate-600 text-lg">
                        Chat with an AI assistant that can use your installed API connectors
                    </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    {/* Sidebar - Installed Tools */}
                    <div className="lg:col-span-1">
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
                                            {tool.metadata?.description && (
                                                <div className="text-xs text-slate-600 mb-2">
                                                    {tool.metadata.description}
                                                </div>
                                            )}
                                            {tool.metadata?.endpoint && (
                                                <div className="text-xs text-slate-500 mb-2 font-mono truncate">
                                                    {tool.metadata.endpoint}
                                                </div>
                                            )}
                                            <div className="text-xs text-slate-500">
                                                Exports: {tool.exports.join(', ')}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="mt-6 pt-4 border-t border-slate-200">
                                <label className="flex items-center space-x-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={autoExecute}
                                        onChange={(e) => setAutoExecute(e.target.checked)}
                                        className="w-4 h-4 text-orange-600 rounded focus:ring-orange-500"
                                    />
                                    <span className="text-sm text-slate-700">Auto-execute tools</span>
                                </label>
                                <p className="text-xs text-slate-500 mt-2">
                                    When enabled, AI will automatically call appropriate tools based on your message
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Main Chat Area */}
                    <div className="lg:col-span-3">
                        <div className="bg-white rounded-xl border-2 border-slate-200 shadow-sm flex flex-col h-[calc(100vh-16rem)]">
                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto p-6 space-y-4">
                                {messages.length === 0 && (
                                    <div className="text-center py-12">
                                        <div className="text-6xl mb-4">💬</div>
                                        <h3 className="text-xl font-bold text-slate-900 mb-2">
                                            Start a conversation
                                        </h3>
                                        <p className="text-slate-600 max-w-md mx-auto">
                                            Ask the AI to use your installed tools, or get help with the workflow
                                        </p>
                                        {tools.length > 0 && (
                                            <div className="mt-6 space-y-2">
                                                <p className="text-sm font-semibold text-slate-700">Try asking:</p>
                                                <div className="space-y-1 text-sm text-slate-600">
                                                    <div>"Test the {tools[0].name} connector"</div>
                                                    <div>"Show me what {tools[0].name} can do"</div>
                                                    <div>"Call {tools[0].exports[0]} with my data"</div>
                                                </div>
                                            </div>
                                        )}
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

                                            {/* Tool Execution Results */}
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
                                                            <div className="font-bold mb-1">
                                                                🔧 {exec.tool}
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
                                            className="px-6 py-3 bg-orange-600 text-white font-semibold rounded-lg hover:bg-orange-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors shadow-sm hover:shadow-md"
                                        >
                                            {loading ? '...' : 'Send'}
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
