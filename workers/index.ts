import type { Env } from './bindings';
import { parseSpecToCSM } from './parser';
import { generateCode } from './generator';
import { verifyCode } from './verifier';
import { installTool, listTools } from './installer';
import { getGlobalLogger, resetGlobalLogger } from './utils/log';
import { TEMPLATE_CONNECTORS } from './templates';
import type { TemplateConnector } from './templates';
import type { AnalyticsEvent } from './durable_objects/Analytics';

export { ToolRegistry } from './durable_objects/ToolRegistry';
export { SessionState } from './durable_objects/SessionState';
export { AnalyticsTracker } from './durable_objects/Analytics';


async function executeToolCall(
    env: Env,
    request: {
        toolName: string;
        exportName?: string;
        params: Record<string, any>;
        options: Record<string, any>;
    }
): Promise<{
    tool: string;
    export?: string;
    success: boolean;
    result?: any;
    error?: string;
}> {
    try {
        const toolId = env.TOOL_REGISTRY.idFromName('global');
        const toolStub = env.TOOL_REGISTRY.get(toolId);

        const invokeResp = await toolStub.fetch('http://internal/invoke', {
            method: 'POST',
            body: JSON.stringify(request),
        });

        const invokeData = await invokeResp.json<any>();

        if (invokeResp.ok && invokeData?.success) {
            return {
                tool: request.toolName,
                export: request.exportName,
                success: true,
                result: invokeData.result,
            };
        } else {
            return {
                tool: request.toolName,
                export: request.exportName,
                success: false,
                error: invokeData?.error || `Invocation failed with status ${invokeResp.status}`,
            };
        }
    } catch (error) {
        return {
            tool: request.toolName,
            export: request.exportName,
            success: false,
            error: (error as Error).message,
        };
    }
}

/**
 * Use AI to decide if a tool should be called and extract parameters
 */
