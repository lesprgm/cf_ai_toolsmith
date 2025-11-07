import type { SkillDefinition } from './durable_objects/SkillRegistry';

interface OpenAPISpec {
    openapi?: string;
    swagger?: string;
    info?: {
        title?: string;
        version?: string;
        description?: string;
    };
    servers?: Array<{ url: string }>;
    basePath?: string;
    host?: string;
    schemes?: string[];
    paths: Record<string, Record<string, any>>;
}

interface AIToolSchema {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, any>;
            required: string[];
        };
    };
}

export function parseOpenAPIToSkills(spec: OpenAPISpec): {
    skills: SkillDefinition[];
    baseUrl: string;
    metadata: { title?: string; version?: string; description?: string };
} {
    // Extract base URL
    let baseUrl = '';
    if (spec.servers && spec.servers.length > 0) {
        baseUrl = spec.servers[0].url;
    } else if (spec.host) {
        const scheme = spec.schemes?.[0] || 'https';
        baseUrl = `${scheme}://${spec.host}${spec.basePath || ''}`;
    }

    const skills: SkillDefinition[] = [];

    // Parse each path
    for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, operation] of Object.entries(methods)) {
            if (!['get', 'post', 'put', 'delete', 'patch'].includes(method.toLowerCase())) {
                continue;
            }

            const operationId = operation.operationId || `${method}_${path.replace(/\//g, '_')}`;
            const summary = operation.summary || operation.description || `${method.toUpperCase()} ${path}`;

            const parameters = [];
            if (operation.parameters) {
                for (const param of operation.parameters) {
                    parameters.push({
                        name: param.name,
                        in: param.in,
                        required: param.required || false,
                        type: param.schema?.type || param.type || 'string',
                        description: param.description || ''
                    });
                }
            }

            // Parse request body
            let requestBody;
            if (operation.requestBody) {
                const content = operation.requestBody.content;
                const contentType = Object.keys(content || {})[0] || 'application/json';
                requestBody = {
                    required: operation.requestBody.required || false,
                    contentType,
                    schema: content?.[contentType]?.schema || {}
                };
            }

            skills.push({
                name: operationId,
                description: summary,
                operationId,
                method: method.toUpperCase(),
                path,
                parameters,
                requestBody,
                baseUrl
            });
        }
    }

    return {
        skills,
        baseUrl,
        metadata: {
            title: spec.info?.title,
            version: spec.info?.version,
            description: spec.info?.description
        }
    };
}

//Convert skill definitions to AI-compatible tool schemas
export function skillsToAIToolSchemas(skills: SkillDefinition[]): AIToolSchema[] {
    return skills.map(skill => {
        const properties: Record<string, any> = {};
        const required: string[] = [];

        for (const param of skill.parameters) {
            properties[param.name] = {
                type: param.type,
                description: param.description || `${param.name} parameter`
            };

            if (param.required) {
                required.push(param.name);
            }
        }

        if (skill.requestBody?.required) {
            properties['body'] = {
                type: 'object',
                description: 'Request body data'
            };
            required.push('body');
        }

        return {
            type: 'function',
            function: {
                name: skill.name,
                description: `${skill.description} (${skill.method} ${skill.path})`,
                parameters: {
                    type: 'object',
                    properties,
                    required
                }
            }
        };
    });
}

export async function executeSkill(
    skill: SkillDefinition,
    parameters: Record<string, any>,
    apiKey?: string
): Promise<{ success: boolean; result?: any; error?: string }> {
    try {
        // Construct URL - handle case where baseUrl might already contain the path
        let url: string;
        if (skill.baseUrl.endsWith(skill.path)) {
            // baseUrl already contains the path (misconfigured spec) - use as-is
            url = skill.baseUrl;
        } else {
            url = skill.baseUrl + skill.path;
        }

        for (const param of skill.parameters) {
            if (param.in === 'path' && parameters[param.name]) {
                url = url.replace(`{${param.name}}`, encodeURIComponent(String(parameters[param.name])));
            }
        }

        const queryParams = new URLSearchParams();
        for (const param of skill.parameters) {
            if (param.in === 'query' && parameters[param.name]) {
                queryParams.append(param.name, String(parameters[param.name]));
            }
        }
        if (queryParams.toString()) {
            url += '?' + queryParams.toString();
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'User-Agent': 'CF-ToolSmith/1.0'
        };

        if (apiKey) {
            if (apiKey.startsWith('Bearer ')) {
                headers['Authorization'] = apiKey;
            } else if (apiKey.startsWith('sk_') || apiKey.startsWith('pk_')) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            } else {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }
        }

        // Add header parameters
        for (const param of skill.parameters) {
            if (param.in === 'header' && parameters[param.name]) {
                headers[param.name] = String(parameters[param.name]);
            }
        }

        // Build request
        const requestInit: RequestInit = {
            method: skill.method,
            headers
        };

        if (['POST', 'PUT', 'PATCH'].includes(skill.method)) {
            if (parameters.body) {
                requestInit.body = JSON.stringify(parameters.body);
            } else if (skill.requestBody) {
                const bodyData: Record<string, any> = {};
                for (const [key, value] of Object.entries(parameters)) {
                    const isPathOrQuery = skill.parameters.some(p =>
                        p.name === key && (p.in === 'path' || p.in === 'query' || p.in === 'header')
                    );
                    if (!isPathOrQuery) {
                        bodyData[key] = value;
                    }
                }
                if (Object.keys(bodyData).length > 0) {
                    requestInit.body = JSON.stringify(bodyData);
                }
            }
        }

        // Execute request
        const response = await fetch(url, requestInit);
        const contentType = response.headers.get('content-type');

        let result;
        if (contentType?.includes('application/json')) {
            result = await response.json();
        } else {
            result = await response.text();
        }

        if (!response.ok) {
            return {
                success: false,
                error: `HTTP ${response.status}: ${JSON.stringify(result)}`
            };
        }

        return {
            success: true,
            result
        };
    } catch (error) {
        return {
            success: false,
            error: (error as Error).message
        };
    }
}
