import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import DropZone from '../components/DropZone';
import { usePromptSettings } from '../hooks/usePromptSettings';
import { useSession } from '../context/SessionContext';

const API_BASE =
  (import.meta.env.VITE_WORKER_BASE_URL as string | undefined)?.replace(/\/$/, '') || '';

// Helper to access alert (TypeScript DOM types issue workaround)
declare const window: any;
const showAlert = (message: string) => window.alert(message);

type StepKey = 'parse' | 'generate' | 'verify' | 'install' | 'deploy';
type StepState = 'pending' | 'in-progress' | 'completed';

interface EndpointMetadata {
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

interface TemplatesResponse {
  templates?: TemplateConnector[];
}

interface TestConnectorResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
  error?: string;
}

interface SandboxFormState {
  url: string;
  method: string;
  headers: string;
  body: string;
}

interface ParseResult {
  format: string;
  csm: {
    name: string;
    version?: string;
    summary?: string;
    endpoints: Array<EndpointMetadata & { id: string }>;
  };
  warnings: string[];
}

interface GenerateResult {
  code: string;
  exports: string[];
  metadata?: EndpointMetadata | null;
  prompt: string;
}

interface VerifyResult {
  success: boolean;
  error?: string;
}

interface InstallResult {
  success: boolean;
  toolId: string;
  error?: string;
}

interface TemplateConnector {
  id: string;
  name: string;
  description: string;
  category: string;
  endpoint: EndpointMetadata;
  metadata: Record<string, any>;
  exports: string[];
  code: string;
}

interface ConnectorEntry extends GenerateResult {
  verified?: boolean;
  installed?: boolean;
}

interface TemplateInstallResponse extends InstallResult {
  template: TemplateConnector;
}

