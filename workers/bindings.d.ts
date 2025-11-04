export interface Env {
  AI: any;
  TOOL_REGISTRY: DurableObjectNamespace;
  SESSION_STATE: DurableObjectNamespace;
  ANALYTICS: DurableObjectNamespace;
  // DB?: D1Database; // optional
}

export interface CommonSpecModel {
  id: string;
  name: string;
  type: 'openapi' | 'graphql' | 'jsonschema' | 'xml' | 'markdown' | 'text';
  version: string;
  description: string;
  endpoints: SpecEndpoint[];
  entities: SpecEntity[];
  metadata: Record<string, any>;
  rawSpec: string;
  createdAt: string;
}

export interface SpecEndpoint {
  id: string;
  path: string;
  method: string;
  name: string;
  description: string;
  parameters: Parameter[];
  requestBody?: RequestBody;
  responses: Record<string, Response>;
  authentication?: AuthConfig;
}

export interface SpecEntity {
  id: string;
  name: string;
  type: string;
  properties: Record<string, Property>;
  required?: string[];
}

export interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  type: string;
  required: boolean;
  description?: string;
}

export interface RequestBody {
  contentType: string;
  schema: Record<string, any>;
  required: boolean;
}

export interface Response {
  description: string;
  contentType: string;
  schema?: Record<string, any>;
}

export interface Property {
  type: string;
  description?: string;
  format?: string;
  enum?: any[];
}

export interface AuthConfig {
  type: 'apikey' | 'bearer' | 'basic' | 'oauth2' | 'none';
  location?: 'header' | 'query';
  name?: string;
}


export interface WorkerConnector {
  id: string;
  specId: string;
  endpointId: string;
  name: string;
  code: string;
  language: 'typescript' | 'javascript';
  verified: boolean;
  testResults?: TestResult[];
  createdAt: string;
  updatedAt: string;
}

export interface TestResult {
  timestamp: string;
  success: boolean;
  statusCode?: number;
  responseTime?: number;
  error?: string;
  logs: string[];
}


export interface EdgeTool {
  id: string;
  name: string;
  description: string;
  connectorId: string;
  version: string;
  installed: boolean;
  endpoint: string;
  metadata: Record<string, any>;
}


export interface LogEvent {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  stage: 'parse' | 'normalize' | 'generate' | 'verify' | 'deploy';
  message: string;
  data?: any;
}
