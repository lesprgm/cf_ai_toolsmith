import type { Env } from './bindings';
import { getGlobalLogger } from './utils/log';
import { SessionState as SessionStateImpl } from './durable_objects/SessionState';
import { SkillRegistry as SkillRegistryImpl } from './durable_objects/SkillRegistry';
import { parseOpenAPIToSkills, skillsToAIToolSchemas, executeSkill } from './skill-parser';
import { parseYaml } from './utils/yaml';

const TEMPLATE_LIBRARY = [
    {
        id: 'weather-alerts',
        name: 'Weather Alerts Connector',
        category: 'Monitoring',
        description: 'Monitor the National Weather Service API for severe weather alerts and broadcast them to your workspace.',
        endpoint: {
            method: 'GET',
            path: '/alerts/active',
            description: 'Retrieve all currently active weather alerts for a given area.',
            sampleRequest: {
                baseUrl: 'https://api.weather.gov',
                method: 'GET',
                path: '/alerts/active',
                query: { status: 'actual', message_type: 'alert' }
            }
        },
        exports: ['getActiveAlerts'],
        metadata: {
            provider: 'National Weather Service',
            baseUrl: 'https://api.weather.gov',
            lastUpdated: '2024-01-05T00:00:00Z'
        },
        code: `export async function getActiveAlerts(region = 'MD') {
  const response = await fetch('https://api.weather.gov/alerts/active?area=' + region, {
    headers: { 'User-Agent': 'CF-Toolsmith Demo' }
  });
  if (!response.ok) {
    throw new Error('Unable to fetch alerts');
  }
  return response.json();
}`
    },
    {
        id: 'github-releases',
        name: 'GitHub Release Monitor',
        category: 'Developer Tools',
        description: 'Track the latest GitHub releases for any repository and notify collaborators when new versions are available.',
        endpoint: {
            method: 'GET',
            path: '/repos/{owner}/{repo}/releases/latest',
            description: 'Fetch the most recent release for a repository.',
            sampleRequest: {
                baseUrl: 'https://api.github.com',
                method: 'GET',
                path: '/repos/cloudflare/workers-sdk/releases/latest',
                headers: { Accept: 'application/vnd.github+json' }
            }
        },
        exports: ['getLatestRelease'],
        metadata: {
            provider: 'GitHub',
            baseUrl: 'https://api.github.com',
            lastUpdated: '2024-01-11T00:00:00Z'
        },
        code: `export async function getLatestRelease(owner: string, repo: string) {
  const response = await fetch(\`https://api.github.com/repos/\${owner}/\${repo}/releases/latest\`, {
    headers: { 'Accept': 'application/vnd.github+json' }
  });
  if (!response.ok) {
    throw new Error(\`GitHub API error: \${response.status}\`);
  }
  return response.json();
}`
    },
    {
        id: 'support-digests',
        name: 'Support Inbox Digest',
        category: 'Customer Support',
        description: 'Summarise the latest Zendesk tickets and post concise updates to Slack on a schedule.',
        endpoint: {
            method: 'GET',
            path: '/api/v2/tickets.json',
            description: 'List tickets with pagination and filtering.',
            sampleRequest: {
                baseUrl: 'https://your-team.zendesk.com',
                method: 'GET',
                path: '/api/v2/tickets.json',
                query: { status: 'new,pending' }
            }
        },
        exports: ['listTickets'],
        metadata: {
            provider: 'Zendesk',
            baseUrl: 'https://example.zendesk.com',
            lastUpdated: '2024-01-02T00:00:00Z'
        },
        code: `export async function listTickets(subdomain: string, status = 'new,pending') {
  const response = await fetch(\`https://\${subdomain}.zendesk.com/api/v2/tickets.json?status=\${status}\`, {
    headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
  });
  if (!response.ok) {
    throw new Error('Zendesk API error');
  }
  return response.json();
}`
    }
];

