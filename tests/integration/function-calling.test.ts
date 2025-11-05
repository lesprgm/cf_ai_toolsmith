import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../../workers/index';
import { SessionState } from '../../workers/durable_objects/SessionState';
import { ToolRegistry } from '../../workers/durable_objects/ToolRegistry';

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

    async list<T>(options?: { prefix?: string }): Promise<Array<[string, T]>> {
        const entries = Array.from(this.store.entries()) as Array<[string, T]>;
        if (!options?.prefix) {
            return entries;
        }
        return entries.filter(([key]) => key.startsWith(options.prefix!));
    }

    snapshot(key: string) {
        return this.store.get(key);
    }
}

const createMockEnv = (aiResponseOverride?: any) => {
    const sessionStorage = new MockStorage();
    const sessionState = { storage: sessionStorage } as any;
    const sessionInstance = new SessionState(sessionState, {});

    const toolStorage = new MockStorage();
    const toolState = { storage: toolStorage } as any;
    const toolRegistryInstance = new ToolRegistry(toolState, {});

    return {
        env: {
            AI: {
                run: vi.fn(async (_model: string, config: any) => {
                    if (aiResponseOverride) {
                        return aiResponseOverride(config);
                    }
                    return { response: 'Default AI response' };
                })
            },
            SESSION_STATE: {
                idFromName: () => ({ toString: () => 'session-id' }),
                get: () => ({
                    fetch: async (url: string | URL, init?: RequestInit) => {
                        const request = typeof url === 'string' ? new Request(url, init) : new Request(url, init);
                        return sessionInstance.fetch(request);
                    }
                })
            },
            TOOL_REGISTRY: {
                idFromName: () => ({ toString: () => 'tool-registry-id' }),
                get: () => ({
                    fetch: async (url: string | URL, init?: RequestInit) => {
                        const request = typeof url === 'string' ? new Request(url, init) : new Request(url, init);
                        return toolRegistryInstance.fetch(request);
                    }
                })
            }
        } as any,
        sessionStorage,
        toolStorage
    };
};

