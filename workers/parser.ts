import type { Env } from './bindings';
import { safeJsonParse } from './utils/json';
import { parseYaml } from './utils/yaml';
import { getGlobalLogger } from './utils/log';

export const DEFAULT_TEXT_PARSE_PROMPT = `You are an expert API architect. Convert the following natural-language API description into a JSON object that EXACTLY matches the Common Spec Model (CSM) schema:

- Do not include code fences or commentary.
- Output ONLY valid JSON.
- Include keys: name, version (optional), summary (optional), auth (optional), endpoints (required).
- For each endpoint include: id, method, path, description (optional), pathParams (optional), query (optional), headers (optional), body (optional), responses (optional), examples (optional), authRequired (optional).

Input:
{{INPUT}}`;

export const DEFAULT_TEXT_PARSE_SYSTEM_PROMPT = 'You are an API specification expert. Output only valid JSON.';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface CSMEndpointParam {
  type: string;
  required?: boolean;
  description?: string;
}

export interface CSMEndpoint {
  id: string;
  method: HttpMethod;
  path: string;
  description?: string;
  pathParams?: string[];
  query?: Record<string, CSMEndpointParam>;
  headers?: Record<string, CSMEndpointParam | string>;
  body?: {
    contentType?: string;
    schema?: any;
  };
  responses?: Record<string, any>;
  examples?: {
    request?: any;
    response?: any;
  };
  authRequired?: boolean;
}

export interface CSMAuth {
  type: 'none' | 'apiKey' | 'bearer' | 'basic';
  in?: 'header' | 'query';
  name?: string;
}

export interface CommonSpecModel {
  name: string;
  version?: string;
  summary?: string;
  auth?: CSMAuth;
  endpoints: CSMEndpoint[];
}

export interface ParseResult {
  format: 'openapi' | 'graphql' | 'json-schema' | 'xml' | 'text' | 'unknown';
  csm: CommonSpecModel;
  warnings: string[];
  logs: { level: 'info' | 'warn' | 'error'; message: string }[];
}


export function detectFormat(content: string, filename?: string): string {
  const lower = content.toLowerCase().trim();
  const ext = filename?.split('.').pop()?.toLowerCase();

  // OpenAPI detection
  if (lower.includes('"openapi"') || lower.includes('openapi:') || 
      lower.includes('"swagger"') || lower.includes('swagger:')) {
    return 'openapi';
  }

  // GraphQL detection
  if (lower.includes('"__schema"') || lower.includes('__schema') ||
      lower.includes('type query') || lower.includes('type mutation')) {
    return 'graphql';
  }

  // JSON Schema detection  
  if (lower.includes('"$schema"') && lower.includes('json-schema')) {
    return 'json-schema';
  }

  // XML detection
  if (lower.startsWith('<?xml') || lower.startsWith('<')) {
    return 'xml';
  }

  // Extension-based
  if (ext === 'yaml' || ext === 'yml') return 'openapi';
  if (ext === 'graphql' || ext === 'gql') return 'graphql';
  if (ext === 'xml' || ext === 'wsdl') return 'xml';

  return 'text';
}