const POPULAR_SIMPLE_APIS = [
    { id: 'stripe', name: 'Stripe', category: 'Payments', description: 'Process payments and manage subscriptions.', hasSpec: true, specSource: 'registry' },
    { id: 'github', name: 'GitHub', category: 'Developer Tools', description: 'Interact with GitHub repositories and workflows.', hasSpec: true, specSource: 'registry' },
    { id: 'twilio', name: 'Twilio', category: 'Communications', description: 'Send SMS, WhatsApp, and voice calls.', hasSpec: true, specSource: 'registry' },
    { id: 'slack', name: 'Slack', category: 'Collaboration', description: 'Build bots and workflows for Slack workspaces.', hasSpec: true, specSource: 'registry' },
    { id: 'openai', name: 'OpenAI', category: 'AI', description: 'Access GPT models and vision APIs.', hasSpec: true, specSource: 'ai-registry' }
];

class HttpError extends Error {
    status: number;
    details?: Record<string, any>;

    constructor(status: number, message: string, details?: Record<string, any>) {
        super(message);
        this.status = status;
        this.details = details;
    }
}

export class SessionState extends SessionStateImpl { }
export class SkillRegistry extends SkillRegistryImpl { }

const MAX_HISTORY_CHARS = 50_000;
const MAX_MODEL_TOKENS = 24_000;
const CHARS_PER_TOKEN = 4;
const STREAM_FLUSH_INTERVAL_MS = 250;
const STREAM_CHUNK_SIZE = 220;
const LOG_STREAM_PING_INTERVAL = 5000;

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
            if (url.pathname === '/api/templates' && request.method === 'GET') {
                return jsonResponse({ templates: TEMPLATE_LIBRARY }, 200, corsHeaders);
            }

            if (url.pathname === '/api/templates/install' && request.method === 'POST') {
                const { templateId } = await readJsonBody(request);
                if (!templateId || typeof templateId !== 'string') {
                    throw new HttpError(400, 'templateId is required');
                }

                const template = TEMPLATE_LIBRARY.find((entry) => entry.id === templateId);
                if (!template) {
                    throw new HttpError(404, 'Template not found');
                }

                getGlobalLogger().info(`Template installed`, { templateId, templateName: template.name });

                return jsonResponse(
                    {
                        success: true,
                        template,
                        installedAt: new Date().toISOString()
                    },
                    200,
                    corsHeaders
                );
            }

            if (url.pathname === '/api/simple-create/popular' && request.method === 'GET') {
                return jsonResponse({ success: true, apis: POPULAR_SIMPLE_APIS }, 200, corsHeaders);
            }

            if (url.pathname === '/api/simple-create' && request.method === 'POST') {
                const body = await readJsonBody(request);
                const apiName = typeof body.apiName === 'string' ? body.apiName.trim() : '';
                const intent = typeof body.intent === 'string' ? body.intent.trim() : '';

                if (!apiName || !intent) {
                    throw new HttpError(400, 'apiName and intent are required');
                }

                const spec = buildSimpleSpec(apiName, intent);
                const analysis = analyzeApiIntent(apiName, intent, spec);

                return jsonResponse({ success: true, spec, analysis }, 200, corsHeaders);
            }

            if (url.pathname === '/api/workflow/analyze' && request.method === 'POST') {
                const body = await readJsonBody(request);
                const description = typeof body.description === 'string' ? body.description.trim() : '';
                if (!description) {
                    throw new HttpError(400, 'description is required');
                }

                const analysis = analyzeWorkflowDescription(description);
                return jsonResponse({ success: true, analysis }, 200, corsHeaders);
            }

            if (url.pathname === '/api/workflow/generate' && request.method === 'POST') {
                const body = await readJsonBody(request);
                const description = typeof body.description === 'string' ? body.description.trim() : '';
                const analysis = body.analysis;

                if (!description) {
                    throw new HttpError(400, 'description is required');
                }
                if (!analysis || typeof analysis !== 'object' || !Array.isArray(analysis.steps)) {
                    throw new HttpError(400, 'analysis with steps is required');
                }

                const code = buildWorkflowCode(description, analysis.steps);
                const steps = analysis.steps.map((step: any) => step.title || step);

                return jsonResponse({ success: true, code, steps }, 200, corsHeaders);
            }

            if (url.pathname === '/api/tools' && request.method === 'GET') {
                const { userId } = resolveRequestContext(request);
                const skillRegistryId = env.SKILL_REGISTRY.idFromName('global');
                const skillRegistryStub = env.SKILL_REGISTRY.get(skillRegistryId);

                const registryResponse = await skillRegistryStub.fetch('http://internal/list', {
                    method: 'GET',
                    headers: { 'X-User-ID': userId }
                });
                const apiResult = await registryResponse.json<any>();

                const tools = Array.isArray(apiResult.apis)
                    ? apiResult.apis.map((api) => ({
                        name: api.apiName,
                        exports: api.skillNames || [],
                        metadata: {
                            description: api.metadata?.description || `${api.skillCount} operations available`,
                            endpoint: api.baseUrl
                        },
                        installedAt: api.registeredAt || new Date().toISOString()
                    }))
                    : [];

                return jsonResponse({ tools }, 200, corsHeaders);
            }

            if (url.pathname === '/api/stream' && request.method === 'GET') {
                const sessionId = url.searchParams.get('sessionId') || resolveRequestContext(request).sessionId;
                const stream = createLogStream(sessionId);
                return new Response(stream, {
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                        ...corsHeaders,
                    },
                });
            }

            if (url.pathname === '/api/scenarios' && request.method === 'GET') {
                const scenarioData = await proxyScenarioRequest(env, request, 'http://internal/scenarios/list', { method: 'GET' });
                const scenarios = Array.isArray(scenarioData) ? scenarioData : scenarioData.scenarios || [];
                return jsonResponse({ scenarios }, 200, corsHeaders);
            }

            if (url.pathname === '/api/scenarios' && request.method === 'POST') {
                const payload = await request.text();
                const scenarioData = await proxyScenarioRequest(env, request, 'http://internal/scenarios', {
                    method: 'POST',
                    body: payload
                });
                return jsonResponse(scenarioData, 200, corsHeaders);
            }

            if (url.pathname === '/api/scenarios/run' && request.method === 'POST') {
                const payload = await request.text();
                const runData = await proxyScenarioRequest(env, request, 'http://internal/scenarios/run', {
                    method: 'POST',
                    body: payload
                });
                return jsonResponse(runData, 200, corsHeaders);
            }

            if (url.pathname.startsWith('/api/scenarios/') && request.method === 'DELETE') {
                const scenarioId = url.pathname.split('/').pop();
                if (!scenarioId) {
                    throw new HttpError(400, 'Scenario ID is required');
                }
                const result = await proxyScenarioRequest(env, request, `http://internal/scenarios/${scenarioId}`, {
                    method: 'DELETE'
                });
                return jsonResponse(result, 200, corsHeaders);
            }

            if (url.pathname === '/api/test-connector' && request.method === 'POST') {
                const body = await readJsonBody(request);
                const result = await executeTestConnector(body);
                return jsonResponse(result, result.success ? 200 : 502, corsHeaders);
            }
            if (url.pathname === '/api/skills/register' && request.method === 'POST') {
                const body = await readJsonBody(request);
                let { apiName, spec, apiKey } = body;

                if (!apiName || !spec) {
                    return jsonResponse({ error: 'apiName and spec are required' }, 400, corsHeaders);
                }

                if (typeof spec === 'string') {
                    try {
                        spec = JSON.parse(spec);
                    } catch {
                        spec = parseYaml(spec);
                        if (!spec) {
                            return jsonResponse({ error: 'Invalid JSON or YAML in spec' }, 400, corsHeaders);
                        }
                    }
                }

                if (!spec.openapi && !spec.swagger) {
                    return jsonResponse({ error: 'Not a valid OpenAPI/Swagger specification' }, 400, corsHeaders);
                }

                const specSize = JSON.stringify(spec).length;
                if (specSize > 5 * 1024 * 1024) {
                    return jsonResponse({
                        error: `Spec is too large (${(specSize / 1024 / 1024).toFixed(2)}MB). Maximum is 5MB.`
                    }, 400, corsHeaders);
                }

                try {
                    const { skills, baseUrl, metadata } = parseOpenAPIToSkills(spec);

                    if (skills.length === 0) {
                        return jsonResponse({ error: 'No valid operations found in OpenAPI spec' }, 400, corsHeaders);
                    }

                    const encryptedApiKey = apiKey ? await encryptSecret(apiKey, env) : '';

                    const { userId } = resolveRequestContext(request);
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
                const { userId } = resolveRequestContext(request);
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

                const { userId } = resolveRequestContext(request);
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
                const { userId } = resolveRequestContext(request);
                const sessionStub = getSessionStub(env, request);

                await sessionStub.fetch('http://internal/add-message', {
                    method: 'POST',
                    body: JSON.stringify({ role: 'user', content: message }),
                });

                const historyResp = await sessionStub.fetch('http://internal/get-history');
                let history = (await historyResp.json<any>()) as any[];

                const preCheckTokens = estimateMessageTokens(history);
                if (preCheckTokens > 50_000) {
                    console.log(`[EMERGENCY] History has ${preCheckTokens} tokens, clearing all except system messages!`);
                    history = history.filter(msg => msg.role === 'system');
                    await sessionStub.fetch('http://internal/clear-history', { method: 'POST' });
                }

                const trimmedHistory = trimChatHistory(history);

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
                            encryptedApiKey: apiData.encryptedApiKey,
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
                    '**CRITICAL: When you need to call a skill, use the proper tool_call format. NEVER respond with instructions like "Your function call should be..." - always make the actual tool call.**',
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
                                            const decryptedKey = skill.encryptedApiKey
                                                ? await decryptSecret(skill.encryptedApiKey, env)
                                                : '';
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

                                streamTextResponse(controller, encoder, fullResponse);

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

                                streamTextResponse(controller, encoder, errorResponse);

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
            if (error instanceof HttpError) {
                const payload: Record<string, any> = { error: error.message };
                if (error.details) {
                    payload.details = error.details;
                }
                return jsonResponse(payload, error.status, corsHeaders);
            }
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
    const { sessionId } = resolveRequestContext(request);
    const durableId = env.SESSION_STATE.idFromName(sessionId);
    return env.SESSION_STATE.get(durableId);
}

function resolveRequestContext(request: Request): { userId: string; sessionId: string } {
    const sessionHeader = request.headers.get('X-Session-ID')?.trim();
    const userHeader = request.headers.get('X-User-ID')?.trim();

    if (sessionHeader && userHeader && sessionHeader !== userHeader) {
        throw new HttpError(400, 'X-User-ID must match X-Session-ID');
    }

    const identifier = sessionHeader || userHeader || deriveAnonymousSessionId(request);
    return { userId: identifier, sessionId: identifier };
}

function deriveAnonymousSessionId(request: Request): string {
    const fingerprint = [
        request.headers.get('CF-Connecting-IP') || '0.0.0.0',
        request.headers.get('User-Agent') || 'unknown',
        request.headers.get('Accept-Language') || ''
    ].join('|');
    return `session-${simpleHash(fingerprint)}`;
}

function simpleHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = (hash << 5) - hash + input.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(16);
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

    const estimatedTokens = estimateMessageTokens(history);
    const TOKEN_WARNING_THRESHOLD = 8_000;  // Start trimming early (was 16k)
    const TOKEN_EMERGENCY_THRESHOLD = 12_000; // Emergency trim (was 20k)
    const MAX_MESSAGES_NORMAL = 8;          // Much lower (was 15)
    const KEEP_MESSAGES_NORMAL = 5;         // Keep fewer (was 10)
    const KEEP_MESSAGES_HIGH_TOKENS = 3;    // Keep very few (was 5)
    const KEEP_MESSAGES_EMERGENCY = 2;      // Absolute minimum (was 3)

    const systemMessages = history.filter(msg => msg.role === 'system');
    const conversationMessages = history.filter(msg => msg.role !== 'system');

    let trimmedConversation = conversationMessages;

    if (estimatedTokens > TOKEN_EMERGENCY_THRESHOLD) {
        console.log(`[History] EMERGENCY TRIM: ${estimatedTokens} tokens > ${TOKEN_EMERGENCY_THRESHOLD}, keeping only last ${KEEP_MESSAGES_EMERGENCY} messages`);
        trimmedConversation = conversationMessages.slice(-KEEP_MESSAGES_EMERGENCY);
    }
    else if (conversationMessages.length > MAX_MESSAGES_NORMAL) {
        const keepCount = estimatedTokens > TOKEN_WARNING_THRESHOLD
            ? KEEP_MESSAGES_HIGH_TOKENS
            : KEEP_MESSAGES_NORMAL;

        trimmedConversation = conversationMessages.slice(-keepCount);

        console.log(`[History] Trimming conversation: ${conversationMessages.length} messages -> ${trimmedConversation.length} messages (tokens: ${estimatedTokens})`);
    }
    else if (estimatedTokens > TOKEN_WARNING_THRESHOLD) {
        const keepCount = KEEP_MESSAGES_HIGH_TOKENS;
        trimmedConversation = conversationMessages.slice(-keepCount);

        console.log(`[History] Token threshold exceeded: trimming ${conversationMessages.length} messages -> ${trimmedConversation.length} messages (tokens: ${estimatedTokens})`);
    }

    return [...systemMessages, ...trimmedConversation];
}

