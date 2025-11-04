import type { Env } from './bindings';
import type { CommonSpecModel, CSMEndpoint } from './parser';
import { getGlobalLogger } from './utils/log';

export const DEFAULT_GENERATOR_SYSTEM_PROMPT =
  'You are an expert JavaScript/TypeScript developer. Generate clean, production-ready ES module code with proper error handling and types.';

export interface GenerateResult {
  code: string;
  exports: string[];
  logs: { level: 'info' | 'warn' | 'error'; message: string }[];
  prompt: string;
}

export async function generateCode(
  csm: CommonSpecModel,
  env: Env,
  options?: {
    systemPrompt?: string;
    userPrompt?: string;
  }
): Promise<GenerateResult> {
  const logger = getGlobalLogger();
  logger.info(`Generating code for API: ${csm.name}`);

  const prompt = options?.userPrompt || buildCodeGenerationPrompt(csm);
  const systemPrompt = options?.systemPrompt || DEFAULT_GENERATOR_SYSTEM_PROMPT;

  try {
    const response = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const responseText = response.response || '';

    const codeMatch = responseText.match(/```(?:javascript|typescript|js|ts)?\n([\s\S]*?)```/);
    let generatedCode = codeMatch ? codeMatch[1].trim() : responseText.trim();

    if (!generatedCode.includes('export ')) {
      generatedCode = wrapAsModule(generatedCode, csm);
    }

    const exports = extractExports(generatedCode);

    logger.info(`Generated ${generatedCode.split('\n').length} lines of code with ${exports.length} exports`);

    return {
      code: generatedCode,
      exports,
      logs: logger.dump(),
      prompt,
    };
  } catch (error) {
    logger.error(`Code generation failed: ${(error as Error).message}`);
    return {
      code: generateFallbackCode(csm),
      exports: csm.endpoints.map((ep) => functionNameForEndpoint(ep)),
      logs: logger.dump(),
      prompt,
    };
  }
}

function buildCodeGenerationPrompt(csm: CommonSpecModel): string {
  const endpointsDesc = csm.endpoints
    .map(
      (ep) =>
        `- **${ep.method} ${ep.path}** (function: \`${functionNameForEndpoint(ep)}\`)
  ${ep.description || 'No description'}
  Params: ${JSON.stringify(ep.query || {})}
  Headers: ${JSON.stringify(ep.headers || {})}
  Body: ${ep.body ? JSON.stringify(ep.body.schema) : 'none'}`
    )
    .join('\n\n');

  return `
Generate a JavaScript ES module that provides functions to call the following API endpoints:

**API Name:** ${csm.name}
**Version:** ${csm.version || 'N/A'}
**Summary:** ${csm.summary || 'N/A'}
**Auth:** ${csm.auth ? JSON.stringify(csm.auth) : 'None'}

**Endpoints:**
${endpointsDesc}

**Requirements:**
1. Export one async function per endpoint
2. Function names: ${csm.endpoints.map((ep) => `\`${functionNameForEndpoint(ep)}\``).join(', ')}
3. Each function accepts: \`(params, options)\` where:
   - \`params\`: object with path/query/body parameters
   - \`options\`: optional config like \`{ baseUrl, headers, apiKey }\`
4. Use native \`fetch()\` for HTTP requests
5. Handle auth if specified (inject API key or bearer token)
6. Return parsed JSON response
7. Throw descriptive errors on failure
8. Include JSDoc comments for each function

Return ONLY the ES module code, no explanations.
  `.trim();
}

function generateFallbackCode(csm: CommonSpecModel): string {
  const functions = csm.endpoints
    .map(
      (ep) => `
/**
 * ${ep.description || `Call ${ep.method} ${ep.path}`}
 */
export async function ${functionNameForEndpoint(ep)}(params = {}, options = {}) {
  const { baseUrl = '', headers = {}, apiKey = '' } = options;
  const url = baseUrl + '${ep.path}';
  const fetchOptions = {
    method: '${ep.method}',
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (apiKey) fetchOptions.headers['Authorization'] = \`Bearer \${apiKey}\`;
  if (${ep.method !== 'GET' && ep.method !== 'DELETE'}) {
    fetchOptions.body = JSON.stringify(params);
  }
  const response = await fetch(url, fetchOptions);
  if (!response.ok) throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
  return response.json();
}
`
    )
    .join('\n');

  return `// Generated connector for ${csm.name}\n${functions}`;
}

function wrapAsModule(code: string, csm: CommonSpecModel): string {
  const exports = csm.endpoints.map((ep) => functionNameForEndpoint(ep)).join(', ');
  return `${code}\n\nexport { ${exports} };`;
}

function extractExports(code: string): string[] {
  const exportMatches = code.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g);
  const namedExports = code.matchAll(/export\s+\{\s*([^}]+)\s*\}/g);

  const exports: string[] = [];
  for (const match of exportMatches) {
    exports.push(match[1]);
  }
  for (const match of namedExports) {
    const names = match[1].split(',').map((n) => n.trim());
    exports.push(...names);
  }

  return [...new Set(exports)];
}

function functionNameForEndpoint(ep: CSMEndpoint): string {
  const method = ep.method.toLowerCase();
  const pathParts = ep.path
    .split('/')
    .filter((p) => p && !p.startsWith('{'))
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1));

  return `${method}${pathParts.join('')}`;
}