function parseOpenAPI(spec: any): CommonSpecModel {
  const logger = getGlobalLogger();
  logger.info('Parsing OpenAPI specification');

  const csm: CommonSpecModel = {
    name: spec.info?.title || 'Unnamed API',
    version: spec.info?.version,
    summary: spec.info?.description,
    endpoints: [],
  };

  // Parse auth
  if (spec.security && spec.components?.securitySchemes) {
    const firstSecurityName = Object.keys(spec.security[0] || {})[0];
    const securityScheme = spec.components.securitySchemes[firstSecurityName];
    
    if (securityScheme) {
      if (securityScheme.type === 'apiKey') {
        csm.auth = {
          type: 'apiKey',
          in: securityScheme.in as any,
          name: securityScheme.name,
        };
      } else if (securityScheme.type === 'http' && securityScheme.scheme === 'bearer') {
        csm.auth = { type: 'bearer' };
      } else if (securityScheme.type === 'http' && securityScheme.scheme === 'basic') {
        csm.auth = { type: 'basic' };
      }
    }
  }

  // Parse endpoints
  const paths = spec.paths || {};
  let endpointId = 0;

  for (const [path, pathItem] of Object.entries<any>(paths)) {
    for (const [method, operation] of Object.entries<any>(pathItem)) {
      const httpMethod = method.toUpperCase();
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(httpMethod)) continue;

      const securityConfig =
        operation.security ?? (pathItem as any)?.security ?? spec.security;
      const authRequired = Array.isArray(securityConfig) ? securityConfig.length > 0 : false;

      const endpoint: CSMEndpoint = {
        id: `ep${endpointId++}`,
        method: httpMethod as HttpMethod,
        path,
        description: operation.summary || operation.description,
        authRequired,
      };

      // Path parameters
      const pathParams: string[] = [];
      const queryParams: Record<string, CSMEndpointParam> = {};
      const headerParams: Record<string, CSMEndpointParam> = {};

      const pathLevelParams = Array.isArray((pathItem as any)?.parameters)
        ? (pathItem as any).parameters
        : [];
      const operationParams = Array.isArray(operation.parameters) ? operation.parameters : [];

      const paramIndex = new Map<string, any>();
      for (const param of pathLevelParams) {
        if (param?.name && param?.in) {
          paramIndex.set(`${param.in}:${param.name}`, param);
        }
      }
      for (const param of operationParams) {
        if (param?.name && param?.in) {
          paramIndex.set(`${param.in}:${param.name}`, param);
        }
      }

      for (const param of paramIndex.values()) {
        if (param.in === 'path') {
          pathParams.push(param.name);
        } else if (param.in === 'query') {
          queryParams[param.name] = {
            type: param.schema?.type || 'string',
            required: param.required,
            description: param.description,
          };
        } else if (param.in === 'header') {
          headerParams[param.name] = {
            type: param.schema?.type || 'string',
            required: param.required,
            description: param.description,
          };
        }
      }

      if (pathParams.length) endpoint.pathParams = pathParams;
      if (Object.keys(queryParams).length) endpoint.query = queryParams;
      if (Object.keys(headerParams).length) endpoint.headers = headerParams;

      if (operation.requestBody) {
        const content = operation.requestBody.content;
        const contentType = Object.keys(content || {})[0];
        if (contentType) {
          endpoint.body = {
            contentType,
            schema: content[contentType].schema,
          };
        }
      }

      endpoint.responses = operation.responses || {};

      csm.endpoints.push(endpoint);
    }
  }

  logger.info(`Extracted ${csm.endpoints.length} endpoints from OpenAPI spec`);
  return csm;
}


function parseGraphQL(introspection: any): CommonSpecModel {
  const logger = getGlobalLogger();
  logger.info('Parsing GraphQL introspection');

  const csm: CommonSpecModel = {
    name: 'GraphQL API',
    auth: { type: 'none' },
    endpoints: [],
  };

  const schema = introspection.data?.__schema || introspection.__schema;
  if (!schema) {
    logger.warn('No __schema found in GraphQL introspection');
    return csm;
  }

  let endpointId = 0;

  // Parse Query type
  const queryType = schema.types?.find((t: any) => t.name === schema.queryType?.name);
  if (queryType?.fields) {
    for (const field of queryType.fields) {
      csm.endpoints.push({
        id: `ep${endpointId++}`,
        method: 'POST',
        path: '/graphql',
        description: `Query: ${field.name}`,
        body: {
          contentType: 'application/json',
          schema: {
            query: `query { ${field.name} }`,
            args: field.args,
          },
        },
      });
    }
  }

  // Parse Mutation type
  const mutationType = schema.types?.find((t: any) => t.name === schema.mutationType?.name);
  if (mutationType?.fields) {
    for (const field of mutationType.fields) {
      csm.endpoints.push({
        id: `ep${endpointId++}`,
        method: 'POST',
        path: '/graphql',
        description: `Mutation: ${field.name}`,
        body: {
          contentType: 'application/json',
          schema: {
            query: `mutation { ${field.name} }`,
            args: field.args,
          },
        },
      });
    }
  }

  logger.info(`Extracted ${csm.endpoints.length} operations from GraphQL`);
  return csm;
}

