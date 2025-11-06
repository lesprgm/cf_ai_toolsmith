import type { Env } from './bindings';
import { getGlobalLogger } from './utils/log';
import { SessionState as SessionStateImpl } from './durable_objects/SessionState';
import { SkillRegistry as SkillRegistryImpl } from './durable_objects/SkillRegistry';
import { parseOpenAPIToSkills, skillsToAIToolSchemas, executeSkill } from './skill-parser';

export class SessionState extends SessionStateImpl { }
export class SkillRegistry extends SkillRegistryImpl { }

const MAX_HISTORY_CHARS = 50_000;
const MAX_MODEL_TOKENS = 120_000;
const CHARS_PER_TOKEN = 4;
const STREAM_FLUSH_INTERVAL_MS = 250;

interface ScenarioRunResult {
    name: string;
    success: boolean;
    status?: number;
    durationMs?: number;
    error?: string;
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-Session-ID, X-User-ID',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            if (url.pathname === '/api/skills/register' && request.method === 'POST') {
                const body = await request.json<any>();
                const { apiName, spec, apiKey } = body;

                if (!apiName || !spec) {
                    return jsonResponse({ error: 'apiName and spec are required' }, 400, corsHeaders);
                }

                try {
                    const { skills, baseUrl, metadata } = parseOpenAPIToSkills(spec);

                    if (skills.length === 0) {
                        return jsonResponse({ error: 'No valid operations found in OpenAPI spec' }, 400, corsHeaders);
                    }

                    const encryptedApiKey = apiKey ? btoa(apiKey) : '';

                    const userId = request.headers.get('X-User-ID') || 'default';
                    const skillRegistryId = env.SKILL_REGISTRY.idFromName('global');
                    const skillRegistryStub = env.SKILL_REGISTRY.get(skillRegistryId);

                    const response = await skillRegistryStub.fetch('http://internal/register', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-User-ID': userId
                        },
                        body: JSON.stringify({
                            apiName,
                            skills,
                            baseUrl,
                            encryptedApiKey,
                            metadata
                        })
                    });

                    const result = await response.json<any>();
                    return jsonResponse(result, response.status, corsHeaders);
                } catch (error) {
                    return jsonResponse({
                        error: 'Failed to parse OpenAPI spec',
                        details: (error as Error).message
                    }, 400, corsHeaders);
                }
            }

            if (url.pathname === '/api/skills/list' && request.method === 'GET') {
                const userId = request.headers.get('X-User-ID') || 'default';
                const skillRegistryId = env.SKILL_REGISTRY.idFromName('global');
                const skillRegistryStub = env.SKILL_REGISTRY.get(skillRegistryId);

                const response = await skillRegistryStub.fetch('http://internal/list', {
                    method: 'GET',
                    headers: { 'X-User-ID': userId }
                });

                const result = await response.json<any>();
                return jsonResponse(result, response.status, corsHeaders);
            }

            if (url.pathname === '/api/skills/delete' && request.method === 'POST') {
                const body = await request.json<any>();
                const { apiName } = body;

                if (!apiName) {
                    return jsonResponse({ error: 'apiName is required' }, 400, corsHeaders);
                }

                const userId = request.headers.get('X-User-ID') || 'default';
                const skillRegistryId = env.SKILL_REGISTRY.idFromName('global');
                const skillRegistryStub = env.SKILL_REGISTRY.get(skillRegistryId);

                const response = await skillRegistryStub.fetch('http://internal/delete', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-User-ID': userId
                    },
                    body: JSON.stringify({ apiName })
                });

                const result = await response.json<any>();
                return jsonResponse(result, response.status, corsHeaders);
            }

            if (url.pathname === '/api/chat' && request.method === 'POST') {
                const body = await request.json<any>();
                const { message: prompt, persona } = body;

                if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
                    return jsonResponse({ error: 'Message is required and must be a non-empty string' }, 400, corsHeaders);
                }

                const message = prompt.trim();
                const sessionStub = getSessionStub(env, request);

                await sessionStub.fetch('http://internal/add-message', {
                    method: 'POST',
                    body: JSON.stringify({ role: 'user', content: message }),
                });

                const historyResp = await sessionStub.fetch('http://internal/get-history');
                const history = (await historyResp.json<any>()) as any[];
                const trimmedHistory = trimChatHistory(history);

                const userId = request.headers.get('X-User-ID') || 'default';
                const skillRegistryId = env.SKILL_REGISTRY.idFromName('global');
                const skillRegistryStub = env.SKILL_REGISTRY.get(skillRegistryId);

                const skillsResponse = await skillRegistryStub.fetch('http://internal/get-skills', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-User-ID': userId
                    },
                    body: JSON.stringify({})
                });

                const skillsData = await skillsResponse.json<any>();
                const userApis = skillsData.apis || {};

                const allSkills: any[] = [];
                for (const apiData of Object.values(userApis) as any[]) {
                    for (const skill of apiData.skills || []) {
                        allSkills.push({
                            ...skill,
                            apiName: apiData.apiName,
                            apiKey: apiData.encryptedApiKey,
                            baseUrl: apiData.baseUrl
                        });
                    }
                }

                console.log(`[Chat] User ${userId} has ${allSkills.length} skills from ${Object.keys(userApis).length} APIs`);

                let scenarioRunResults: ScenarioRunResult[] | null = null;
                let scenarioRunSummary: string | null = null;

                if (shouldRunSmokeSuite(message)) {
                    const scenarioResp = await sessionStub.fetch('http://internal/scenarios/run', {
                        method: 'POST',
                        body: JSON.stringify({ trigger: 'chat' }),
                        headers: { 'Content-Type': 'application/json' },
                    });

                    const scenarioData = await scenarioResp.json<any>().catch(() => ({}));
                    if (scenarioResp.ok) {
                        const rawResults = Array.isArray(scenarioData?.results) ? scenarioData.results : [];
                        scenarioRunResults = rawResults as ScenarioRunResult[];
                        scenarioRunSummary = formatScenarioSuiteSummary(scenarioRunResults);
                    } else {
                        const errorMessage = scenarioData?.error || `Smoke suite failed with status ${scenarioResp.status}`;
                        scenarioRunSummary = errorMessage;
                    }
                }

                let finalPrompt = message;
                if (scenarioRunSummary) {
                    finalPrompt += `\n\nSmoke test results:\n${scenarioRunSummary}`;
                }

                const personaInstruction = resolvePersonaInstruction(persona);

                const skillsDescription = allSkills.length > 0
                    ? `\n\n**Your Registered Skills (${allSkills.length} total):**\n${allSkills.map(s =>
                        `- ${s.name}: ${s.description} [${s.apiName}]`
                    ).slice(0, 10).join('\n')}${allSkills.length > 10 ? `\n... and ${allSkills.length - 10} more` : ''}`
                    : '\n\n**Note:** User has not registered any API skills yet. Suggest uploading OpenAPI specs to enable skill execution.';

                const systemContent = [
                    'You are a helpful AI assistant. You can have normal conversations with users and also help them interact with their registered API skills when needed.',
                    '',
                    '**Important Guidelines:**',
                    '- Have natural conversations - respond to greetings, questions, and casual chat normally',
                    '- ONLY use skills when the user explicitly asks to interact with an API or fetch external data',
                    '- Do NOT call skills for greetings like "hello", "hi", or general questions',
                    '- Skills are tools for API interactions, not for every response',
                    '',
                    '**When to Use Skills:**',
                    '- User asks for weather, data, or information from a specific API',
                    '- User explicitly requests to "fetch", "get", "show me", or "retrieve" data',
                    '- User mentions a registered API by name (e.g., "check the weather API")',
                    '',
                    '**When NOT to Use Skills:**',
                    '- Greetings and casual conversation',
                    '- General knowledge questions you can answer directly',
                    '- Asking about your capabilities or how things work',
                    '- The user is just chatting or making small talk',
                    '',
                    personaInstruction,
                    skillsDescription,
                ]
                    .filter(Boolean)
                    .join('\n');

                const contextMessages = [{ role: 'system', content: systemContent }];

                console.log(`[Chat] System prompt includes:\n${systemContent.substring(0, 500)}...\n[Skills section]: ${skillsDescription.substring(0, 300)}`);

                const userMessage = { role: 'user' as const, content: finalPrompt };
                let finalHistory = trimmedHistory;
                let allMessages = [...contextMessages, ...finalHistory, userMessage];
                let estimatedTokens = estimateMessageTokens(allMessages as any);

                if (estimatedTokens > MAX_MODEL_TOKENS) {
                    const overageTokens = estimatedTokens - MAX_MODEL_TOKENS;
                    const tokensToRemove = overageTokens + 1000;
                    const charsToRemove = tokensToRemove * CHARS_PER_TOKEN;

                    let removedChars = 0;
                    const newHistory = [];
                    for (let i = finalHistory.length - 1; i >= 0; i--) {
                        const msg = finalHistory[i];
                        if (removedChars >= charsToRemove) {
                            newHistory.unshift(msg);
                        } else {
                            removedChars += msg.content.length;
                        }
                    }
                    finalHistory = newHistory;
                    allMessages = [...contextMessages, ...finalHistory, userMessage];
                    estimatedTokens = estimateMessageTokens(allMessages as any);
                }

                const skillSchemas = allSkills.length > 0 ? skillsToAIToolSchemas(allSkills) : [];
                const hasSkills = skillSchemas.length > 0;

                const shouldOfferTools = hasSkills && shouldEnableSkillTools(message, allSkills);

                console.log(`[Chat] Converted to ${skillSchemas.length} AI tool schemas, hasSkills=${hasSkills}, shouldOfferTools=${shouldOfferTools}`);

                const enableStreaming = body.stream !== false;

                if (enableStreaming) {
                    const encoder = new TextEncoder();
                    const aiMessages = [...contextMessages, ...finalHistory, { role: 'user', content: finalPrompt }];

                    let fullResponse = '';
                    let aiResponseData: any = null;
                    const stream = new ReadableStream({
                        async start(controller) {
                            try {
                                const aiConfig: any = {
                                    messages: aiMessages,
                                    stream: false
                                };

                                if (shouldOfferTools) {
                                    aiConfig.tools = skillSchemas;
                                }

                                aiResponseData = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', aiConfig);

                                if (scenarioRunResults) {
                                    const scenarioInfo = {
                                        type: 'scenario_results',
                                        data: { results: scenarioRunResults, summary: scenarioRunSummary }
                                    };
                                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(scenarioInfo)}\n\n`));
                                }

                                fullResponse = aiResponseData.response || 'No response';

                                const skillExecutions: any[] = [];
                                if (aiResponseData.tool_calls && Array.isArray(aiResponseData.tool_calls) && aiResponseData.tool_calls.length > 0) {
                                    const executingData = {
                                        type: 'executing_skills',
                                        data: { count: aiResponseData.tool_calls.length }
                                    };
                                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(executingData)}\n\n`));

                                    for (let i = 0; i < aiResponseData.tool_calls.length; i++) {
                                        const toolCall = aiResponseData.tool_calls[i];
                                        const toolCallId = toolCall.id || `call_${i}`;
                                        const skillName = toolCall.function?.name || toolCall.name;
                                        const rawArgs = toolCall.function?.arguments || toolCall.arguments;

                                        if (!toolCall.id) toolCall.id = toolCallId;
                                        if (!toolCall.type) toolCall.type = 'function';

                                        if (!toolCall.function && toolCall.name) {
                                            toolCall.function = {
                                                name: toolCall.name,
                                                arguments: typeof toolCall.arguments === 'string'
                                                    ? toolCall.arguments
                                                    : JSON.stringify(toolCall.arguments || {})
                                            };
                                        } else if (toolCall.function && typeof toolCall.function.arguments !== 'string') {
                                            toolCall.function.arguments = JSON.stringify(toolCall.function.arguments || {});
                                        }

                                        let args: Record<string, any> = {};
                                        if (typeof rawArgs === 'string') {
                                            try {
                                                args = JSON.parse(rawArgs);
                                            } catch (err) {
                                                skillExecutions.push({
                                                    skill: skillName,
                                                    success: false,
                                                    error: `Failed to parse arguments: ${(err as Error).message}`
                                                });
                                                continue;
                                            }
                                        } else if (rawArgs && typeof rawArgs === 'object') {
                                            args = rawArgs;
                                        }

                                        const skill = allSkills.find(s => s.name === skillName);
                                        if (!skill) {
                                            skillExecutions.push({
                                                skill: skillName,
                                                success: false,
                                                error: `Skill ${skillName} not found in user's registered skills`
                                            });
                                            continue;
                                        }

                                        try {
                                            const decryptedKey = skill.apiKey ? atob(skill.apiKey) : '';
                                            const result = await executeSkill(skill, args, decryptedKey);

                                            skillExecutions.push({
                                                skill: skillName,
                                                toolCallId: toolCallId,
                                                success: true,
                                                result: result
                                            });

                                            const skillResult = {
                                                type: 'skill_result',
                                                data: {
                                                    skill: skillName,
                                                    success: true,
                                                    result: result
                                                }
                                            };
                                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(skillResult)}\n\n`));
                                        } catch (error) {
                                            const errorMessage = (error as Error).message || 'Unknown error';
                                            skillExecutions.push({
                                                skill: skillName,
                                                toolCallId: toolCallId,
                                                success: false,
                                                error: errorMessage
                                            });

                                            const skillResult = {
                                                type: 'skill_result',
                                                data: {
                                                    skill: skillName,
                                                    success: false,
                                                    error: errorMessage
                                                }
                                            };
                                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(skillResult)}\n\n`));
                                        }
                                    }

                                    if (skillExecutions.length > 0) {
                                        const toolMessages = skillExecutions.map(exec => ({
                                            role: 'tool' as const,
                                            content: exec.success
                                                ? JSON.stringify(exec.result)
                                                : `Error: ${exec.error}`,
                                            tool_call_id: exec.toolCallId
                                        }));

                                        const finalAiMessages = [
                                            ...aiMessages,
                                            { role: 'assistant' as const, content: fullResponse, tool_calls: aiResponseData.tool_calls },
                                            ...toolMessages
                                        ];

                                        const finalAiResponse = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
                                            messages: finalAiMessages,
                                            stream: false
                                        });

                                        fullResponse = finalAiResponse.response || fullResponse;
                                    }
                                }

                                for (let i = 0; i < fullResponse.length; i++) {
                                    const chunk = fullResponse[i];
                                    const chunkData = {
                                        type: 'content',
                                        data: chunk
                                    };
                                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunkData)}\n\n`));
                                }

                                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                                controller.close();

                                await sessionStub.fetch('http://internal/add-message', {
                                    method: 'POST',
                                    body: JSON.stringify({
                                        role: 'assistant',
                                        content: fullResponse,
                                        skillExecutions: skillExecutions.length > 0 ? skillExecutions : undefined
                                    }),
                                });

                            } catch (error) {
                                const errorMessage = describeAiError(error);
                                console.error('[Chat streaming error]', errorMessage);
                                const errorResponse = `I apologize, but I encountered an error while processing your request. The AI service is currently unavailable or encountered an issue: ${errorMessage}`;

                                for (let i = 0; i < errorResponse.length; i++) {
                                    const chunk = errorResponse[i];
                                    const chunkData = {
                                        type: 'content',
                                        data: chunk
                                    };
                                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunkData)}\n\n`));
                                }

                                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                                controller.close();

                                await sessionStub.fetch('http://internal/add-message', {
                                    method: 'POST',
                                    body: JSON.stringify({ role: 'assistant', content: errorResponse }),
                                });
                            }
                        },
                    });

                    return new Response(stream, {
                        headers: {
                            'Content-Type': 'text/event-stream',
                            'Cache-Control': 'no-cache',
                            'Connection': 'keep-alive',
                            ...corsHeaders,
                        },
                    });
                } else {
                    try {
                        const aiConfig: any = {
                            messages: allMessages,
                            stream: false
                        };

                        if (shouldOfferTools) {
                            aiConfig.tools = skillSchemas;
                        }

                        const aiResponseData = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', aiConfig);
                        const aiResponse = aiResponseData.response || 'No response';

                        await sessionStub.fetch('http://internal/add-message', {
                            method: 'POST',
                            body: JSON.stringify({ role: 'assistant', content: aiResponse }),
                        });

                        return jsonResponse({ response: aiResponse }, 200, corsHeaders);
                    } catch (error) {
                        const errorMessage = describeAiError(error);
                        const fallbackResponse = `I apologize, but I encountered an error while processing your request. The AI service is currently unavailable: ${errorMessage}`;

                        await sessionStub.fetch('http://internal/add-message', {
                            method: 'POST',
                            body: JSON.stringify({ role: 'assistant', content: fallbackResponse }),
                        });

                        return jsonResponse(
                            {
                                response: fallbackResponse,
                                error: { type: 'ai-unavailable', message: errorMessage }
                            },
                            200,
                            corsHeaders
                        );
                    }
                }
            }

            return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
        } catch (error) {
            return jsonResponse({ error: (error as Error).message }, 500, corsHeaders);
        }
    },
};