function estimateMessageTokens(messages: Array<{ role: string; content: string }>): number {
    const totalChars = messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
    // Use more conservative estimate: 3 chars per token instead of 4
    // This accounts for the fact that JSON, technical terms, etc. use more tokens
    return Math.ceil(totalChars / 3);
}

async function readJsonBody(request: Request): Promise<any> {
    const raw = await request.text();
    if (!raw) {
        return {};
    }
    try {
        return JSON.parse(raw);
    } catch {
        throw new HttpError(400, 'Invalid JSON body');
    }
}

function buildSimpleSpec(apiName: string, intent: string) {
    const slug = slugify(apiName);
    const summary = intent.length > 120 ? `${intent.slice(0, 117)}...` : intent;
    const path = `/${slug}/action`;

    return {
        openapi: '3.0.0',
        info: {
            title: `${apiName} Connector`,
            version: '1.0.0',
            description: `Auto-generated connector for "${intent}".`
        },
        servers: [{ url: `https://api.${slug}.example.com` }],
        paths: {
            [path]: {
                post: {
                    summary,
                    description: `Performs the requested action against ${apiName}.`,
                    operationId: `execute${slug.charAt(0).toUpperCase()}${slug.slice(1)}`,
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    additionalProperties: true
                                }
                            }
                        }
                    },
                    responses: {
                        '200': { description: 'Successful response' },
                        '400': { description: 'Bad request' }
                    }
                }
            }
        }
    };
}