/**
 * Infer CSM from natural language text using LLM
 */
async function inferFromText(
  content: string,
  env: Env,
  promptOverride?: string,
  systemOverride?: string
): Promise<CommonSpecModel> {
  const logger = getGlobalLogger();
  logger.info('Inferring spec from natural language using LLM');

  // Load prompt template
  const promptTemplate = (promptOverride || DEFAULT_TEXT_PARSE_PROMPT.replace('{{INPUT}}', content)).trim();

  const systemPrompt = systemOverride || DEFAULT_TEXT_PARSE_SYSTEM_PROMPT;

  try {
    const response = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: promptTemplate,
        },
      ],
    });

    const responseText = response.response || '{}';
    
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? safeJsonParse(jsonMatch[0]) : null;

    if (parsed && parsed.endpoints) {
      logger.info(`LLM inferred ${parsed.endpoints.length} endpoints`);
      return parsed as CommonSpecModel;
    }

    logger.warn('LLM response did not contain valid CSM');
    return createPlaceholderCSM('Inferred API');
  } catch (error) {
    logger.error(`LLM inference failed: ${(error as Error).message}`);
    return createPlaceholderCSM('Failed Inference');
  }
}


function createPlaceholderCSM(name: string): CommonSpecModel {
  return {
    name,
    auth: { type: 'none' },
    endpoints: [
      {
        id: 'ep0',
        method: 'GET',
        path: '/health',
        description: 'Placeholder health check endpoint',
      },
    ],
  };
}


export async function parseSpecToCSM(
  content: string,
  filename: string | undefined,
  env: Env,
  options?: {
    textPrompt?: string;
    textSystemPrompt?: string;
  }
): Promise<ParseResult> {
  const logger = getGlobalLogger();
  const warnings: string[] = [];

  logger.info(`Parsing file: ${filename || 'unknown'}`);

  const format = detectFormat(content, filename);
  logger.info(`Detected format: ${format}`);

  let csm: CommonSpecModel;

  try {
    if (format === 'openapi') {
      // Try JSON first, then YAML
      let spec = safeJsonParse(content);
      if (!spec) {
        spec = parseYaml(content);
      }
      if (spec) {
        csm = parseOpenAPI(spec);
      } else {
        warnings.push('Failed to parse OpenAPI as JSON or YAML');
        csm = createPlaceholderCSM('OpenAPI Parse Failed');
      }
    } else if (format === 'graphql') {
      const spec = safeJsonParse(content);
      if (spec) {
        csm = parseGraphQL(spec);
      } else {
        warnings.push('Failed to parse GraphQL introspection JSON');
        csm = createPlaceholderCSM('GraphQL Parse Failed');
      }
    } else if (format === 'text' || format === 'unknown') {
      csm = await inferFromText(content, env, options?.textPrompt, options?.textSystemPrompt);
    } else {
      warnings.push(`Format '${format}' not fully implemented, using LLM inference`);
      csm = await inferFromText(content, env, options?.textPrompt, options?.textSystemPrompt);
    }

    // Ensure at least one endpoint
    if (!csm.endpoints || csm.endpoints.length === 0) {
      warnings.push('No endpoints found, adding placeholder');
      csm.endpoints = [
        {
          id: 'ep0',
          method: 'GET',
          path: '/',
          description: 'Default endpoint',
        },
      ];
    }

    logger.info(`Parse complete: ${csm.endpoints.length} endpoints`);

    return {
      format: format as any,
      csm,
      warnings,
      logs: logger.dump(),
    };
  } catch (error) {
    logger.error(`Parse failed: ${(error as Error).message}`);
    return {
      format: 'unknown',
      csm: createPlaceholderCSM('Parse Error'),
      warnings: [`Fatal error: ${(error as Error).message}`],
      logs: logger.dump(),
    };
  }
}