export default function App() {
  const [sessionId] = useState<string>(`session-${Date.now()}`);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [connectors, setConnectors] = useState<Map<string, ConnectorEntry>>(new Map());
  const [isUploading, setIsUploading] = useState(false);
  const [templates, setTemplates] = useState<TemplateConnector[]>([]);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [detailConnector, setDetailConnector] = useState<{
    id: string;
    title: string;
    source: 'generated' | 'template';
    connector?: ConnectorEntry;
    template?: TemplateConnector;
  } | null>(null);
  const [sandboxResponse, setSandboxResponse] = useState<TestConnectorResponse | null>(null);
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const [isTestingConnector, setIsTestingConnector] = useState(false);
  const [sandboxForm, setSandboxForm] = useState<SandboxFormState>({
    url: '',
    method: 'GET',
    headers: '',
    body: '',
  });
  const [analyticsEvents, setAnalyticsEvents] = useState<AnalyticsEvent[]>([]);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [persona, setPersona] = useState<PersonaKey>('default');

  const sandboxFieldIds = useMemo(
    () => ({
      url: `sandbox-url-${sessionId}`,
      method: `sandbox-method-${sessionId}`,
      headers: `sandbox-headers-${sessionId}`,
      body: `sandbox-body-${sessionId}`,
    }),
    [sessionId],
  );

  const promptFieldIds = useMemo(
    () => ({
      parsePrompt: `prompt-parse-${sessionId}`,
      parseSystemPrompt: `prompt-parse-system-${sessionId}`,
      generatePrompt: `prompt-generate-${sessionId}`,
      generateSystemPrompt: `prompt-generate-system-${sessionId}`,
    }),
    [sessionId],
  );

  const defaultPromptSettings: PromptSettings = {
    parsePrompt: '',
    parseSystemPrompt: '',
    generatePrompt: '',
    generateSystemPrompt: '',
  };

  const [promptSettings, setPromptSettings] = useState<PromptSettings>(() => {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('toolsmith-prompts');
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as Partial<PromptSettings>;
          return { ...defaultPromptSettings, ...parsed };
        } catch (error) {
          console.warn('Failed to parse stored prompt settings', error);
        }
      }
    }
    return defaultPromptSettings;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('toolsmith-prompts', JSON.stringify(promptSettings));
    }
  }, [promptSettings]);

  const updatePromptSettings = (updates: Partial<PromptSettings>) => {
    setPromptSettings((previous: PromptSettings) => ({ ...previous, ...updates }));
  };

  const updateSandboxForm = (updates: Partial<SandboxFormState>) => {
    setSandboxForm((previous: SandboxFormState) => ({ ...previous, ...updates }));
  };

  const stepOrder: StepKey[] = ['parse', 'generate', 'verify', 'install', 'deploy'];
  const [stepStatus, setStepStatus] = useState<Record<StepKey, StepState>>({
    parse: 'pending',
    generate: 'pending',
    verify: 'pending',
    install: 'pending',
    deploy: 'pending',
  });

  const updateStepStatus = (updates: Partial<Record<StepKey, StepState>>) => {
    setStepStatus((prev: Record<StepKey, StepState>) => ({ ...prev, ...updates }));
  };

  const fetchTemplates = async () => {
    setIsLoadingTemplates(true);
    setTemplateError(null);
    try {
      const response = await fetch(`${API_BASE}/api/templates`);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data: TemplatesResponse = await response.json();
      setTemplates(data.templates ?? []);
    } catch (error) {
      console.error('Failed to load templates', error);
      setTemplateError('Unable to load templates');
    } finally {
      setIsLoadingTemplates(false);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/analytics`);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data: AnalyticsResponse = await response.json();
      setAnalyticsEvents(data.events ?? []);
      setAnalyticsError(null);
    } catch (error) {
      console.error('Failed to load analytics', error);
      setAnalyticsError('Unable to load analytics data');
    }
  };

  useEffect(() => {
    fetchTemplates();
    fetchAnalytics();
    const analyticsInterval = window.setInterval(fetchAnalytics, 15000);
    return () => window.clearInterval(analyticsInterval);
  }, []);

  const handleFileSelect = async (file: File) => {
    setIsUploading(true);
    setParseResult(null);
    setConnectors(new Map());
    updateStepStatus({
      parse: 'in-progress',
      generate: 'pending',
      verify: 'pending',
      install: 'pending',
      deploy: 'pending',
    });

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (promptSettings.parsePrompt.trim()) {
        formData.append('customParsePrompt', promptSettings.parsePrompt.trim());
      }
      if (promptSettings.parseSystemPrompt.trim()) {
        formData.append('customParseSystemPrompt', promptSettings.parseSystemPrompt.trim());
      }

      const response = await fetch(`${API_BASE}/api/parse`, {
        method: 'POST',
        headers: { 'X-Session-ID': sessionId },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Parse failed: ${response.statusText}`);
      }

      const data: ParseResult = await response.json();
      setParseResult(data);
      updateStepStatus({ parse: 'completed' });
      fetchAnalytics();
    } catch (error) {
      console.error('Upload error:', error);
      showAlert('Failed to parse spec');
      updateStepStatus({ parse: 'pending' });
    } finally {
      setIsUploading(false);
    }
  };

  const handleGenerateConnector = async (endpointId: string) => {
    if (!parseResult) return;

    try {
      updateStepStatus({ generate: 'in-progress' });
      const response = await fetch(`${API_BASE}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId,
        },
        body: JSON.stringify({
          csm: parseResult.csm,
          endpointId,
          customPrompt: promptSettings.generatePrompt.trim() || undefined,
          customSystemPrompt: promptSettings.generateSystemPrompt.trim() || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`Generate failed: ${response.statusText}`);
      }

      const data: GenerateResult = await response.json();
      setConnectors((prev: Map<string, ConnectorEntry>) => {
        const next = new Map(prev);
        const existing = next.get(endpointId);
        next.set(endpointId, {
          ...existing,
          ...data,
          verified: existing?.verified,
          installed: existing?.installed,
        });
        return next;
      });
      updateStepStatus({ generate: 'completed', verify: 'pending', install: 'pending' });
      fetchAnalytics();
    } catch (error) {
      console.error('Generation error:', error);
      showAlert('Failed to generate connector');
      updateStepStatus({ generate: 'pending' });
    }
  };

  const handleVerifyConnector = async (endpointId: string) => {
    const connector = connectors.get(endpointId);
    if (!connector) return;

    try {
      updateStepStatus({ verify: 'in-progress' });
      const response = await fetch(`${API_BASE}/api/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId,
        },
        body: JSON.stringify({ code: connector.code }),
      });

      if (!response.ok) {
        throw new Error(`Verify failed: ${response.statusText}`);
      }

      const data: VerifyResult = await response.json();

      if (data.success) {
        setConnectors((prev: Map<string, ConnectorEntry>) => {
          const next = new Map(prev);
          const current = next.get(endpointId);
          if (current) {
            next.set(endpointId, { ...current, verified: true });
          }
          return next;
        });
        showAlert('Connector verified successfully!');
        updateStepStatus({ verify: 'completed', install: 'pending' });
        fetchAnalytics();
      } else {
        showAlert(`Verification failed: ${data.error || 'Unknown error'}`);
        updateStepStatus({ verify: 'pending' });
      }
    } catch (error) {
      console.error('Verification error:', error);
      showAlert('Failed to verify connector');
      updateStepStatus({ verify: 'pending' });
    }
  };

  const handleInstallConnector = async (endpointId: string) => {
    const connector = connectors.get(endpointId);
    if (!connector || !connector.verified) {
      showAlert('Please verify connector before installing');
      return;
    }

    try {
      updateStepStatus({ install: 'in-progress' });
      const response = await fetch(`${API_BASE}/api/install`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId,
        },
        body: JSON.stringify({
          toolName: endpointId,
          code: connector.code,
          exports: connector.exports,
          metadata: connector.metadata,
        }),
      });

      if (!response.ok) {
        throw new Error(`Install failed: ${response.statusText}`);
      }

      const data: InstallResult = await response.json();
      if (data.success) {
        showAlert(`Connector installed as ${data.toolId}`);
        setConnectors((prev: Map<string, ConnectorEntry>) => {
          const next = new Map(prev);
          const current = next.get(endpointId);
          if (current) {
            next.set(endpointId, { ...current, installed: true });
          }
          return next;
        });
        updateStepStatus({ install: 'completed', deploy: 'pending' });
        fetchAnalytics();
      } else {
        showAlert(`Installation failed: ${data.error || 'Unknown error'}`);
        updateStepStatus({ install: 'pending' });
      }
    } catch (error) {
      console.error('Installation error:', error);
      showAlert('Failed to install connector');
      updateStepStatus({ install: 'pending' });
    }
  };

  const handleInstallTemplate = async (templateId: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/templates/install`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId,
        },
        body: JSON.stringify({ templateId }),
      });

      if (!response.ok) {
        throw new Error(`Template install failed: ${response.statusText}`);
      }

      const data: TemplateInstallResponse = await response.json();
      if (data.success) {
        updateStepStatus({
          parse: 'completed',
          generate: 'completed',
          verify: 'completed',
          install: 'completed',
          deploy: 'pending',
        });
        fetchAnalytics();
      } else {
        showAlert(`Template installation failed: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Template install error:', error);
      showAlert('Failed to install template connector');
    }
  };

  const stepLabels: Record<StepKey, { label: string; description: string }> = {
    parse: { label: 'Parse', description: 'Normalize the uploaded specification.' },
    generate: { label: 'Generate', description: 'Create connector code using Workers AI.' },
    verify: { label: 'Verify', description: 'Ensure exports are callable.' },
    install: { label: 'Install', description: 'Store connector in the Tool Registry.' },
    deploy: { label: 'Deploy', description: 'Publish the Worker to Cloudflare (manual).' },
  };

  const stepIndicator = (step: StepKey) => {
    const state = stepStatus[step];
    if (state === 'completed') return 'bg-green-500';
    if (state === 'in-progress') return 'bg-orange-500';
    return 'bg-slate-300';
  };

  const analyticsSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    analyticsEvents.forEach((event) => {
      counts[event.type] = (counts[event.type] || 0) + 1;
    });
    return counts;
  }, [analyticsEvents]);

  const openConnectorDetail = (detail: {
    id: string;
    title: string;
    source: 'generated' | 'template';
    connector?: ConnectorEntry;
    template?: TemplateConnector;
  }) => {
    setDetailConnector(detail);
    const metadata =
      detail.connector?.metadata || detail.template?.endpoint || null;
    const suggestedBaseUrl =
      (detail.template?.metadata?.baseUrl as string | undefined) ||
      (metadata?.sampleRequest?.baseUrl as string | undefined) ||
      (metadata?.path?.startsWith('http') ? metadata?.path : '');

    setSandboxForm({
      url:
        suggestedBaseUrl && metadata?.path && !suggestedBaseUrl.endsWith(metadata.path)
          ? `${suggestedBaseUrl}${metadata.path.startsWith('/') ? metadata.path : `/${metadata.path}`}`
          : suggestedBaseUrl || '',
      method: metadata?.method || 'GET',
      headers: '',
      body: '',
    });
    setSandboxResponse(null);
    setSandboxError(null);
  };

  const closeDetail = () => {
    setDetailConnector(null);
    setSandboxResponse(null);
    setSandboxError(null);
  };

  const restorePromptSettings = () => {
    setPromptSettings(defaultPromptSettings);
  };

  const handleSandboxSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sandboxForm.url.trim()) {
      setSandboxError('URL is required for testing.');
      return;
    }

    let parsedHeaders: Record<string, string> = {};
    if (sandboxForm.headers.trim()) {
      try {
        const candidate = JSON.parse(sandboxForm.headers);
        Object.entries(candidate).forEach(([key, value]) => {
          if (typeof value === 'string') {
            parsedHeaders[key] = value;
          }
        });
      } catch (error) {
        setSandboxError('Headers must be valid JSON object (key-value pairs).');
        return;
      }
    }

    let requestBody: any = undefined;
    if (sandboxForm.body.trim()) {
      try {
        requestBody = JSON.parse(sandboxForm.body);
      } catch (error) {
        requestBody = sandboxForm.body;
      }
    }

    setIsTestingConnector(true);
    setSandboxError(null);
    setSandboxResponse(null);

    try {
      const response = await fetch(`${API_BASE}/api/test-connector`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId,
        },
        body: JSON.stringify({
          url: sandboxForm.url.trim(),
          method: sandboxForm.method || 'GET',
          headers: parsedHeaders,
          body: requestBody,
        }),
      });

      const data: TestConnectorResponse = await response.json();
      if (!response.ok) {
        setSandboxError(data.error || 'Request failed');
      } else {
        setSandboxResponse(data);
      }
    } catch (error) {
      console.error('Sandbox test failed', error);
      setSandboxError('Unable to execute test request');
    } finally {
      setIsTestingConnector(false);
    }
  };

  const currentDetail = detailConnector;
  const detailMetadata = currentDetail
    ? currentDetail.connector?.metadata || currentDetail.template?.endpoint || null
    : null;
  const detailCode = currentDetail?.connector?.code || currentDetail?.template?.code || '';
  const detailExports = currentDetail?.connector?.exports || currentDetail?.template?.exports || [];
  const sandboxResult = sandboxResponse;

  return (
    <>
      <div className="min-h-screen p-8">
        <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-8 text-center">
          <h1 className="text-4xl font-bold mb-2 text-slate-900">
            Cloudflare AI ToolSmith
          </h1>
          <p className="text-lg text-slate-600">
            Transform any specification into production-ready Cloudflare Workers.
          </p>
          <div className="flex justify-center items-center space-x-4 mt-4">
            <div className="flex items-center space-x-2 text-sm text-slate-500">
              <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
              <span>Parse</span>
            </div>
            <div className="text-slate-600">→</div>
            <div className="flex items-center space-x-2 text-sm text-slate-500">
              <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
              <span>Generate</span>
            </div>
            <div className="text-slate-600">→</div>
            <div className="flex items-center space-x-2 text-sm text-slate-500">
              <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
              <span>Verify</span>
            </div>
            <div className="text-slate-600">→</div>
            <div className="flex items-center space-x-2 text-sm text-slate-500">
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              <span>Deploy</span>
            </div>
          </div>
          <div className="flex justify-center mt-4 gap-3">
            <button
              onClick={() => {
                const el = document.getElementById('template-gallery');
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="btn-secondary"
            >
              Browse Template Connectors
            </button>
            <button onClick={() => setShowPromptModal(true)} className="btn-secondary">
              Advanced Prompt Settings
            </button>
          </div>
        </header>

        {/* Step Tracker */}
        <section className="card mb-8 p-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Workflow Progress</h2>
            <span className="text-xs text-slate-500">Session ID: {sessionId}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {stepOrder.map((step) => (
              <div key={step} className="flex items-center gap-3">
                <div className={`h-3 w-3 rounded-full ${stepIndicator(step)}`}></div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-slate-900">
                    {stepLabels[step].label}
                  </p>
                  <p className="text-xs text-slate-500">{stepLabels[step].description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Left Column */}
          <div className="space-y-6">
            {/* Upload Section */}
            <section className="card p-6">
              <h2 className="text-2xl font-semibold mb-4 text-slate-900">Upload Specification</h2>
              <DropZone onFileSelect={handleFileSelect} isUploading={isUploading} />
              <p className="text-xs text-slate-500 mt-4">
                Tip: adjust parsing and generation prompts via Advanced Prompt Settings for custom behaviour.
              </p>
            </section>

            {/* Template Gallery */}
            <section id="template-gallery" className="card p-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-2xl font-semibold text-slate-900">Template Connectors</h2>
                <button onClick={fetchTemplates} className="text-xs text-slate-500 hover:text-slate-900">
                  Refresh
                </button>
              </div>
              <p className="text-sm text-slate-600 mb-4">
                Install a ready-made connector to see the full pipeline without uploading a spec.
              </p>
              {templateError && <p className="text-sm text-red-500">{templateError}</p>}
              {isLoadingTemplates ? (
                <p className="text-sm text-slate-500">Loading templates…</p>
              ) : (
                <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                  {templates.map((template) => (
                    <div key={template.id} className="border border-slate-200 rounded-lg p-4 bg-white flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-slate-900 font-semibold">{template.name}</p>
                          <p className="text-xs uppercase tracking-wide text-slate-400">{template.category}</p>
                        </div>
                        <button
                          onClick={() => handleInstallTemplate(template.id)}
                          className="btn-primary text-xs px-3 py-1"
                        >
                          Install
                        </button>
                      </div>
                      <p className="text-sm text-slate-600">{template.description}</p>
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>{template.endpoint.method} {template.endpoint.path}</span>
                        <button
                          className="text-slate-500 hover:text-slate-900"
                          onClick={() => openConnectorDetail({
                            id: template.id,
                            title: template.name,
                            source: 'template',
                            template,
                          })}
                        >
                          View Details
                        </button>
                      </div>
                    </div>
                  ))}
                  {templates.length === 0 && !isLoadingTemplates && (
                    <p className="text-sm text-slate-500">No templates available yet.</p>
                  )}
                </div>
              )}
            </section>

            {/* Parsed Spec Display */}
            {parseResult && (
              <section className="card p-6">
                <h2 className="text-2xl font-semibold mb-4 text-slate-900">Parsed Specification</h2>
                <div className="space-y-3">
                  <div>
                    <span className="text-slate-600">Name:</span>{' '}
                    <span className="text-slate-900 font-medium">{parseResult.csm.name}</span>
                  </div>
                  <div>
                    <span className="text-slate-600">Format:</span>{' '}
                    <span className="text-cloudflare-orange font-medium">{parseResult.format}</span>
                  </div>
                  <div>
                    <span className="text-slate-600">Endpoints:</span>{' '}
                    <span className="text-slate-900 font-medium">{parseResult.csm.endpoints.length}</span>
                  </div>
                  {parseResult.csm.version && (
                    <div>
                      <span className="text-slate-600">Version:</span>{' '}
                      <span className="text-slate-900 font-medium">{parseResult.csm.version}</span>
                    </div>
                  )}
                </div>

                {parseResult.warnings.length > 0 && (
                  <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded">
                    <p className="text-yellow-500 text-sm font-medium mb-1">Warnings:</p>
                    {parseResult.warnings.map((warning, idx) => (
                      <p key={idx} className="text-yellow-600 text-xs">{warning}</p>
                    ))}
                  </div>
                )}

                <div className="mt-6">
                  <h3 className="text-lg font-medium mb-3 text-slate-900">Available Endpoints</h3>
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {parseResult.csm.endpoints.map((endpoint) => (
                      <div
                        key={endpoint.id}
                        className="flex items-center justify-between p-3 bg-slate-100 rounded border border-slate-200 hover:bg-slate-200 transition-colors"
                      >
                        <div className="flex-1">
                          <div className="flex items-center space-x-2">
                            <span className="px-2 py-1 text-xs font-mono bg-slate-900 text-cloudflare-orange rounded">
                              {endpoint.method}
                            </span>
                            <span className="text-slate-900 font-mono text-sm">{endpoint.path}</span>
                          </div>
                          {endpoint.description && (
                            <p className="text-slate-600 text-xs mt-1">{endpoint.description}</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setDetailConnector({
                              id: endpoint.id,
                              title: endpoint.path,
                              source: 'generated',
                              connector: connectors.get(endpoint.id) || undefined,
                            })}
                            className="px-3 py-2 text-xs text-slate-600 hover:text-slate-900"
                          >
                            Details
                          </button>
                          <button
                            onClick={() => handleGenerateConnector(endpoint.id)}
                            className="px-4 py-2 bg-cloudflare-orange hover:bg-orange-600 text-white rounded transition-colors text-sm font-medium"
                          >
                            Generate
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* Generated Connectors */}
            {connectors.size > 0 && (
              <section className="card p-6">
                <h2 className="text-2xl font-semibold mb-4 text-slate-900">Generated Connectors</h2>
                <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
                  {Array.from(connectors.entries()).map(([endpointId, connector]) => {
                    const endpoint = connector.metadata || parseResult?.csm.endpoints.find((e) => e.id === endpointId) || null;
                    return (
                      <div key={endpointId} className="p-4 bg-white rounded border border-slate-200 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="text-slate-900 font-medium">
                              {endpoint?.path || endpointId}
                            </p>
                            <p className="text-slate-600 text-xs">
                              Exports: {connector.exports.join(', ')}
                            </p>
                          </div>
                          <div className="flex items-center space-x-2 text-xs">
                            {connector.verified && (
                              <span className="px-2 py-1 bg-green-100 text-green-700 rounded">
                                Verified
                              </span>
                            )}
                            {connector.installed && (
                              <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded">
                                Installed
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2 mb-3">
                          <button
                            className="px-3 py-2 text-xs text-slate-600 hover:text-slate-900"
                            onClick={() => openConnectorDetail({
                              id: endpointId,
                              title: endpoint?.path || endpointId,
                              source: 'generated',
                              connector,
                            })}
                          >
                            Detail & Sandbox
                          </button>
                          <button
                            className="px-3 py-2 text-xs text-slate-600 hover:text-slate-900"
                            onClick={() => navigator.clipboard.writeText(connector.code)}
                          >
                            Copy Code
                          </button>
                        </div>
                        <div className="flex space-x-2">
                          {!connector.verified ? (
                            <button
                              onClick={() => handleVerifyConnector(endpointId)}
                              className="flex-1 px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-black rounded transition-colors text-sm font-medium"
                            >
                              Verify
                            </button>
                          ) : (
                            <button
                              onClick={() => handleInstallConnector(endpointId)}
                              className="flex-1 px-4 py-2 bg-green-500 hover:bg-green-600 text-black rounded transition-colors text-sm font-medium"
                            >
                              Install to Registry
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            <section className="card p-6">
              <h2 className="text-2xl font-semibold mb-4 text-slate-900">Usage Analytics</h2>
              <p className="text-sm text-slate-600 mb-4">
                Recent activity recorded by the Tool Registry and worker pipeline.
              </p>
              {analyticsError ? (
                <p className="text-sm text-red-500">{analyticsError}</p>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {['parse', 'generate', 'verify', 'install', 'template-install', 'test'].map((type) => (
                      <div key={type} className="border border-slate-200 rounded-lg px-3 py-2 bg-slate-50">
                        <p className="font-semibold text-slate-800 capitalize">{type.replace('-', ' ')}</p>
                        <p className="text-slate-500 text-xs">{analyticsSummary[type] || 0} events</p>
                      </div>
                    ))}
                  </div>
                  {analyticsEvents.length > 0 && (
                    <div className="text-xs text-slate-500">
                      <p>
                        Last event: {new Date(analyticsEvents[analyticsEvents.length - 1].timestamp).toLocaleString()} —
                        {analyticsEvents[analyticsEvents.length - 1].type}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </section>

            <ConsoleLog sessionId={sessionId} />
            <ChatInterface
              sessionId={sessionId}
              persona={persona}
              onPersonaChange={setPersona}
            />
          </div>
        </div>

        {/* Footer intentionally removed */}
      </div>
    </div>

    {currentDetail ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8">
        <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
            <div>
              <h3 className="text-xl font-semibold text-slate-900">{currentDetail.title}</h3>
              <p className="text-xs text-slate-500 capitalize">Source: {currentDetail.source}</p>
            </div>
            <button onClick={closeDetail} className="text-slate-500 hover:text-slate-900 text-2xl" aria-label="Close detail view">
              &times;
            </button>
          </div>
          <div className="grid md:grid-cols-2 gap-6 px-6 py-6 max-h-[80vh] overflow-y-auto">
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Endpoint</h4>
                {detailMetadata ? (
                  <div className="mt-2 text-sm text-slate-600 space-y-1">
                    <p>
                      <span className="font-mono text-xs px-2 py-1 bg-slate-900 text-cloudflare-orange rounded mr-2">
                        {detailMetadata.method}
                      </span>
                      <span className="font-mono">{detailMetadata.path}</span>
                    </p>
                    {detailMetadata.description && <p>{detailMetadata.description}</p>}
                    {detailMetadata.auth && (
                      <p className="text-xs text-slate-500">Auth: {detailMetadata.auth}</p>
                    )}
                    {detailMetadata.query && (
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase mt-2">Query Params</p>
                        <ul className="text-xs text-slate-500 list-disc list-inside space-y-1">
                          {Object.entries(detailMetadata.query ?? {}).map(([key, value]) => (
                            <li key={key}>
                              <span className="font-semibold">{key}</span>
                              {value.description ? ` – ${value.description}` : ''}
                              {value.required ? ' (required)' : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {detailMetadata.headers && (
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase mt-2">Headers</p>
                        <ul className="text-xs text-slate-500 list-disc list-inside space-y-1">
                          {Object.entries(detailMetadata.headers ?? {}).map(([key, value]) => (
                            <li key={key}>
                              <span className="font-semibold">{key}</span>
                              {value.description ? ` – ${value.description}` : ''}
                              {value.required ? ' (required)' : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No endpoint metadata available.</p>
                )}
              </div>

              <div>
                <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Code</h4>
                <pre className="mt-2 p-3 bg-slate-900 text-slate-100 text-xs rounded overflow-x-auto max-h-60">
                  <code>{detailCode}</code>
                </pre>
                <p className="text-xs text-slate-500 mt-2">
                  Exports: {detailExports.length ? detailExports.join(', ') : 'none'}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Testing Sandbox</h4>
                <form onSubmit={handleSandboxSubmit} className="space-y-3 mt-2">
                  <div>
                    <label
                      className="text-xs font-semibold text-slate-600 uppercase block mb-1"
                      htmlFor={sandboxFieldIds.url}
                    >
                      Request URL
                    </label>
                    <input
                      type="text"
                      id={sandboxFieldIds.url}
                      value={sandboxForm.url}
                      onChange={(e) => updateSandboxForm({ url: e.target.value })}
                      className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                      placeholder="https://api.example.com/resource"
                    />
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label
                        className="text-xs font-semibold text-slate-600 uppercase block mb-1"
                        htmlFor={sandboxFieldIds.method}
                      >
                        Method
                      </label>
                      <input
                        type="text"
                        id={sandboxFieldIds.method}
                        value={sandboxForm.method}
                        onChange={(e) => updateSandboxForm({ method: e.target.value })}
                        className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="flex-1">
                      <label
                        className="text-xs font-semibold text-slate-600 uppercase block mb-1"
                        htmlFor={sandboxFieldIds.headers}
                      >
                        Headers (JSON)
                      </label>
                      <textarea
                        id={sandboxFieldIds.headers}
                        value={sandboxForm.headers}
                        onChange={(e) => updateSandboxForm({ headers: e.target.value })}
                        className="w-full border border-slate-300 rounded px-3 py-2 text-sm min-h-[80px]"
                        placeholder='{"Authorization": "Bearer ..."}'
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      className="text-xs font-semibold text-slate-600 uppercase block mb-1"
                      htmlFor={sandboxFieldIds.body}
                    >
                      Body (JSON or string)
                    </label>
                    <textarea
                      id={sandboxFieldIds.body}
                      value={sandboxForm.body}
                      onChange={(e) => updateSandboxForm({ body: e.target.value })}
                      className="w-full border border-slate-300 rounded px-3 py-2 text-sm min-h-[100px]"
                      placeholder='{"name": "demo"}'
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500">Requests execute from the Worker runtime.</span>
                    <button
                      type="submit"
                      className="btn-primary text-sm px-4 py-2"
                      disabled={isTestingConnector}
                    >
                      {isTestingConnector ? 'Testing…' : 'Run Test'}
                    </button>
                  </div>
                </form>
                {sandboxError && <p className="text-sm text-red-500 mt-3">{sandboxError}</p>}
                {sandboxResult ? (
                  <div className="mt-4 border border-slate-200 rounded p-3 bg-slate-50 text-xs space-y-2">
                    <p className="text-slate-600">
                      Status: {sandboxResult.status} {sandboxResult.statusText} · {sandboxResult.durationMs} ms
                    </p>
                    <div>
                      <p className="font-semibold text-slate-700">Headers</p>
                      <pre className="bg-white border border-slate-200 rounded p-2 max-h-32 overflow-auto">
                        {JSON.stringify(sandboxResult.headers, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-700">Body</p>
                      <pre className="bg-white border border-slate-200 rounded p-2 max-h-48 overflow-auto">
                        {sandboxResult.body}
                      </pre>
                    </div>
                  </div>
                ) : null}
              </div>

              {detailMetadata?.sampleRequest && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Sample Request</h4>
                  <pre className="mt-2 p-3 bg-slate-900 text-slate-100 text-xs rounded overflow-x-auto">
                    {JSON.stringify(detailMetadata.sampleRequest, null, 2)}
                  </pre>
                </div>
              )}
              {detailMetadata?.sampleResponse && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Sample Response</h4>
                  <pre className="mt-2 p-3 bg-slate-900 text-slate-100 text-xs rounded overflow-x-auto">
                    {JSON.stringify(detailMetadata.sampleResponse, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    ) : null}

    {showPromptModal && (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-8">
        <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
            <h3 className="text-xl font-semibold text-slate-900">Advanced Prompt Settings</h3>
            <button
              onClick={() => setShowPromptModal(false)}
              className="text-slate-500 hover:text-slate-900 text-2xl"
              aria-label="Close prompt settings"
            >
              &times;
            </button>
          </div>
          <div className="px-6 py-6 space-y-6">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label
                  className="text-xs font-semibold text-slate-600 uppercase block mb-1"
                  htmlFor={promptFieldIds.parsePrompt}
                >
                  Custom Parse Prompt
                </label>
                <textarea
                  id={promptFieldIds.parsePrompt}
                  value={promptSettings.parsePrompt}
                  onChange={(e) => updatePromptSettings({ parsePrompt: e.target.value })}
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm min-h-[120px]"
                  placeholder="Override the instructions used when inferring a spec from natural language."
                />
              </div>
              <div>
                <label
                  className="text-xs font-semibold text-slate-600 uppercase block mb-1"
                  htmlFor={promptFieldIds.parseSystemPrompt}
                >
                  Parse System Prompt
                </label>
                <textarea
                  id={promptFieldIds.parseSystemPrompt}
                  value={promptSettings.parseSystemPrompt}
                  onChange={(e) => updatePromptSettings({ parseSystemPrompt: e.target.value })}
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm min-h-[120px]"
                  placeholder="System instructions for the parsing LLM."
                />
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label
                  className="text-xs font-semibold text-slate-600 uppercase block mb-1"
                  htmlFor={promptFieldIds.generatePrompt}
                >
                  Custom Generate Prompt
                </label>
                <textarea
                  id={promptFieldIds.generatePrompt}
                  value={promptSettings.generatePrompt}
                  onChange={(e) => updatePromptSettings({ generatePrompt: e.target.value })}
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm min-h-[120px]"
                  placeholder="Override the code generation instructions."
                />
              </div>
              <div>
                <label
                  className="text-xs font-semibold text-slate-600 uppercase block mb-1"
                  htmlFor={promptFieldIds.generateSystemPrompt}
                >
                  Generate System Prompt
                </label>
                <textarea
                  id={promptFieldIds.generateSystemPrompt}
                  value={promptSettings.generateSystemPrompt}
                  onChange={(e) => updatePromptSettings({ generateSystemPrompt: e.target.value })}
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm min-h-[120px]"
                  placeholder="System instructions for the code generation LLM."
                />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50">
            <button onClick={restorePromptSettings} className="text-sm text-slate-600 hover:text-slate-900">
              Restore Defaults
            </button>
            <button onClick={() => setShowPromptModal(false)} className="btn-primary text-sm px-4 py-2">
              Close
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