function analyzeApiIntent(apiName: string, intent: string, spec: any) {
    const lowerIntent = intent.toLowerCase();
    const category = lowerIntent.includes('payment')
        ? 'Payments'
        : lowerIntent.includes('weather')
            ? 'Weather'
            : lowerIntent.includes('support')
                ? 'Support'
                : 'General';

    const warnings: string[] = [];
    if (lowerIntent.includes('browser')) {
        warnings.push('Browser APIs may require client-side code.');
    }
    if (spec?.paths && Object.keys(spec.paths).length <= 1) {
        warnings.push('Only a single endpoint was inferred. Upload a real spec for full coverage.');
    }

    return {
        provider: apiName,
        category,
        endpointCount: Object.keys(spec.paths || {}).length,
        specSource: 'ai-generated',
        requiresClientSide: lowerIntent.includes('browser'),
        multiStepRequired: lowerIntent.includes('workflow') || lowerIntent.includes('step'),
        warnings
    };
}

function analyzeWorkflowDescription(description: string) {
    const sentences = description.split(/[\.\n]+/).map((s) => s.trim()).filter(Boolean);
    const steps = sentences.map((sentence, index) => ({
        id: `step-${index + 1}`,
        title: sentence.length > 48 ? `${sentence.slice(0, 45)}…` : sentence,
        description: sentence
    }));

    return {
        workflowName: sentences[0]?.slice(0, 60) || 'Generated Workflow',
        steps,
        complexity: steps.length > 4 ? 'medium' : 'low',
        estimatedDurationMinutes: Math.max(1, steps.length)
    };
}