function jsonResponse(data: any, status: number, corsHeaders: Record<string, string>): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
        },
    });
}

function getSessionStub(env: Env, request: Request): DurableObjectStub {
    const sessionName = request.headers.get('X-Session-ID') || 'chat-session';
    const sessionId = env.SESSION_STATE.idFromName(sessionName);
    return env.SESSION_STATE.get(sessionId);
}

function shouldRunSmokeSuite(message: string): boolean {
    if (!message) {
        return false;
    }
    const normalized = message.toLowerCase();
    return /\brerun smoke suite\b/.test(normalized) || /\brun smoke suite\b/.test(normalized) || /\brun smoke tests\b/.test(normalized);
}

function formatScenarioSuiteSummary(results: ScenarioRunResult[] | null): string {
    if (!results || results.length === 0) {
        return 'No saved scenarios were available to run.';
    }

    return results
        .map((result) => {
            const base = `Scenario "${result.name}"`;
            if (result.success) {
                const statusPart = typeof result.status === 'number' ? `status ${result.status}` : 'success';
                const durationPart = typeof result.durationMs === 'number' ? `${result.durationMs} ms` : 'unknown duration';
                return `${base} passed (${statusPart}, ${durationPart}).`;
            }
            return `${base} failed: ${result.error || 'Unknown error'}.`;
        })
        .join('\n');
}