async function decideToolUsage(
    message: string,
    tools: any[],
    env: Env
): Promise<{
    shouldUseTool: boolean;
    toolName?: string;
    exportName?: string;
    params?: Record<string, any>;
} | null> {
    if (!tools || tools.length === 0) {
        return null;
    }

    const toolDescriptions = tools.map((tool) => {
        const name = tool.name || 'unknown';
        const exports = Array.isArray(tool.exports) ? tool.exports : [];
        const meta = tool.metadata || {};
        const endpoint = meta.endpoint || '';
        const description = meta.description || '';

        return {
            name,
            exports,
            endpoint,
            description,
        };
    });

    const decisionPrompt = `You are a tool selection assistant. Given a user message and available API tools, decide if any tool should be called.

Available tools:
${JSON.stringify(toolDescriptions, null, 2)}

User message: "${message}"

Analyze the message and respond with ONLY a JSON object (no other text):
{
  "shouldUseTool": true/false,
  "toolName": "name of tool to use" (if shouldUseTool is true),
  "exportName": "specific export function" (optional, use first export if not specified),
  "params": {} (extract any parameters from the user message as a JSON object)
}

Examples:
- "Get repository info for microsoft/vscode" -> {"shouldUseTool": true, "toolName": "github-api", "exportName": "getRepository", "params": {"owner": "microsoft", "repo": "vscode"}}
- "What can you help me with?" -> {"shouldUseTool": false}
- "Test the weather API for London" -> {"shouldUseTool": true, "toolName": "weather-api", "params": {"city": "London"}}`;

    try {
        const aiResponse = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
            messages: [
                { role: 'system', content: 'You are a JSON response generator. Respond ONLY with valid JSON, no other text.' },
                { role: 'user', content: decisionPrompt },
            ],
        });

        let responseText = aiResponse.response || '{}';

        // Extract JSON from markdown code blocks if present
        const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (jsonMatch) {
            responseText = jsonMatch[1];
        }

        // Clean up any remaining markdown or extra text
        responseText = responseText.trim();
        const firstBrace = responseText.indexOf('{');
        const lastBrace = responseText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
            responseText = responseText.substring(firstBrace, lastBrace + 1);
        }

        const decision = JSON.parse(responseText);

        if (decision.shouldUseTool && decision.toolName) {
            return {
                shouldUseTool: true,
                toolName: decision.toolName,
                exportName: decision.exportName,
                params: decision.params || {},
            };
        }

        return null;
    } catch (error) {
        // If AI decision fails, fall back to keyword detection
        return null;
    }
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            if (url.pathname === '/api/templates' && request.method === 'GET') {
                const templates = TEMPLATE_CONNECTORS.map((template) => ({
                    id: template.id,
                    name: template.name,
                    description: template.description,
                    category: template.category,
                    endpoint: template.endpoint,
                    metadata: template.metadata,
                    exports: template.exports,
                    code: template.code,
                }));
                return jsonResponse({ templates }, 200, corsHeaders);
            }

            if (url.pathname === '/api/templates/install' && request.method === 'POST') {
                const body = await request.json<any>();
                const { templateId } = body;
                const template = TEMPLATE_CONNECTORS.find((tpl) => tpl.id === templateId);
                if (!template) {
                    return jsonResponse({ error: 'Template not found' }, 404, corsHeaders);
                }

                const installResult = await installTool(template.name, template.code, template.exports, env, {
                    template: true,
                    templateId: template.id,
                    endpoint: template.endpoint,
                    metadata: template.metadata,
                });
                if (installResult.success) {
                    await logAnalyticsEvent(env, 'template-install', {
                        templateId,
                        name: template.name,
                    });
                }

                return jsonResponse({ ...installResult, template }, 200, corsHeaders);
            }

            if (url.pathname === '/api/test-connector' && request.method === 'POST') {
                const body = await request.json<any>();
                const { url: targetUrl, method = 'GET', headers = {}, body: requestBody } = body;

                if (!targetUrl) {
                    return jsonResponse({ error: 'url is required' }, 400, corsHeaders);
                }

                const fetchHeaders: Record<string, string> = {};
                Object.entries(headers || {}).forEach(([key, value]) => {
                    if (typeof value === 'string') {
                        fetchHeaders[key] = value;
                    }
                });

                let payload: BodyInit | undefined;
                if (typeof requestBody === 'string') {
                    payload = requestBody;
                } else if (requestBody) {
                    payload = JSON.stringify(requestBody);
                    if (!fetchHeaders['Content-Type']) {
                        fetchHeaders['Content-Type'] = 'application/json';
                    }
                }

                const start = Date.now();
                const response = await fetch(targetUrl, {
                    method,
                    headers: fetchHeaders,
                    body: payload,
                });
                const durationMs = Date.now() - start;
                const responseHeaders = Object.fromEntries(response.headers.entries());
                const responseBody = await response.text();

                await logAnalyticsEvent(env, 'test', {
                    url: targetUrl,
                    method,
                    status: response.status,
                    durationMs,
                });

                return jsonResponse(
                    {
                        status: response.status,
                        statusText: response.statusText,
                        headers: responseHeaders,
                        body: responseBody,
                        durationMs,
                    },
                    response.ok ? 200 : 502,
                    corsHeaders
                );
            }

            if (url.pathname === '/api/analytics' && request.method === 'GET') {
                const analyticsId = env.ANALYTICS.idFromName('global');
                const stub = env.ANALYTICS.get(analyticsId);
                const eventsResp = await stub.fetch('http://internal/events');
                const analytics = await eventsResp.json();
                return jsonResponse(analytics, 200, corsHeaders);
            }

            if (url.pathname === '/api/parse' && request.method === 'POST') {
                resetGlobalLogger();

                const formData = await request.formData();
                const fileEntry = formData.get('file');

                if (!fileEntry || typeof fileEntry === 'string') {
                    return jsonResponse({ error: 'No file provided' }, 400, corsHeaders);
                }

                const file = fileEntry as File;
                const content = await file.text();
                const filename = file.name;

                const customParsePrompt = formData.get('customParsePrompt');
                const customParseSystemPrompt = formData.get('customParseSystemPrompt');

                const parseResult = await parseSpecToCSM(content, filename, env, {
                    textPrompt:
                        typeof customParsePrompt === 'string' && customParsePrompt.trim().length
                            ? customParsePrompt
                            : undefined,
                    textSystemPrompt:
                        typeof customParseSystemPrompt === 'string' && customParseSystemPrompt.trim().length
                            ? customParseSystemPrompt
                            : undefined,
                });

                await logAnalyticsEvent(env, 'parse', {
                    filename,
                    format: parseResult.format,
                    endpointCount: parseResult.csm.endpoints?.length || 0,
                });

                return jsonResponse(parseResult, 200, corsHeaders);
            }

            if (url.pathname === '/api/generate' && request.method === 'POST') {
                resetGlobalLogger();

                const body = await request.json<any>();
                const { csm, endpointId, customPrompt, customSystemPrompt } = body;

                if (!csm) {
                    return jsonResponse({ error: 'CSM is required' }, 400, corsHeaders);
                }

                const generateResult = await generateCode(csm, env, {
                    userPrompt: customPrompt,
                    systemPrompt: customSystemPrompt,
                });

                const endpointMeta = endpointId
                    ? csm.endpoints?.find?.((ep: any) => ep.id === endpointId) || null
                    : null;

                await logAnalyticsEvent(env, 'generate', {
                    endpointId,
                    promptLength: generateResult.prompt.length,
                    exportCount: generateResult.exports.length,
                });

                return jsonResponse({ ...generateResult, metadata: endpointMeta }, 200, corsHeaders);
            }

            if (url.pathname === '/api/verify' && request.method === 'POST') {
                resetGlobalLogger();

                const body = await request.json<any>();
                const { code } = body;

                if (!code) {
                    return jsonResponse({ error: 'Code is required' }, 400, corsHeaders);
                }

                const verifyResult = await verifyCode(code);

                await logAnalyticsEvent(env, 'verify', {
                    success: verifyResult.success,
                    exportsFound: verifyResult.smokeTestResults?.exportsFound || [],
                });

                return jsonResponse(verifyResult, 200, corsHeaders);
            }

            if (url.pathname === '/api/install' && request.method === 'PUT') {
                resetGlobalLogger();

                const body = await request.json<any>();
                const { toolName, code, exports, metadata } = body;

                if (!toolName || !code || !exports) {
                    return jsonResponse({ error: 'toolName, code, and exports are required' }, 400, corsHeaders);
                }

                const installResult = await installTool(toolName, code, exports, env, metadata);

                if (installResult.success) {
                    await logAnalyticsEvent(env, 'install', {
                        toolName,
                        exportsCount: exports.length,
                        metadata,
                    });
                }

                return jsonResponse(installResult, 200, corsHeaders);
            }

            if (url.pathname === '/api/chat' && request.method === 'POST') {
                const body = await request.json<any>();
                const { message, persona, autoExecuteTools = true } = body;

                if (!message) {
                    return jsonResponse({ error: 'Message is required' }, 400, corsHeaders);
                }

                const sessionName = request.headers.get('X-Session-ID') || 'chat-session';
                const sessionId = env.SESSION_STATE.idFromName(sessionName);
                const sessionStub = env.SESSION_STATE.get(sessionId);

                // Add user message to history
                await sessionStub.fetch('http://internal/add-message', {
                    method: 'POST',
                    body: JSON.stringify({ role: 'user', content: message }),
                });

                const historyResp = await sessionStub.fetch('http://internal/get-history');
                const history = await historyResp.json<any[]>();

                const toolSummary = await listTools(env);
                const tools = Array.isArray(toolSummary.tools) ? toolSummary.tools : [];

                const explicitToolName =
                    typeof body.toolName === 'string' && body.toolName.trim().length
                        ? body.toolName.trim()
                        : null;

                let invocationRequest =
                    explicitToolName !== null
                        ? {
                            toolName: explicitToolName,
                            exportName:
                                typeof body.exportName === 'string' && body.exportName.trim().length
                                    ? body.exportName.trim()
                                    : undefined,
                            params: body.params ?? {},
                            options: body.options ?? {},
                        }
                        : detectToolInvocation(message, tools);

                const toolExecutions: Array<{
                    tool: string;
                    export?: string;
                    success: boolean;
                    result?: any;
                    error?: string;
                }> = [];

                if (invocationRequest) {
                    const execution = await executeToolCall(env, {
                        toolName: invocationRequest.toolName,
                        exportName: invocationRequest.exportName,
                        params: invocationRequest.params ?? {},
                        options: invocationRequest.options ?? {},
                    });
                    toolExecutions.push(execution);
                } else if (autoExecuteTools && tools.length > 0) {
                    // Use AI to decide which tool to call
                    const toolDecision = await decideToolUsage(message, tools, env);

                    if (toolDecision && toolDecision.shouldUseTool && toolDecision.toolName) {
                        const execution = await executeToolCall(env, {
                            toolName: toolDecision.toolName,
                            exportName: toolDecision.exportName,
                            params: toolDecision.params || {},
                            options: {},
                        });
                        toolExecutions.push(execution);
                    }
                }

                // Build context for the AI response
                const toolExecutionSummaries = toolExecutions.map((exec) => {
                    if (exec.success) {
                        return formatToolExecutionSummary(exec.tool, exec.export, exec.result);
                    } else {
                        return formatToolExecutionError(exec.tool, exec.export, exec.error || 'Unknown error');
                    }
                });

                let prompt = message;
                if (toolExecutionSummaries.length > 0) {
                    prompt += `\n\nTool execution results:\n${toolExecutionSummaries.join('\n\n')}`;
                }

                const installedDescriptions = tools.map((tool: any) => {
                    const name = tool.name || tool.toolId || 'unknown';
                    const exportsList = Array.isArray(tool.exports) && tool.exports.length
                        ? tool.exports.join(', ')
                        : 'no exports reported';
                    const meta = tool.metadata || {};
                    const desc = meta.description || meta.endpoint || 'no description';
                    return `- ${name}: ${desc}\n  Exports: ${exportsList}`;
                });

                const personaInstruction = resolvePersonaInstruction(persona);

                const systemContent = [
                    'You are the assistant for Cloudflare AI ToolSmith.',
                    'Always respond in clear plain text. Do not use Markdown formatting such as **bold**, bullet lists, or code fences unless the user explicitly requests them.',
                    'Help users navigate the parse → generate → verify → install workflow and use their installed API connectors.',
                    personaInstruction,
                    installedDescriptions.length
                        ? `\nInstalled API Connectors:\n${installedDescriptions.join('\n')}`
                        : 'No connectors are installed yet. Guide the user through uploading an API spec, generating a connector, and installing it.',
                    toolSummary.error ? `\nRegistry error: ${toolSummary.error}` : '',
                    toolExecutionSummaries.length > 0 ? `\nRecent tool execution:\n${toolExecutionSummaries.join('\n')}` : '',
                ]
                    .filter(Boolean)
                    .join('\n');

                const contextMessages = [{ role: 'system', content: systemContent }];

                const aiResponse = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
                    messages: [...contextMessages, ...history, { role: 'user', content: prompt }],
                });

                let response = aiResponse.response || 'No response';
                response = stripMarkdownEmphasis(response);

                // Add assistant message to history
                await sessionStub.fetch('http://internal/add-message', {
                    method: 'POST',
                    body: JSON.stringify({ role: 'assistant', content: response }),
                });

                return jsonResponse(
                    {
                        response,
                        toolExecutions: toolExecutions.length > 0 ? toolExecutions : undefined
                    },
                    200,
                    corsHeaders
                );
            }

            // Route: GET /api/stream (SSE)
            if (url.pathname === '/api/stream' && request.method === 'GET') {
                const encoder = new TextEncoder();
                const sessionParam = url.searchParams.get('sessionId') || 'global';

                const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

                const stream = new ReadableStream({
                    start(controller) {
                        let cancelled = false;
                        const signal = request.signal;
                        const close = () => {
                            if (!cancelled) {
                                cancelled = true;
                                controller.close();
                            }
                        };

                        if (signal) {
                            if (signal.aborted) {
                                close();
                                return;
                            }
                            signal.addEventListener('abort', close);
                        }

                        let lastIndex = 0;
                        let loggerRef = getGlobalLogger();

                        const sendLoop = async () => {
                            while (!cancelled) {
                                const activeLogger = getGlobalLogger();
                                if (activeLogger !== loggerRef) {
                                    loggerRef = activeLogger;
                                    lastIndex = 0;
                                }

                                const logs = loggerRef.dump();
                                while (lastIndex < logs.length) {
                                    const log = logs[lastIndex++];
                                    const payload = {
                                        ...log,
                                        timestamp: new Date(log.timestamp).toISOString(),
                                        sessionId: sessionParam,
                                    };
                                    controller.enqueue(encoder.encode(`event: log\ndata: ${JSON.stringify(payload)}\n\n`));
                                }

                                controller.enqueue(encoder.encode(`event: ping\ndata: "${Date.now()}"\n\n`));

                                await sleep(1000);
                            }
                        };

                        sendLoop().catch(() => close());
                    },
                    cancel() {
                        // stream cancelled by client
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
            }

            if (url.pathname === '/api/tools' && request.method === 'GET') {
                const { tools, error } = await listTools(env);

                if (error) {
                    return jsonResponse({ error }, 500, corsHeaders);
                }

                return jsonResponse({ tools }, 200, corsHeaders);
            }

            if (url.pathname === '/' && request.method === 'GET') {
                return jsonResponse({ status: 'ok', service: 'cf_ai_specforge' }, 200, corsHeaders);
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

async function logAnalyticsEvent(
    env: Env,
    type: AnalyticsEvent['type'],
    details?: Record<string, any>
): Promise<void> {
    try {
        const analyticsId = env.ANALYTICS.idFromName('global');
        const stub = env.ANALYTICS.get(analyticsId);
        const event: AnalyticsEvent = {
            id: typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}`,
            type,
            details,
            timestamp: new Date().toISOString(),
        };
        await stub.fetch('http://internal/log', {
            method: 'POST',
            body: JSON.stringify(event),
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Failed to log analytics event', (error as Error).message);
    }
}

function detectToolInvocation(message: string, tools: any[]): {
    toolName: string;
    exportName?: string;
    params?: Record<string, any>;
    options?: Record<string, any>;
} | null {
    if (!tools?.length) {
        return null;
    }

    for (const tool of tools) {
        const name = typeof tool?.name === 'string' ? tool.name.trim() : '';
        if (!name) continue;

        const pattern = new RegExp(`\\b(?:run|test|call|invoke)\\s+${escapeRegExp(name)}\\b`, 'i');
        const match = pattern.exec(message);
        if (!match || match.index === undefined) continue;

        const remainder = message.slice(match.index + match[0].length);

        let exportName: string | undefined;
        const usingMatch = /\busing\s+([A-Za-z0-9_]+)/i.exec(remainder);
        if (usingMatch) {
            exportName = usingMatch[1].trim();
        }

        let params: Record<string, any> | undefined;
        const withMatch = /\bwith\s+([\s\S]+)/i.exec(remainder);
        if (withMatch) {
            const rawParams = withMatch[1].trim();
            try {
                params = JSON.parse(rawParams);
            } catch {
                params = { input: rawParams };
            }
        }

        return {
            toolName: name,
            exportName,
            params,
            options: undefined,
        };
    }

    return null;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatToolExecutionSummary(
    toolName: string,
    exportName: string | undefined,
    result: any,
): string {
    const label = exportName ? `${toolName}.${exportName}` : toolName;
    const formatted = formatResultForPrompt(result);
    return `${label} succeeded with result:\n${formatted}`;
}

function formatToolExecutionError(
    toolName: string,
    exportName: string | undefined,
    error: string,
): string {
    const label = exportName ? `${toolName}.${exportName}` : toolName;
    return `${label} failed: ${error}`;
}

function formatResultForPrompt(result: any, limit = 1200): string {
    let text: string;
    if (typeof result === 'string') {
        text = result;
    } else {
        try {
            text = JSON.stringify(result, null, 2);
        } catch {
            text = String(result);
        }
    }

    if (text.length > limit) {
        return `${text.slice(0, limit)}…`;
    }
    return text;
}

function stripMarkdownEmphasis(text: string): string {
    return text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1');
}

function resolvePersonaInstruction(persona?: string): string {
    switch (persona) {
        case 'tutor':
            return 'Adopt a helpful tutor persona: explain steps patiently and highlight key takeaways.';
        case 'deployment':
            return 'Act as a deployment assistant: prioritise guidance on publishing connectors and managing environments.';
        case 'troubleshooter':
            return 'Act as a troubleshooter: diagnose issues, propose fixes, and suggest verification steps.';
        default:
            return '';
    }
}