function buildWorkflowCode(description: string, steps: any[]) {
    const stepComments = steps
        .map((step: any, index: number) => `  // Step ${index + 1}: ${step.title || step}`)
        .join('\n');

    return `export async function runWorkflow(input) {
  console.log('Starting workflow: ${description.replace(/\n/g, ' ')}');
${stepComments || '  // Define workflow steps here'}
  return { success: true, completedSteps: ${steps.length} };
}`;
}

function createLogStream(sessionId: string): ReadableStream {
    const logger = getGlobalLogger();
    const encoder = new TextEncoder();

    return new ReadableStream({
        start(controller) {
            const sendEvent = (event: string, data: any) => {
                controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            };

            sendEvent('ready', { sessionId });

            let lastCount = 0;
            const flushLogs = () => {
                const logs = logger.dump();
                if (logs.length > lastCount) {
                    logs.slice(lastCount).forEach((log) => sendEvent('log', log));
                    lastCount = logs.length;
                }
                sendEvent('ping', { timestamp: new Date().toISOString() });
            };

            flushLogs();
            const interval = setInterval(flushLogs, LOG_STREAM_PING_INTERVAL);

            (controller as any)._interval = interval;
        },
        cancel() {
            const interval = (this as any)._interval;
            if (interval) {
                clearInterval(interval);
            }
        }
    });
}

