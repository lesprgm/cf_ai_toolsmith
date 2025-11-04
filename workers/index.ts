import type { Env } from './bindings';
import { parseSpecToCSM, detectFormat } from './parser';
import { generateCode } from './generator';
import { verifyCode } from './verifier';
import { installTool, listTools } from './installer';
import { getGlobalLogger, resetGlobalLogger } from './utils/log';
import { TEMPLATE_CONNECTORS } from './templates';
import type { TemplateConnector } from './templates';
import { ToolRegistry as ToolRegistryImpl } from './durable_objects/ToolRegistry';
import { SessionState as SessionStateImpl } from './durable_objects/SessionState';
import { AnalyticsTracker as AnalyticsTrackerImpl, type AnalyticsEvent } from './durable_objects/Analytics';

export class ToolRegistry extends ToolRegistryImpl { }
export class SessionState extends SessionStateImpl { }
export class AnalyticsTracker extends AnalyticsTrackerImpl { }


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

            if (url.pathname === '/api/scenarios' && request.method === 'GET') {
                const sessionStub = getSessionStub(env, request);
                const upstreamResp = await sessionStub.fetch('http://internal/scenarios');
                const data = await upstreamResp.json<any>();
                return jsonResponse(data, upstreamResp.status, corsHeaders);
            }

            if (url.pathname === '/api/scenarios' && request.method === 'POST') {
                const sessionStub = getSessionStub(env, request);
                const payload = await request.json<any>();
                const upstreamResp = await sessionStub.fetch('http://internal/scenarios', {
                    method: 'POST',
                    body: JSON.stringify(payload),
                    headers: { 'Content-Type': 'application/json' },
                });
                const data = await upstreamResp.json<any>();
                return jsonResponse(data, upstreamResp.status, corsHeaders);
            }

            if (url.pathname === '/api/scenarios/run' && request.method === 'POST') {
                const sessionStub = getSessionStub(env, request);
                const payload = await request.json<any>().catch(() => ({}));
                const upstreamResp = await sessionStub.fetch('http://internal/scenarios/run', {
                    method: 'POST',
                    body: JSON.stringify(payload),
                    headers: { 'Content-Type': 'application/json' },
                });
                const data = await upstreamResp.json<any>();
                return jsonResponse(data, upstreamResp.status, corsHeaders);
            }

            if (url.pathname.startsWith('/api/scenarios/') && request.method === 'DELETE') {
                const sessionStub = getSessionStub(env, request);
                const scenarioId = url.pathname.split('/').slice(-1)[0];
                const upstreamResp = await sessionStub.fetch(`http://internal/scenarios/${scenarioId}`, {
                    method: 'DELETE',
                });
                const data = await upstreamResp.json<any>();
                return jsonResponse(data, upstreamResp.status, corsHeaders);
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

                const contentType = request.headers.get('Content-Type') || '';
                let content: string | null = null;
                let filename = 'uploaded-spec';
                let customPrompt: string | undefined;
                let customSystemPrompt: string | undefined;

                if (contentType.includes('application/json')) {
                    const body = await request.json<any>().catch(() => null);

                    if (!body || body.spec == null) {
                        return jsonResponse({ error: 'spec is required' }, 400, corsHeaders);
                    }

                    if (typeof body.spec === 'string') {
                        content = body.spec;
                    } else {
                        try {
                            content = JSON.stringify(body.spec, null, 2);
                        } catch {
                            return jsonResponse({ error: 'Unable to serialise spec to JSON' }, 400, corsHeaders);
                        }
                    }

                    if (typeof body.filename === 'string' && body.filename.trim().length) {
                        filename = body.filename.trim();
                    }

                    if (typeof body.customParsePrompt === 'string' && body.customParsePrompt.trim().length) {
                        customPrompt = body.customParsePrompt;
                    }

                    if (
                        typeof body.customParseSystemPrompt === 'string' &&
                        body.customParseSystemPrompt.trim().length
                    ) {
                        customSystemPrompt = body.customParseSystemPrompt;
                    }
                } else {
                    const formData = await request.formData();
                    const fileEntry = formData.get('file');

                    if (!fileEntry || typeof fileEntry === 'string') {
                        return jsonResponse({ error: 'No file provided' }, 400, corsHeaders);
                    }

                    const file = fileEntry as File;
                    content = await file.text();
                    filename = file.name;

                    const customParsePrompt = formData.get('customParsePrompt');
                    const customParseSystemPrompt = formData.get('customParseSystemPrompt');

                    if (typeof customParsePrompt === 'string' && customParsePrompt.trim().length) {
                        customPrompt = customParsePrompt;
                    }

                    if (
                        typeof customParseSystemPrompt === 'string' &&
                        customParseSystemPrompt.trim().length
                    ) {
                        customSystemPrompt = customParseSystemPrompt;
                    }
                }

                if (!content) {
                    return jsonResponse({ error: 'No specification content provided' }, 400, corsHeaders);
                }

                const formatGuess = detectFormat(content, filename);

                if (contentType.includes('application/json') && formatGuess === 'text') {
                    return jsonResponse(
                        { error: 'Unable to determine specification format. Provide a valid OpenAPI or supported specification.' },
                        400,
                        corsHeaders,
                    );
                }

                const parseResult = await parseSpecToCSM(content, filename, env, {
                    textPrompt: customPrompt,
                    textSystemPrompt: customSystemPrompt,
                });

                await logAnalyticsEvent(env, 'parse', {
                    filename,
                    format: parseResult.format,
                    endpointCount: parseResult.csm.endpoints?.length || 0,
                });

                return jsonResponse(
                    {
                        ...parseResult,
                        endpoints: parseResult.csm?.endpoints ?? [],
                    },
                    200,
                    corsHeaders,
                );
            }

            if (url.pathname === '/api/generate' && request.method === 'POST') {
                resetGlobalLogger();

                const body = await request.json<any>();
                const { endpointId, customPrompt, customSystemPrompt } = body;

                let csm = body.csm;

                if (!csm && Array.isArray(body.endpoints)) {
                    const metadata = body.metadata || {};
                    csm = {
                        name: typeof metadata.name === 'string' && metadata.name.trim().length
                            ? metadata.name.trim()
                            : 'Generated Connector',
                        summary: typeof metadata.description === 'string' ? metadata.description : undefined,
                        endpoints: body.endpoints,
                    };
                    if (metadata.auth) {
                        csm.auth = metadata.auth;
                    }
                }

                if (!csm) {
                    return jsonResponse({ error: 'CSM or endpoints are required' }, 400, corsHeaders);
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

            if (url.pathname === '/api/tools/install' && request.method === 'PUT') {
                resetGlobalLogger();

                const body = await request.json<any>();
                const resolvedName =
                    typeof body.name === 'string' && body.name.trim().length
                        ? body.name.trim()
                        : typeof body.toolName === 'string' && body.toolName.trim().length
                            ? body.toolName.trim()
                            : '';
                const { code, exports, metadata } = body;

                if (!resolvedName || !code || !exports) {
                    return jsonResponse({ error: 'name (or toolName), code, and exports are required' }, 400, corsHeaders);
                }

                const installResult = await installTool(resolvedName, code, exports, env, metadata);

                if (installResult.success) {
                    await logAnalyticsEvent(env, 'install', {
                        toolName: resolvedName,
                        exportsCount: Array.isArray(exports) ? exports.length : 0,
                        metadata,
                    });
                }

                return jsonResponse(installResult, 200, corsHeaders);
            }

            if (url.pathname === '/api/chat' && request.method === 'POST') {
                const body = await request.json<any>();
                const { message, persona, autoExecuteTools = false } = body;

                if (!message) {
                    return jsonResponse({ error: 'Message is required' }, 400, corsHeaders);
                }

                const sessionStub = getSessionStub(env, request);

                // Add user message to history
                await sessionStub.fetch('http://internal/add-message', {
                    method: 'POST',
                    body: JSON.stringify({ role: 'user', content: message }),
                });

                const historyResp = await sessionStub.fetch('http://internal/get-history');
                const history = await historyResp.json<any[]>();
                const trimmedHistory = prepareHistoryForModel(history);

                const toolSummary = await listTools(env);
                const tools = Array.isArray(toolSummary.tools) ? toolSummary.tools : [];

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

                const shouldUseFunctionCalling = autoExecuteTools && tools.length > 0 && !invocationRequest;

                if (invocationRequest) {
                    const execution = await executeToolCall(env, {
                        toolName: invocationRequest.toolName,
                        exportName: invocationRequest.exportName,
                        params: invocationRequest.params ?? {},
                        options: invocationRequest.options ?? {},
                    });
                    toolExecutions.push(execution);
                } else if (!shouldUseFunctionCalling && autoExecuteTools && tools.length > 0) {
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
                        return truncateForModel(formatToolExecutionSummary(exec.tool, exec.export, exec.result));
                    } else {
                        return truncateForModel(formatToolExecutionError(exec.tool, exec.export, exec.error || 'Unknown error'));
                    }
                }).concat(scenarioRunSummary ? [truncateForModel(`Smoke test suite:\n${scenarioRunSummary}`)] : []);

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
                    return truncateForModel(`- ${name}: ${desc}\n  Exports: ${exportsList}`);
                });

                const personaInstruction = resolvePersonaInstruction(persona);

                const systemContent = [
                    'You are a helpful AI assistant for Cloudflare AI ToolSmith.',
                    'Be conversational, friendly, and natural. Respond to greetings warmly.',
                    'Always respond in clear plain text. Do not use Markdown formatting such as **bold**, bullet lists, or code fences unless the user explicitly requests them.',
                    'You can help users with API connector workflows (parse, generate, verify, install) when they ask.',
                    personaInstruction,
                    installedDescriptions.length
                        ? `\nAvailable API Connectors:\n${truncateForModel(installedDescriptions.join('\n'), 3000)}`
                        : '',
                    toolSummary.error ? `\nRegistry error: ${toolSummary.error}` : '',
                    toolExecutionSummaries.length > 0 ? `\nRecent tool execution:\n${truncateForModel(toolExecutionSummaries.join('\n'), 2000)}` : '',
                ]
                    .filter(Boolean)
                    .join('\n');

                const contextMessages = [{ role: 'system', content: systemContent }];

                // Validate total token count before making AI call and trim if needed
                const userMessage = { role: 'user' as const, content: prompt };
                let finalHistory = trimmedHistory;
                let allMessages = [...contextMessages, ...finalHistory, userMessage];
                let estimatedTokens = estimateMessageTokens(allMessages as any);

                // If still over limit, aggressively trim history
                if (estimatedTokens > MAX_MODEL_TOKENS) {
                    const overageTokens = estimatedTokens - MAX_MODEL_TOKENS;
                    const tokensToRemove = overageTokens + 1000; // Extra buffer
                    const charsToRemove = tokensToRemove * CHARS_PER_TOKEN;

                    // Remove oldest messages until we're under the limit
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

                // Format tools for function calling if autoExecuteTools is enabled and no explicit tool was called
                let toolSchemas = null;
                if (shouldUseFunctionCalling) {
                    // Limit to 5 tools max to prevent schema bloat (120k+ chars with 6 tools)
                    const limitedTools = tools.slice(0, 5);
                    toolSchemas = limitedTools.map((tool: any) => {
                        const name = tool.name || tool.toolId || 'unknown';
                        const meta = tool.metadata || {};
                        const description = truncateForModel(meta.description || meta.endpoint || `Execute ${name} API connector`, 150);
                        const exports = Array.isArray(tool.exports) ? tool.exports : [];

                        // Limit exports to first 10 to prevent schema bloat
                        const limitedExports = exports.slice(0, 10);
                        const hasMore = exports.length > 10;

                        const properties: Record<string, any> = {};
                        if (limitedExports.length > 0) {
                            const exportDesc = hasMore
                                ? `First ${limitedExports.length} of ${exports.length} exports: ${limitedExports.join(', ')}`
                                : `Available exports: ${limitedExports.join(', ')}`;
                            properties.exportName = {
                                type: "string",
                                description: truncateForModel(exportDesc, 200),
                                enum: limitedExports
                            };
                        }

                        // Keep params generic - tools can accept varied inputs
                        properties.params = {
                            type: "object",
                            description: "Parameters object to pass to the tool function",
                            additionalProperties: true
                        };

                        return {
                            type: "function",
                            function: {
                                name: name,
                                description: description,
                                parameters: {
                                    type: "object",
                                    properties: properties,
                                    required: exports.length > 0 ? ["exportName"] : []
                                }
                            }
                        };
                    });
                }

                let aiResponse: any;
                try {
                    const aiMessages = [...contextMessages, ...finalHistory, { role: 'user', content: prompt }];
                    const aiConfig: any = { messages: aiMessages };
                    if (toolSchemas) {
                        aiConfig.tools = toolSchemas;
                        aiConfig.tool_choice = "auto";
                    }

                    aiResponse = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', aiConfig);
                } catch (error) {
                    const errorDetails = describeAiError(error);
                    const fallbackResponse = 'The AI service is currently unavailable. Please try again in a moment or verify your Cloudflare AI credentials.';

                    await sessionStub.fetch('http://internal/add-message', {
                        method: 'POST',
                        body: JSON.stringify({ role: 'assistant', content: fallbackResponse }),
                    });

                    return jsonResponse(
                        {
                            response: fallbackResponse,
                            toolExecutions: toolExecutions.length > 0 ? toolExecutions : undefined,
                            scenarioResults: scenarioRunResults ?? undefined,
                            scenarioSummary: scenarioRunSummary ?? undefined,
                            error: {
                                type: 'ai-unavailable',
                                message: errorDetails,
                            },
                        },
                        200,
                        corsHeaders,
                    );
                }

                let response = aiResponse.response || 'No response';

                if (aiResponse.tool_calls && Array.isArray(aiResponse.tool_calls) && aiResponse.tool_calls.length > 0) {
                    for (const toolCall of aiResponse.tool_calls) {
                        // Handle both Cloudflare format {name, arguments} and OpenAI format {function: {name, arguments}}
                        const toolName = toolCall.function?.name || toolCall.name;
                        const rawArgs = toolCall.function?.arguments || toolCall.arguments;

                        if (toolName) {
                            let args: Record<string, any> = {};
                            let parseError: string | null = null;

                            if (typeof rawArgs === 'string') {
                                try {
                                    args = JSON.parse(rawArgs);
                                } catch (err) {
                                    parseError = `Failed to parse tool arguments: ${(err as Error).message}`;
                                    // Try to extract what we can
                                    args = { _raw: rawArgs, _parseError: parseError };
                                }
                            } else if (rawArgs && typeof rawArgs === 'object') {
                                args = rawArgs as Record<string, any>;
                            } else {
                                parseError = 'Tool arguments must be a JSON object or string';
                                args = { _parseError: parseError };
                            }

                            // If parsing failed and we have no valid exportName, record error instead of calling
                            if (parseError && !args.exportName) {
                                toolExecutions.push({
                                    tool: toolName,
                                    success: false,
                                    error: parseError,
                                });
                                continue;
                            }

                            const execution = await executeToolCall(env, {
                                toolName: toolName,
                                exportName: typeof args.exportName === 'string' ? args.exportName : undefined,
                                params: (args.params && typeof args.params === 'object') ? args.params : {},
                                options: {},
                            });
                            toolExecutions.push(execution);
                        }
                    }

                    // Build tool result messages following OpenAI function calling pattern
                    const toolResultMessages = aiResponse.tool_calls.map((toolCall: any, idx: number) => {
                        // Handle both Cloudflare format {name, arguments} and OpenAI format {function: {name, arguments}}
                        const toolName = toolCall?.function?.name || toolCall?.name || 'unknown';

                        // Find the execution result for this tool call by name
                        const exec = toolExecutions.find(e =>
                            e.tool === toolName
                        ) || {
                            tool: toolName,
                            success: false,
                            error: 'Tool execution result not found',
                            export: undefined
                        };

                        let content: string;
                        if (exec.success) {
                            content = formatToolExecutionSummary(exec.tool, exec.export, exec.result);
                        } else {
                            content = formatToolExecutionError(exec.tool, exec.export, exec.error || 'Unknown error');
                        }

                        return {
                            role: 'tool',
                            tool_call_id: toolCall.id || `call_${idx}`,
                            name: toolName,
                            content: content
                        };
                    });

                    // Continue conversation with tool results - single AI call with proper function calling flow
                    try {
                        // Normalize tool_calls to OpenAI format for the follow-up request
                        const normalizedToolCalls = aiResponse.tool_calls.map((tc: any, idx: number) => {
                            const args = tc.function?.arguments || tc.arguments;
                            return {
                                id: tc.id || `call_${idx}`,
                                type: tc.type || 'function',
                                function: {
                                    name: tc.function?.name || tc.name,
                                    // Arguments must be a JSON string, not an object
                                    arguments: typeof args === 'string' ? args : JSON.stringify(args)
                                }
                            };
                        });

                        const finalResponse = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
                            messages: [
                                ...contextMessages,
                                ...finalHistory,
                                { role: 'user', content: prompt },
                                { role: 'assistant', content: response, tool_calls: normalizedToolCalls },
                                ...toolResultMessages
                            ],
                        });

                        response = finalResponse.response || response;
                    } catch (error) {
                        const errorDetails = describeAiError(error);
                        response = `${response}\n\n(Note: Unable to generate a follow-up response with the tool results because the AI service returned an error: ${errorDetails})`;
                    }
                }

                // Add assistant message to history
                await sessionStub.fetch('http://internal/add-message', {
                    method: 'POST',
                    body: JSON.stringify({ role: 'assistant', content: response }),
                });

                return jsonResponse(
                    {
                        response,
                        toolExecutions: toolExecutions.length > 0 ? toolExecutions : undefined,
                        scenarioResults: scenarioRunResults ?? undefined,
                        scenarioSummary: scenarioRunSummary ?? undefined,
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

const MAX_HISTORY_MESSAGES = 16;
const MAX_HISTORY_CHARS = 1800;
const MAX_CONTEXT_SECTION_CHARS = 2000;
const MAX_MODEL_TOKENS = 20000; // Leave buffer below 24k limit
const CHARS_PER_TOKEN = 4; // Rough estimate

function estimateTokens(text: string): number {
    if (!text || typeof text !== 'string') {
        return 0;
    }
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function estimateMessageTokens(messages: Array<{ role: string; content: string }>): number {
    if (!Array.isArray(messages) || messages.length === 0) {
        return 0;
    }

    let total = 0;
    for (const msg of messages) {
        // Rough OpenAI token formula: role + content + formatting overhead
        total += estimateTokens(msg.role) + estimateTokens(msg.content) + 4;
    }
    return total;
}

function prepareHistoryForModel(history: any[]): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    if (!Array.isArray(history) || history.length === 0) {
        return [];
    }

    const recent = history.slice(-MAX_HISTORY_MESSAGES);
    const prepared = recent.map((entry: any) => {
        const role = normalizeRole(entry?.role);
        const content = typeof entry?.content === 'string' ? truncateForModel(entry.content, MAX_HISTORY_CHARS) : '';

        if (!role || !content.trim().length) {
            return null;
        }

        return { role, content };
    });

    return prepared.filter((msg): msg is { role: 'user' | 'assistant' | 'system'; content: string } => msg !== null);
}

function normalizeRole(role: unknown): 'user' | 'assistant' | 'system' | null {
    if (role === 'user' || role === 'assistant' || role === 'system') {
        return role;
    }
    return null;
}

function truncateForModel(text: string, limit: number = MAX_CONTEXT_SECTION_CHARS): string {
    if (typeof text !== 'string' || text.length === 0) {
        return '';
    }

    if (text.length <= limit) {
        return text;
    }

    return `${text.slice(0, Math.max(limit - 1, 0))}…`;
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
