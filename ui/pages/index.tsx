import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import DropZone from '../components/DropZone';
import ConsoleLog from '../components/ConsoleLog';
import ChatInterface, { PersonaKey } from '../components/ChatInterface';
import { usePromptSettings } from '../hooks/usePromptSettings';
import { useSession } from '../context/SessionContext';

const API_BASE =
  (import.meta.env.VITE_WORKER_BASE_URL as string | undefined)?.replace(/\/$/, '') || '';

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
  installedToolId?: string;
}

interface TemplateInstallResponse extends InstallResult {
  template: TemplateConnector;
}

export default function WorkflowPage({
  onNavigate,
}: {
  onNavigate: (view: 'workflow' | 'insights') => void;
}): JSX.Element {
  const { sessionId } = useSession();
  const { promptSettings } = usePromptSettings();
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
  const [persona, setPersona] = useState<PersonaKey>('default');
  const [showEndpointDetails, setShowEndpointDetails] = useState(true);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'info' | 'success' | 'error';
    text: string;
  } | null>(null);
  const parsedSpecRef = useRef<HTMLDivElement | null>(null);

  const notify = (type: 'info' | 'success' | 'error', text: string) => {
    setStatusMessage({ type, text });
  };

  const updateSandboxForm = (updates: Partial<SandboxFormState>) => {
    setSandboxForm((previous: SandboxFormState) => ({ ...previous, ...updates }));
  };

  const sandboxFieldIds = useMemo(
    () => ({
      url: `sandbox-url-${sessionId}`,
      method: `sandbox-method-${sessionId}`,
      headers: `sandbox-headers-${sessionId}`,
      body: `sandbox-body-${sessionId}`,
    }),
    [sessionId],
  );

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

  useEffect(() => {
    fetchTemplates();
  }, []);

  useEffect(() => {
    if (parseResult) {
      setShowEndpointDetails(true);
      if (parsedSpecRef.current) {
        requestAnimationFrame(() => {
          parsedSpecRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
    }
  }, [parseResult]);

  useEffect(() => {
    if (parseResult) {
      setShowEndpointDetails(true);
    }
  }, [parseResult]);

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
      notify('success', `Parsed ${data.csm.name || 'spec'} (${data.csm.endpoints.length} endpoints)`);
      updateStepStatus({ parse: 'completed' });
    } catch (error) {
      console.error('Upload error:', error);
      showAlert('Failed to parse spec');
      notify('error', 'Failed to parse specification');
      updateStepStatus({ parse: 'pending' });
    } finally {
      setIsUploading(false);
    }
  };

  const handleGenerateConnector = async (endpointId: string) => {
    if (!parseResult) return;

    const endpointMeta = parseResult.csm.endpoints.find((endpoint) => endpoint.id === endpointId) || null;

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
      notify('success', `Generated connector for ${endpointMeta?.path || endpointId}`);
    } catch (error) {
      console.error('Generation error:', error);
      showAlert('Failed to generate connector');
      notify('error', 'Failed to generate connector');
      updateStepStatus({ generate: 'pending' });
    }
  };

  const handleVerifyConnector = async (endpointId: string) => {
    const connector = connectors.get(endpointId);
    if (!connector) {
      notify('error', 'Connector not found for verification');
      return;
    }

    const endpointMeta = connector.metadata || parseResult?.csm.endpoints.find((e) => e.id === endpointId) || null;

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
        notify('success', `Connector verified: ${endpointMeta?.path || endpointId}`);
        updateStepStatus({ verify: 'completed', install: 'pending' });
      } else {
        showAlert(`Verification failed: ${data.error || 'Unknown error'}`);
        notify('error', `Verification failed: ${data.error || 'Unknown error'}`);
        updateStepStatus({ verify: 'pending' });
      }
    } catch (error) {
      console.error('Verification error:', error);
      showAlert('Failed to verify connector');
      notify('error', 'Failed to verify connector');
      updateStepStatus({ verify: 'pending' });
    }
  };

  const handleInstallConnector = async (endpointId: string) => {
    const connector = connectors.get(endpointId);
    if (!connector || !connector.verified) {
      showAlert('Please verify connector before installing');
      notify('error', 'Verify connector before installing');
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
        notify('success', `Connector installed as ${data.toolId}`);
        setConnectors((prev: Map<string, ConnectorEntry>) => {
          const next = new Map(prev);
          const current = next.get(endpointId);
          if (current) {
            next.set(endpointId, { ...current, installed: true, installedToolId: data.toolId });
          }
          return next;
        });
        updateStepStatus({ install: 'completed', deploy: 'pending' });
      } else {
        showAlert(`Installation failed: ${data.error || 'Unknown error'}`);
        notify('error', `Installation failed: ${data.error || 'Unknown error'}`);
        updateStepStatus({ install: 'pending' });
      }
    } catch (error) {
      console.error('Installation error:', error);
      showAlert('Failed to install connector');
      notify('error', 'Failed to install connector');
      updateStepStatus({ install: 'pending' });
    }
  };

  const handleCopyDeployCommand = async (toolId: string) => {
    try {
      await navigator.clipboard.writeText(`wrangler deploy --name ${toolId}`);
      notify('success', `Copied "wrangler deploy --name ${toolId}" to clipboard`);
    } catch (error) {
      console.error('Copy deploy command failed', error);
      notify('error', 'Unable to copy deploy command');
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
        notify('success', `Template installed: ${data.template.name}`);
      } else {
        showAlert(`Template installation failed: ${data.error || 'Unknown error'}`);
        notify('error', `Template installation failed: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Template install error:', error);
      showAlert('Failed to install template connector');
      notify('error', 'Failed to install template connector');
    }
  };

  const stepLabels: Record<StepKey, { label: string; description: string; help: string }> = {
    parse: {
      label: 'Parse',
      description: 'Normalize the uploaded specification.',
      help: 'Uploads your file and converts it into the Common Spec Model stored for this session.',
    },
    generate: {
      label: 'Generate',
      description: 'Create connector code using Workers AI.',
      help: 'Runs Workers AI with your prompts to produce connector code for the chosen endpoint.',
    },
    verify: {
      label: 'Verify',
      description: 'Ensure exports are callable.',
      help: 'Executes smoke tests to confirm the generated exports run inside a Worker environment.',
    },
    install: {
      label: 'Install',
      description: 'Store connector in the Tool Registry.',
      help: 'Saves the connector into the Tool Registry Durable Object so other flows can invoke it.',
    },
    deploy: {
      label: 'Deploy',
      description: 'Publish the Worker to Cloudflare (manual).',
      help: 'Use Wrangler to deploy the worker with your installed connectors to your Cloudflare account.',
    },
  };

  const stepIndicator = (step: StepKey) => {
    const state = stepStatus[step];
    if (state === 'completed') return 'bg-green-500';
    if (state === 'in-progress') return 'bg-orange-500';
    return 'bg-slate-300';
  };

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

  const handleSandboxSubmit = async (event: FormEvent<HTMLFormElement>) => {
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
      <div className="max-w-7xl mx-auto px-6 py-8 pb-16 space-y-10">
        <header className="space-y-5 text-center sm:text-left">
          <div className="space-y-3">
            <p className="text-sm uppercase tracking-wider text-slate-500 font-semibold">Workflow</p>
            <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 leading-tight">
              Build connectors end-to-end
            </h1>
            <p className="text-lg text-slate-600 max-w-3xl mx-auto sm:mx-0 leading-relaxed">
              Upload specs, verify generated connectors, and install them into the Tool Registry. Use
              the Insights page for analytics, advanced prompts, realtime logs, and chat assistance.
            </p>
          </div>
          <div className="flex flex-wrap justify-center sm:justify-start items-center gap-3 pt-2">
            <button
              onClick={() => {
                const el = document.getElementById('template-gallery');
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="btn-secondary"
            >
              Browse Template Connectors
            </button>
            <button
              type="button"
              onClick={() => onNavigate('insights')}
              className="btn-secondary"
            >
              Insights & Settings
            </button>
          </div>
        </header>

        {statusMessage && (
          <div
            role="status"
            className={`border rounded-lg px-4 py-3 text-sm flex items-start justify-between ${statusMessage.type === 'success'
                ? 'bg-green-50 border-green-200 text-green-800'
                : statusMessage.type === 'error'
                  ? 'bg-red-50 border-red-200 text-red-800'
                  : 'bg-slate-100 border-slate-200 text-slate-700'
              }`}
          >
            <span className="pr-4">{statusMessage.text}</span>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              className="text-xs font-medium underline"
            >
              Dismiss
            </button>
          </div>
        )}

        <section className="card p-4 md:p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Workflow Progress</h2>
            <span className="text-xs text-slate-500">Session ID: {sessionId}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {stepOrder.map((step) => {
              const { label, description, help } = stepLabels[step];
              const tooltipId = `step-tooltip-${step}`;
              return (
                <div key={step} className="flex items-start gap-3">
                  <div className={`mt-1 h-3 w-3 rounded-full ${stepIndicator(step)}`}></div>
                  <div className="text-left space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">{label}</p>
                      <span className="relative group">
                        <button
                          type="button"
                          aria-describedby={tooltipId}
                          className="w-5 h-5 text-[10px] font-semibold text-slate-500 border border-slate-300 rounded-full flex items-center justify-center hover:text-slate-900 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-cloudflare-orange"
                        >
                          ?
                        </button>
                        <span
                          id={tooltipId}
                          role="tooltip"
                          className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-56 -translate-x-1/2 rounded-md bg-slate-900 px-3 py-2 text-xs text-white opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
                        >
                          {help}
                        </span>
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">{description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="grid gap-6 items-start xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <section className="card p-6">
              <h2 className="text-2xl font-semibold mb-4 text-slate-900">Upload Specification</h2>
              <DropZone onFileSelect={handleFileSelect} isUploading={isUploading} />
              <p className="text-xs text-slate-500 mt-4">
                Tip: edit parsing and generation prompts from the{' '}
                <button
                  type="button"
                  onClick={() => onNavigate('insights')}
                  className="text-slate-700 underline decoration-dashed"
                >
                  Insights & Settings
                </button>{' '}
                page before uploading.
              </p>
            </section>

            <section id="template-gallery" className="card p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-slate-900">Template Connectors</h2>
                  <p className="text-sm text-slate-600">
                    Install a ready-made connector to step through the pipeline without a custom spec.
                  </p>
                </div>
                <button onClick={fetchTemplates} className="text-xs text-slate-500 hover:text-slate-900">
                  Refresh
                </button>
              </div>
              {templateError && <p className="text-sm text-red-500 mt-4">{templateError}</p>}
              {isLoadingTemplates ? (
                <p className="text-sm text-slate-500 mt-4">Loading templates…</p>
              ) : (
                <div className="space-y-3 mt-4 max-h-72 overflow-y-auto pr-1">
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

          </div>

          <div className="space-y-6">
            {parseResult ? (
              <>
                <section className="card p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-semibold text-slate-900">Parsed Specification</h2>
                      <p className="text-sm text-slate-500">Normalized summary of the uploaded spec.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowEndpointDetails((prev) => !prev)}
                      className="text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-300 px-3 py-2 rounded"
                    >
                      {showEndpointDetails ? 'Hide endpoints' : 'View endpoints'}
                    </button>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                    <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Name</p>
                      <p className="text-slate-900 font-semibold break-words">{parseResult.csm.name}</p>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Format</p>
                      <p className="text-cloudflare-orange font-semibold">{parseResult.format}</p>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Endpoints</p>
                      <p className="text-slate-900 font-semibold">{parseResult.csm.endpoints.length}</p>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Version</p>
                      <p className="text-slate-900 font-semibold">
                        {parseResult.csm.version || 'n/a'}
                      </p>
                    </div>
                  </div>

                  {parseResult.warnings.length > 0 && (
                    <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded">
                      <p className="text-yellow-500 text-sm font-medium mb-1">Warnings</p>
                      <ul className="text-yellow-600 text-xs space-y-1 list-disc list-inside">
                        {parseResult.warnings.map((warning, idx) => (
                          <li key={idx}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>

                {showEndpointDetails && (
                  <section className="card p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-medium text-slate-900">Available Endpoints</h3>
                      <span className="text-xs text-slate-500">
                        {parseResult.csm.endpoints.length} endpoint
                        {parseResult.csm.endpoints.length === 1 ? '' : 's'}
                      </span>
                    </div>
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
                  </section>
                )}
              </>
            ) : (
              <section className="card p-6 text-sm text-slate-600">
                <h2 className="text-2xl font-semibold text-slate-900 mb-2">Parsed Specification</h2>
                <p>No specification has been parsed yet. Upload a spec to see a normalized summary here.</p>
              </section>
            )}

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
                        {connector.installed && (
                          <div className="mt-3 flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleCopyDeployCommand(connector.installedToolId || endpointId)}
                              className="text-xs font-medium text-slate-600 hover:text-slate-900 underline"
                            >
                              Copy Wrangler deploy command
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>

          <div className="flex flex-col gap-6">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold text-slate-900">Workflow Console</h2>
                <span className="text-xs text-slate-500">Live logs for this session</span>
              </div>
              <ConsoleLog sessionId={sessionId} />
            </section>
            <ChatInterface sessionId={sessionId} persona={persona} onPersonaChange={setPersona} />
          </div>
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

    </>
  );
}
