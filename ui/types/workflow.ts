export type StepKey = 'parse' | 'generate' | 'verify' | 'install' | 'deploy';
export type StepState = 'pending' | 'in-progress' | 'completed';

export interface EndpointMetadata {
  id?: string;
  method: string;
  path: string;
  description?: string;
  query?: Record<string, { description?: string; required?: boolean }>;
  headers?: Record<string, { description?: string; required?: boolean }>;
  auth?: string;
  sampleRequest?: Record<string, any>;
  sampleResponse?: Record<string, any>;
}

export interface ParseResult {
  format: string;
  csm: {
    name: string;
    version?: string;
    summary?: string;
    endpoints: Array<EndpointMetadata & { id: string }>;
  };
  warnings: string[];
}

export interface GenerateResult {
  code: string;
  exports: string[];
  metadata?: EndpointMetadata | null;
  prompt: string;
}

export interface VerifyResult {
  success: boolean;
  error?: string;
  smokeTestResults?: {
    exportsFound?: string[];
  };
}

export interface InstallResult {
  success: boolean;
  toolId: string;
  error?: string;
}

export interface TemplateConnector {
  id: string;
  name: string;
  description: string;
  category: string;
  endpoint: EndpointMetadata;
  metadata: Record<string, any>;
  exports: string[];
  code: string;
}

export interface ConnectorEntry extends GenerateResult {
  verified?: boolean;
  installed?: boolean;
  installedToolId?: string;
}

export interface TemplateInstallResponse extends InstallResult {
  template: TemplateConnector;
}

export interface TestConnectorResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
  error?: string;
}

export interface SandboxScenario {
  id: string;
  name: string;
  description?: string;
  endpointId?: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: any;
  };
  intervalMinutes?: number | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastStatus?: number;
  lastDurationMs?: number;
  lastError?: string;
  lastHeaders?: Record<string, string>;
  lastBodyPreview?: string;
}

export interface ScenarioRunResult {
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

export interface SandboxFormState {
  url: string;
  method: string;
  headers: string;
  body: string;
}