async function proxyScenarioRequest(env: Env, request: Request, target: string, init: RequestInit) {
    const sessionStub = getSessionStub(env, request);
    const response = await sessionStub.fetch(target, {
        headers: { 'Content-Type': 'application/json' },
        ...init
    });

    const text = await response.text();
    let parsed: any = text;
    try {
        parsed = text ? JSON.parse(text) : {};
    } catch {
        // leave as text
    }

    if (!response.ok) {
        throw new HttpError(response.status, 'Scenario request failed', { body: parsed });
    }

    return parsed;
}

async function executeTestConnector(body: any) {
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!url || !/^https?:\/\//i.test(url)) {
        throw new HttpError(400, 'A valid https:// URL is required');
    }

    const method = typeof body?.method === 'string' ? body.method.toUpperCase() : 'GET';
    const headers = (body?.headers && typeof body.headers === 'object') ? body.headers : {};
    let payload: BodyInit | undefined;

    if (body?.body !== undefined && body?.body !== null && method !== 'GET' && method !== 'HEAD') {
        payload = typeof body.body === 'string' ? body.body : JSON.stringify(body.body);
        if (typeof headers['Content-Type'] !== 'string') {
            headers['Content-Type'] = 'application/json';
        }
    }

    const start = Date.now();
    const upstream = await fetch(url, { method, headers, body: payload });
    const durationMs = Date.now() - start;
    const responseHeaders = Object.fromEntries(upstream.headers.entries());
    const bodyText = await upstream.text();

    return {
        success: upstream.ok,
        status: upstream.status,
        statusText: upstream.statusText,
        durationMs,
        headers: responseHeaders,
        bodyPreview: truncateForModel(bodyText, 2000)
    };
}

function streamTextResponse(controller: ReadableStreamDefaultController, encoder: TextEncoder, content: string) {
    for (let offset = 0; offset < content.length; offset += STREAM_CHUNK_SIZE) {
        const chunk = content.slice(offset, offset + STREAM_CHUNK_SIZE);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', data: chunk })}\n\n`));
    }
}

const encryptionKeyCache = new WeakMap<Env, Promise<CryptoKey>>();

async function encryptSecret(plaintext: string, env: Env): Promise<string> {
    if (!plaintext) {
        return '';
    }
    const key = await importEncryptionKey(env);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded));
    const payload = concatBytes(iv, ciphertext);
    return encodeBase64(payload);
}

async function decryptSecret(ciphertext: string, env: Env): Promise<string> {
    if (!ciphertext) {
        return '';
    }
    const key = await importEncryptionKey(env);
    const payload = decodeBase64(ciphertext);
    const iv = payload.slice(0, 12);
    const data = payload.slice(12);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(plaintext);
}

async function importEncryptionKey(env: Env): Promise<CryptoKey> {
    if (!env.API_KEY_SECRET || env.API_KEY_SECRET.length < 16) {
        throw new HttpError(500, 'API_KEY_SECRET must be configured and at least 16 characters long');
    }

    if (!encryptionKeyCache.has(env)) {
        const encoder = new TextEncoder();
        const secretBytes = encoder.encode(env.API_KEY_SECRET.padEnd(32, '#')).slice(0, 32);
        const keyPromise = crypto.subtle.importKey('raw', secretBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
        encryptionKeyCache.set(env, keyPromise);
    }

    return encryptionKeyCache.get(env)!;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
    const combined = new Uint8Array(a.length + b.length);
    combined.set(a, 0);
    combined.set(b, a.length);
    return combined;
}

function encodeBase64(bytes: Uint8Array): string {
    if (typeof btoa === 'function') {
        let binary = '';
        const len = bytes.length;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
    return Buffer.from(bytes).toString('base64');
}

function decodeBase64(value: string): Uint8Array {
    if (typeof atob === 'function') {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }
    return new Uint8Array(Buffer.from(value, 'base64'));
}

function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || 'api';
}