function truncateForModel(text: string, maxLength = 4000): string {
    if (!text || text.length <= maxLength) {
        return text;
    }

    return `${text.slice(0, Math.max(maxLength - 1, 0))}…`;
}

function stripMarkdownEmphasis(text: string): string {
    if (!text) {
        return text;
    }

    return text
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/__(.*?)__/g, '$1')
        .replace(/\*(?!\*)([^*]+?)\*(?!\*)/g, '$1')
        .replace(/_(?!_)([^_]+?)_(?!_)/g, '$1');
}

function describeAiError(error: unknown): string {
    if (!error) {
        return 'Unknown error';
    }
    if (typeof error === 'string') {
        return error;
    }
    if (typeof error === 'object' && 'message' in error && typeof (error as any).message === 'string') {
        return (error as any).message;
    }
    try {
        return JSON.stringify(error);
    } catch {
        return 'Unknown error';
    }
}

function resolvePersonaInstruction(persona?: string): string {
    switch (persona) {
        case 'tutor':
            return 'Adopt a helpful tutor persona: explain steps patiently and highlight key takeaways.';
        case 'deployment':
            return 'Act as a deployment assistant: prioritise guidance on publishing connectors and managing environments.';
        case 'troubleshooter':
            return 'Act as a troubleshooter: diagnose issues, propose fixes, and suggest verification steps.';
        case 'technical':
            return 'Adopt a technical persona: provide precise implementation detail, reference relevant APIs, and focus on actionable guidance for developers.';
        default:
            return '';
    }
}