describe('Integration - Function Calling', () => {
    describe('Tool Schema Generation', () => {
        it('generates OpenAI-style function schemas for installed tools', async () => {
            const { env, toolStorage } = createMockEnv();

            // Install a test tool
            await toolStorage.put('tool:weather', {
                name: 'weather',
                code: 'export const getWeather = async (params) => ({ temp: 72 });',
                exports: ['getWeather'],
                metadata: {
                    description: 'Get weather information',
                    endpoint: 'api.weather.com'
                },
                installedAt: new Date().toISOString()
            });

            let capturedTools: any = null;
            env.AI.run = vi.fn(async (_model: string, config: any) => {
                capturedTools = config.tools;
                return { response: 'Weather is sunny' };
            });

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test-session' },
                body: JSON.stringify({
                    message: 'What is the weather?',
                    autoExecuteTools: true
                })
            });

            await worker.fetch(request, env);

            expect(capturedTools).toBeDefined();
            expect(Array.isArray(capturedTools)).toBe(true);
            expect(capturedTools).toHaveLength(1);
            expect(capturedTools[0]).toMatchObject({
                type: 'function',
                function: {
                    name: 'weather',
                    description: 'Get weather information',
                    parameters: {
                        type: 'object',
                        properties: {
                            exportName: {
                                type: 'string',
                                description: 'Available exports: getWeather',
                                enum: ['getWeather']
                            },
                            params: {
                                type: 'object',
                                description: 'Parameters object to pass to the tool function'
                            }
                        },
                        required: ['exportName']
                    }
                }
            });
        });

        it('includes tool_choice: auto when tools are available', async () => {
            const { env, toolStorage } = createMockEnv();

            await toolStorage.put('tool:api', {
                name: 'api',
                code: 'export default async () => ({ data: true });',
                exports: ['default'],
                metadata: { description: 'API tool' },
                installedAt: new Date().toISOString()
            });

            let capturedConfig: any = null;
            env.AI.run = vi.fn(async (_model: string, config: any) => {
                capturedConfig = config;
                return { response: 'Done' };
            });

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
                body: JSON.stringify({ message: 'Use the API', autoExecuteTools: true })
            });

            await worker.fetch(request, env);

            expect(capturedConfig.tool_choice).toBe('auto');
            expect(capturedConfig.tools).toBeDefined();
        });

        it('does not include tools when autoExecuteTools is false', async () => {
            const { env, toolStorage } = createMockEnv();

            await toolStorage.put('tool:api', {
                name: 'api',
                code: 'export default async () => ({ data: true });',
                exports: ['default'],
                metadata: { description: 'API tool' },
                installedAt: new Date().toISOString()
            });

            let capturedConfig: any = null;
            env.AI.run = vi.fn(async (_model: string, config: any) => {
                capturedConfig = config;
                return { response: 'OK' };
            });

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
                body: JSON.stringify({ message: 'Hello', autoExecuteTools: false })
            });

            await worker.fetch(request, env);

            expect(capturedConfig.tools).toBeUndefined();
            expect(capturedConfig.tool_choice).toBeUndefined();
        });

        it('handles tools with no exports', async () => {
            const { env, toolStorage } = createMockEnv();

            await toolStorage.put('tool:simple', {
                name: 'simple',
                code: 'console.log("hi");',
                exports: [],
                metadata: { description: 'Simple tool' },
                installedAt: new Date().toISOString()
            });

            let capturedTools: any = null;
            env.AI.run = vi.fn(async (_model: string, config: any) => {
                capturedTools = config.tools;
                return { response: 'OK' };
            });

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
                body: JSON.stringify({ message: 'Test', autoExecuteTools: true })
            });

            await worker.fetch(request, env);

            expect(capturedTools[0].function.parameters.required).toEqual([]);
        });
    });

    describe('Tool Call Execution', () => {
        it('executes tool when AI returns tool_calls', async () => {
            const { env, toolStorage } = createMockEnv();

            await toolStorage.put('tool:calculator', {
                name: 'calculator',
                code: 'export const add = (params) => ({ result: params.a + params.b });',
                exports: ['add'],
                metadata: { description: 'Math operations' },
                installedAt: new Date().toISOString()
            });

            let callCount = 0;
            env.AI.run = vi.fn(async (_model: string, config: any) => {
                callCount++;
                if (callCount === 1) {
                    // First call: AI decides to use tool
                    return {
                        response: 'I will calculate that for you',
                        tool_calls: [{
                            id: 'call_1',
                            type: 'function',
                            function: {
                                name: 'calculator',
                                arguments: {
                                    exportName: 'add',
                                    params: { a: 5, b: 3 }
                                }
                            }
                        }]
                    };
                } else {
                    // Second call: AI responds with result
                    return { response: 'The sum of 5 and 3 is 8' };
                }
            });

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
                body: JSON.stringify({
                    message: 'What is 5 + 3?',
                    autoExecuteTools: true
                })
            });

            const response = await worker.fetch(request, env);
            const result = await response.json() as any;

            expect(result.toolExecutions).toBeDefined();
            expect(result.toolExecutions).toHaveLength(1);
            expect(result.toolExecutions[0]).toMatchObject({
                tool: 'calculator',
                export: 'add',
                success: expect.any(Boolean)
            });

            expect(env.AI.run).toHaveBeenCalledTimes(2);
            expect(result.response).toBe('The sum of 5 and 3 is 8');
        });

        it('handles multiple tool calls in sequence', async () => {
            const { env, toolStorage } = createMockEnv();

            await toolStorage.put('tool:weather', {
                name: 'weather',
                code: 'export const get = () => ({ temp: 72 });',
                exports: ['get'],
                metadata: { description: 'Weather API' },
                installedAt: new Date().toISOString()
            });

            await toolStorage.put('tool:news', {
                name: 'news',
                code: 'export const headlines = () => ({ news: "Sunny today" });',
                exports: ['headlines'],
                metadata: { description: 'News API' },
                installedAt: new Date().toISOString()
            });

            let callCount = 0;
            env.AI.run = vi.fn(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        response: 'Checking weather and news',
                        tool_calls: [
                            {
                                function: {
                                    name: 'weather',
                                    arguments: { exportName: 'get', params: {} }
                                }
                            },
                            {
                                function: {
                                    name: 'news',
                                    arguments: { exportName: 'headlines', params: {} }
                                }
                            }
                        ]
                    };
                }
                return { response: 'Weather is 72°F and news says sunny today' };
            });

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
                body: JSON.stringify({
                    message: 'Get weather and news',
                    autoExecuteTools: true
                })
            });

            const response = await worker.fetch(request, env);
            const result = await response.json() as any;

            expect(result.toolExecutions).toHaveLength(2);
            expect(result.toolExecutions[0].tool).toBe('weather');
            expect(result.toolExecutions[1].tool).toBe('news');
        });

        it('handles tool execution errors gracefully', async () => {
            const { env, toolStorage } = createMockEnv();

            await toolStorage.put('tool:broken', {
                name: 'broken',
                code: 'export const fail = () => { throw new Error("Broken"); };',
                exports: ['fail'],
                metadata: { description: 'Broken tool' },
                installedAt: new Date().toISOString()
            });

            let callCount = 0;
            env.AI.run = vi.fn(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        response: 'Trying broken tool',
                        tool_calls: [{
                            function: {
                                name: 'broken',
                                arguments: { exportName: 'fail', params: {} }
                            }
                        }]
                    };
                }
                return { response: 'The tool encountered an error' };
            });

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
                body: JSON.stringify({
                    message: 'Use broken tool',
                    autoExecuteTools: true
                })
            });

            const response = await worker.fetch(request, env);
            const result = await response.json() as any;

            expect(result.toolExecutions).toHaveLength(1);
            expect(result.toolExecutions[0]).toMatchObject({
                tool: 'broken',
                success: false,
                error: expect.stringContaining('Dynamic connector execution is unavailable')
            });
        });
    });

    describe('Function Calling vs Text Mode', () => {
        it('uses function calling when autoExecuteTools is true', async () => {
            const { env, toolStorage } = createMockEnv();

            await toolStorage.put('tool:test', {
                name: 'test',
                code: 'export default () => ({ ok: true });',
                exports: ['default'],
                metadata: { description: 'Test tool' },
                installedAt: new Date().toISOString()
            });

            let usedTools = false;
            env.AI.run = vi.fn(async (_model: string, config: any) => {
                if (config.tools) usedTools = true;
                return { response: 'OK' };
            });

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
                body: JSON.stringify({
                    message: 'Test message',
                    autoExecuteTools: true
                })
            });

            await worker.fetch(request, env);
            expect(usedTools).toBe(true);
        });

        it('uses text mode when autoExecuteTools is false', async () => {
            const { env, toolStorage } = createMockEnv();

            await toolStorage.put('tool:test', {
                name: 'test',
                code: 'export default () => ({ ok: true });',
                exports: ['default'],
                metadata: { description: 'Test tool' },
                installedAt: new Date().toISOString()
            });

            let usedTools = false;
            env.AI.run = vi.fn(async (_model: string, config: any) => {
                if (config.tools) usedTools = true;
                return { response: 'OK' };
            });

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
                body: JSON.stringify({
                    message: 'Test message',
                    autoExecuteTools: false
                })
            });

            await worker.fetch(request, env);
            expect(usedTools).toBe(false);
        });
    });

    describe('Conversation Context', () => {
        it('includes tool results in follow-up AI request', async () => {
            const { env, toolStorage } = createMockEnv();

            await toolStorage.put('tool:data', {
                name: 'data',
                code: 'export const fetch = () => ({ value: 42 });',
                exports: ['fetch'],
                metadata: { description: 'Data tool' },
                installedAt: new Date().toISOString()
            });

            let secondCallMessages: any[] = [];
            let callCount = 0;
            env.AI.run = vi.fn(async (_model: string, config: any) => {
                callCount++;
                if (callCount === 1) {
                    return {
                        response: 'Fetching data',
                        tool_calls: [{
                            function: {
                                name: 'data',
                                arguments: { exportName: 'fetch', params: {} }
                            }
                        }]
                    };
                }
                secondCallMessages = config.messages;
                return { response: 'The value is 42' };
            });

            const request = new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'test' },
                body: JSON.stringify({
                    message: 'Get the data',
                    autoExecuteTools: true
                })
            });

            await worker.fetch(request, env);

            expect(secondCallMessages.length).toBeGreaterThan(2);
            // Verify tool role messages are included (proper OpenAI function calling pattern)
            const toolMessages = secondCallMessages.filter((m: any) => m.role === 'tool');
            expect(toolMessages.length).toBeGreaterThan(0);
            expect(toolMessages[0]).toHaveProperty('name', 'data');
        });

        it('preserves chat history across requests', async () => {
            const { env, sessionStorage } = createMockEnv();

            env.AI.run = vi.fn(async () => ({ response: 'Response' }));

            // First message
            await worker.fetch(new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'session-1' },
                body: JSON.stringify({ message: 'First message' })
            }), env);

            // Second message
            await worker.fetch(new Request('https://example.com/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'session-1' },
                body: JSON.stringify({ message: 'Second message' })
            }), env);

            const history = sessionStorage.snapshot('history');
            expect(history).toHaveLength(4); // 2 user + 2 assistant
            expect(history[0].content).toBe('First message');
            expect(history[2].content).toBe('Second message');
        });
    });
});
