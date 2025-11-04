export interface InstalledTool {
    name: string;
    code: string;
    exports: string[];
    installedAt: string;
    metadata?: Record<string, any>;
}

export class ToolRegistry {
    private state: DurableObjectState;
    private moduleCache: Map<string, Record<string, any>>;

    constructor(state: DurableObjectState, _env: any) {
        this.state = state;
        this.moduleCache = new Map();
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === '/install' && request.method === 'PUT') {
            const tool: InstalledTool = await request.json();
            await this.state.storage.put(`tool:${tool.name}`, tool);
            this.moduleCache.delete(tool.name);

            return jsonResp({ success: true, toolId: tool.name });
        }

        if (url.pathname === '/list' && request.method === 'GET') {
            const allTools = await this.state.storage.list<InstalledTool>({ prefix: 'tool:' });
            const tools: InstalledTool[] = [];
            for (const [_key, tool] of allTools) {
                tools.push(tool);
            }

            return jsonResp({ tools });
        }

        if (url.pathname === '/invoke' && request.method === 'POST') {
            const body = await request.json<any>();
            const toolName = body.toolName;
            const tool = await this.state.storage.get<InstalledTool>(`tool:${toolName}`);

            if (!tool) {
                return jsonResp({ error: 'Tool not found' }, 404);
            }

            try {
                let moduleExports = this.moduleCache.get(tool.name);
                if (!moduleExports) {
                    moduleExports = compileConnectorModule(tool.code);
                    this.moduleCache.set(tool.name, moduleExports);
                }

                const exportName =
                    body.exportName ||
                    (Array.isArray(tool.exports) && tool.exports.length > 0
                        ? tool.exports[0]
                        : Object.keys(moduleExports)[0]);

                if (!exportName) {
                    throw new Error('No exports available to invoke.');
                }

                const callable = moduleExports[exportName];
                if (typeof callable !== 'function') {
                    throw new Error(`Export "${exportName}" is not callable.`);
                }

                const params = body.params ?? {};
                const options = body.options ?? {};
                const result = await callable(params, options);

                return jsonResp({ success: true, result: sanitizeResult(result) });
            } catch (error) {
                const rawMessage = (error as Error).message || 'Unknown error';
                const friendlyMessage = `Dynamic connector execution is unavailable in local dev: ${rawMessage}`;
                return jsonResp(
                    {
                        error: friendlyMessage,
                    },
                    501,
                );
            }
        }

        return jsonResp({ error: 'Not found' }, 404);
    }
}

function jsonResp(data: any, status: number = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function compileConnectorModule(code: string): Record<string, any> {
    const exportMappings: Array<{ exported: string; reference: string }> = [];
    let transformed = code;
    let defaultIdentifier: string | null = null;

    const replaceDefaultFunction = (
        match: string,
        asyncPart: string | undefined,
        name: string | undefined,
    ) => {
        const identifier = name && name.trim().length ? name.trim() : '__default_export__';
        defaultIdentifier = identifier;
        return `${asyncPart || ''}function ${identifier}(`;
    };

    transformed = transformed.replace(
        /export\s+default\s+(async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g,
        (_, asyncPart, name) => replaceDefaultFunction(_, asyncPart, name),
    );

    transformed = transformed.replace(
        /export\s+default\s+(async\s+)?function\s*\(/g,
        (_, asyncPart) => replaceDefaultFunction(_, asyncPart, undefined),
    );

    transformed = transformed.replace(
        /export\s+default\s+((?:async\s+)?(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>)/g,
        (_, expression) => {
            const identifier = '__default_export__';
            defaultIdentifier = identifier;
            return `const ${identifier} = ${expression}`;
        },
    );

    transformed = transformed.replace(
        /export\s+(async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g,
        (_, asyncPart, name) => {
            const identifier = name.trim();
            exportMappings.push({ exported: identifier, reference: identifier });
            return `${asyncPart || ''}function ${identifier}(`;
        },
    );

    transformed = transformed.replace(
        /export\s+(const|let|var)\s+([A-Za-z0-9_]+)\s*=/g,
        (_, decl, name) => {
            const identifier = name.trim();
            exportMappings.push({ exported: identifier, reference: identifier });
            return `${decl} ${identifier} =`;
        },
    );

    transformed = transformed.replace(
        /export\s+class\s+([A-Za-z0-9_]+)/g,
        (_, name) => {
            const identifier = name.trim();
            exportMappings.push({ exported: identifier, reference: identifier });
            return `class ${identifier}`;
        },
    );

    transformed = transformed.replace(/export\s*\{([^}]+)\};?/g, (_, inner) => {
        inner
            .split(',')
            .map((part: string) => part.trim())
            .filter(Boolean)
            .forEach((part: string) => {
                const match = part.match(/^([A-Za-z0-9_]+)(?:\s+as\s+([A-Za-z0-9_]+))?$/i);
                if (match) {
                    const original = match[1].trim();
                    const alias = (match[2] || original).trim();
                    exportMappings.push({ exported: alias, reference: original });
                }
            });
        return '';
    });

    const lines: string[] = [];
    lines.push(`"use strict";`);
    lines.push(`const exportsObj = Object.create(null);`);
    lines.push(transformed);

    const seenExports = new Set<string>();
    for (const mapping of exportMappings) {
        if (!seenExports.has(mapping.exported)) {
            lines.push(`exportsObj["${mapping.exported}"] = ${mapping.reference};`);
            seenExports.add(mapping.exported);
        }
    }

    if (defaultIdentifier && !seenExports.has('default')) {
        lines.push(`exportsObj["default"] = ${defaultIdentifier};`);
    }

    lines.push('return exportsObj;');

    const factory = new Function(
        'fetch',
        'Request',
        'Response',
        'Headers',
        'FormData',
        'URL',
        'console',
        'setTimeout',
        'setInterval',
        'AbortController',
        lines.join('\n'),
    );

    return factory(
        fetch,
        Request,
        Response,
        Headers,
        FormData,
        URL,
        console,
        setTimeout,
        setInterval,
        AbortController,
    );
}

function sanitizeResult(result: any): any {
    if (
        result === null ||
        typeof result === 'number' ||
        typeof result === 'boolean' ||
        typeof result === 'string'
    ) {
        return result;
    }

    if (result instanceof Response) {
        return {
            status: result.status,
            statusText: result.statusText,
        };
    }

    try {
        return JSON.parse(JSON.stringify(result));
    } catch {
        return String(result);
    }
}