function shouldEnableSkillTools(message: string, skills: Array<{ name?: string; description?: string; apiName?: string }>): boolean {
    if (!message) {
        return false;
    }

    const normalized = message.toLowerCase().trim();
    if (!normalized) {
        return false;
    }

    const greetingPatterns = [
        /^(hi|hello|hey|hola|yo|howdy)\b/,
        /^(good\s+(morning|afternoon|evening|night))\b/,
        /^how are you\b/,
        /^what('?| i)s up\b/,
        /^(hi|hello|hey) there\b/,
    ];

    if (normalized.length <= 60 && greetingPatterns.some((pattern) => pattern.test(normalized))) {
        return false;
    }

    const toolKeywords = [
        'api',
        'weather',
        'forecast',
        'temperature',
        'humidity',
        'pokemon',
        'poke',
        'post',
        'posts',
        'fetch',
        'retrieve',
        'request',
        'http',
        'endpoint',
        'call ',
        'call the',
        'get ',
        'get the',
        'show ',
        'list ',
        'data',
        'skill',
        'openapi',
        'spec',
        'register',
        'delete',
        'update',
        'upload',
    ];

    if (toolKeywords.some((keyword) => normalized.includes(keyword))) {
        return true;
    }

    for (const skill of skills) {
        const candidates = [skill.name, skill.description, skill.apiName]
            .filter(Boolean)
            .map((value) => value!.toLowerCase());

        if (candidates.some((text) => text && normalized.includes(text))) {
            return true;
        }
    }

    return false;
}

function trimChatHistory(history: Array<{ role: string; content: string }>): Array<{ role: string; content: string }> {
    if (!history || history.length === 0) {
        return [];
    }

    const totalChars = history.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
    if (totalChars <= MAX_HISTORY_CHARS) {
        return history;
    }

    const charsToRemove = totalChars - MAX_HISTORY_CHARS;
    let removedChars = 0;
    const trimmed: Array<{ role: string; content: string }> = [];

    for (let i = 0; i < history.length; i++) {
        const msg = history[i];
        if (removedChars >= charsToRemove) {
            trimmed.push(msg);
        } else {
            removedChars += msg.content?.length || 0;
        }
    }

    return trimmed;
}

function estimateMessageTokens(messages: Array<{ role: string; content: string }>): number {
    const totalChars = messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
    return Math.ceil(totalChars / CHARS_PER_TOKEN);
}
