import { useCallback, useEffect, useRef, useState } from 'react';
import DropZone from '../components/DropZone';
import ConnectorDetailModal from '../components/ConnectorDetailModal';
import ModeToggle from '../components/ModeToggle';
import SimpleModeCreator from '../components/SimpleModeCreator';
import WorkflowCreator from '../components/WorkflowCreator';
import { usePromptSettings } from '../hooks/usePromptSettings';
import { useSession } from '../context/SessionContext';
import { useWorkflow } from '../context/WorkflowContext';
import type {
  ConnectorEntry,
  StepKey,
  TemplateConnector,
  TemplateInstallResponse,
} from '../types/workflow';

const API_BASE =
  (import.meta.env.VITE_WORKER_BASE_URL as string | undefined)?.replace(/\/$/, '') || '';

type AppView = 'workflow' | 'monitoring' | 'chat' | 'insights';

const stepOrder: StepKey[] = ['parse', 'generate', 'verify', 'install', 'deploy'];

interface DetailState {
  id: string;
  title: string;
  source: 'generated' | 'template';
  connector?: ConnectorEntry;
  template?: TemplateConnector;
}

const showAlert = (message: string) => window.alert(message);

const getErrorMessage = (error: unknown, fallback = 'Something went wrong') =>
  error instanceof Error ? error.message : fallback;

export default function WorkflowPage({
  onNavigate,
}: {
  onNavigate: (view: AppView) => void;
}): JSX.Element {
  const { sessionId } = useSession();
  const { promptSettings } = usePromptSettings();
  const {
    parseResult,
    connectors,
    isUploading,
    stepStatus,
    parseSpec,
    generateConnector,
    verifyConnector,
    installConnector,
    updateSteps,
  } = useWorkflow();

  const [mode, setMode] = useState<'simple' | 'developer'>('simple');
  const [creationMode, setCreationMode] = useState<'connector' | 'workflow'>('connector');
  const [templates, setTemplates] = useState<TemplateConnector[]>([]);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [isSimpleModeGenerating, setIsSimpleModeGenerating] = useState(false);
  const [isWorkflowGenerating, setIsWorkflowGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'info' | 'success' | 'error';
    text: string;
  } | null>(null);
  const [showEndpointDetails, setShowEndpointDetails] = useState(true);
  const parsedSpecRef = useRef<HTMLDivElement | null>(null);

  const [detailState, setDetailState] = useState<DetailState | null>(null);

  const notify = useCallback((type: 'info' | 'success' | 'error', text: string) => {
    setStatusMessage({ type, text });
  }, []);

  const loadTemplates = useCallback(async () => {
    setIsLoadingTemplates(true);
    setTemplateError(null);
    try {
      const response = await fetch(`${API_BASE}/api/templates`);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data = (await response.json()) as { templates?: TemplateConnector[] };
      setTemplates(data.templates ?? []);
    } catch (error) {
      console.error('Failed to load templates', error);
      setTemplateError('Unable to load templates');
    } finally {
      setIsLoadingTemplates(false);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    if (parseResult && parsedSpecRef.current) {
      setShowEndpointDetails(true);
      requestAnimationFrame(() => {
        parsedSpecRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [parseResult]);

  const handleFileSelect = async (file: File) => {
    try {
      const result = await parseSpec(file, {
        customParsePrompt: promptSettings.parsePrompt.trim() || undefined,
        customParseSystemPrompt: promptSettings.parseSystemPrompt.trim() || undefined,
      });
      notify(
        'success',
        `Parsed ${result.csm.name || 'spec'} (${result.csm.endpoints.length} endpoints)`,
      );
    } catch (error) {
      console.error('Parse failed', error);
      const message = getErrorMessage(error, 'Failed to parse specification');
      showAlert(message);
      notify('error', message);
    }
  };

  const handleGenerateConnector = async (endpointId: string) => {
    if (!parseResult) return;
    const endpointMeta =
      parseResult.csm.endpoints.find((endpoint) => endpoint.id === endpointId) || null;
    try {
      await generateConnector(endpointId, {
        customPrompt: promptSettings.generatePrompt.trim() || undefined,
        customSystemPrompt: promptSettings.generateSystemPrompt.trim() || undefined,
      });
      notify('success', `Generated connector for ${endpointMeta?.path || endpointId}`);
    } catch (error) {
      console.error('Generation error', error);
      const message = getErrorMessage(error, 'Failed to generate connector');
      showAlert(message);
      notify('error', message);
    }
  };

  const handleVerifyConnector = async (endpointId: string) => {
    try {
      const result = await verifyConnector(endpointId);
      if (result.success) {
        notify('success', 'Connector verified successfully');
        showAlert('Connector verified successfully!');
      } else {
        const message = result.error || 'Verification failed';
        notify('error', message);
        showAlert(`Verification failed: ${message}`);
      }
    } catch (error) {
      console.error('Verification error', error);
      const message = getErrorMessage(error, 'Failed to verify connector');
      notify('error', message);
      showAlert(message);
    }
  };

  const handleInstallConnector = async (endpointId: string) => {
    try {
      const result = await installConnector(endpointId);
      if (result.success) {
        notify('success', `Connector installed as ${result.toolId}`);
        showAlert(`Connector installed as ${result.toolId}`);
      } else {
        const message = result.error || 'Installation failed';
        notify('error', message);
        showAlert(`Installation failed: ${message}`);
      }
    } catch (error) {
      console.error('Installation error', error);
      const message = getErrorMessage(error, 'Failed to install connector');
      notify('error', message);
      showAlert(message);
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

      const data = (await response.json()) as TemplateInstallResponse & { error?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Template installation failed');
      }

      updateSteps({
        parse: 'completed',
        generate: 'completed',
        verify: 'completed',
        install: 'completed',
        deploy: 'pending',
      });
      notify('success', `Template installed: ${data.template.name}`);
    } catch (error) {
      console.error('Template install error', error);
      const message = getErrorMessage(error, 'Failed to install template connector');
      notify('error', message);
      showAlert(message);
    }
  };

  const handleSimpleGenerate = async (apiName: string, intent: string) => {
    setIsSimpleModeGenerating(true);
    notify('info', `Analyzing "${apiName}" API and generating spec...`);

    try {
      const response = await fetch(`${API_BASE}/api/simple-create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId,
        },
        body: JSON.stringify({ apiName, intent, sessionId }),
      });

      const data = await response.json() as {
        success: boolean;
        error?: string;
        details?: string[];
        spec?: any;
        analysis?: {
          provider: string;
          category: string;
          endpointCount: number;
          specSource?: string;
          requiresClientSide?: boolean;
          multiStepRequired?: boolean;
          warnings?: string[];
        };
      };

      if (!response.ok || !data.success) {
        const errorMsg = data.error || 'Failed to generate connector';
        const errorDetails = data.details?.length
          ? `\n\nDetails:\n${data.details.map(d => `- ${d}`).join('\n')}`
          : '';
        throw new Error(errorMsg + errorDetails);
      }

      if (!data.spec) {
        throw new Error('No spec returned from server');
      }

      const specJson = JSON.stringify(data.spec, null, 2);
      const blob = new Blob([specJson], { type: 'application/json' });
      const specFile = new File([blob], `${apiName}.json`, { type: 'application/json' });

      await parseSpec(specFile);

      // Show success message
      let successMessage = data.analysis
        ? `Successfully analyzed ${data.analysis.provider}! Found ${data.analysis.endpointCount} relevant endpoints.`
        : `Successfully generated spec for ${apiName}!`;

      if (data.analysis?.specSource === 'ai-generated') {
        successMessage += ' (AI-generated spec)';
      }

      notify('success', successMessage);

      const warnings = data.analysis?.warnings || [];
      if (warnings.length > 0) {
        const warningMessage = 'Important notes:\n' + warnings.map(w => `- ${w}`).join('\n');
        showAlert(warningMessage);
      }

      if (data.analysis?.requiresClientSide) {
        setTimeout(() => {
          showAlert(
            'Note: Your use case requires client-side browser APIs (like Geolocation). ' +
            'The generated connector provides server-side API calls. ' +
            'You may need to combine it with browser APIs in your frontend code.'
          );
        }, 1000);
      }

      if (data.analysis?.multiStepRequired && !data.analysis?.requiresClientSide) {
        setTimeout(() => {
          showAlert(
            'Note: Your use case may require multiple steps or API calls to fully accomplish your goal. ' +
            'Review the generated endpoints and consider chaining them together.'
          );
        }, 1000);
      }

      setMode('developer');
    } catch (error) {
      console.error('Simple mode generation failed:', error);
      const message = getErrorMessage(error, 'Failed to generate connector from natural language');
      notify('error', message);
      showAlert(message);
    } finally {
      setIsSimpleModeGenerating(false);
    }
  };

  const handleWorkflowGenerate = async (description: string) => {
    setIsWorkflowGenerating(true);
    notify('info', `Analyzing workflow and generating code...`);

    try {
      // Step 1: Analyze the workflow
      const analyzeResponse = await fetch(`${API_BASE}/api/workflow/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId,
        },
        body: JSON.stringify({ description }),
      });

      const analyzeData = await analyzeResponse.json() as {
        success: boolean;
        error?: string;
        analysis?: any;
      };

      if (!analyzeResponse.ok || !analyzeData.success || !analyzeData.analysis) {
        throw new Error(analyzeData.error || 'Failed to analyze workflow');
      }

      const analysis = analyzeData.analysis;
      notify('info', `Generating ${analysis.workflowName} with ${analysis.steps.length} steps...`);

      // Step 2: Generate the workflow code
      const generateResponse = await fetch(`${API_BASE}/api/workflow/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId,
        },
        body: JSON.stringify({ description, analysis }),
      });

      const generateData = await generateResponse.json() as {
        success: boolean;
        error?: string;
        code?: string;
        steps?: string[];
        details?: string;
      };

      if (!generateResponse.ok || !generateData.success || !generateData.code) {
        const errorMsg = generateData.error || 'Failed to generate workflow';
        const errorDetails = generateData.details ? `\n\n${generateData.details}` : '';
        throw new Error(errorMsg + errorDetails);
      }

      // Show success message with details
      const successMessage = `Successfully generated workflow "${analysis.workflowName}" with ${generateData.steps?.length || analysis.steps.length} steps!`;
      notify('success', successMessage);

      // Display the generated code
      showAlert(
        `Workflow Generated!\n\n` +
        `Name: ${analysis.workflowName}\n` +
        `Steps: ${generateData.steps?.join(', ')}\n` +
        `Complexity: ${analysis.complexity}\n\n` +
        `The code has been generated and verified. Check the console for the full code.`
      );

      // Log the code to console for now (in a real app, you'd show it in a modal or editor)
      console.log('Generated Workflow Code:', generateData.code);

    } catch (error) {
      console.error('Workflow generation failed:', error);
      const message = getErrorMessage(error, 'Failed to generate workflow');
      notify('error', message);
      showAlert(message);
    } finally {
      setIsWorkflowGenerating(false);
    }
  };

  const openConnectorDetail = (detail: DetailState) => {
    setDetailState(detail);
  };

  return (
    <>
      <div className="max-w-7xl mx-auto px-6 py-8 pb-16 space-y-10">
        <header className="space-y-5 text-center sm:text-left">
          <div className="space-y-3">
            <p className="text-sm uppercase tracking-wider text-slate-500 font-semibold">
              {mode === 'simple' ? 'Quick Start' : 'Workflow'}
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 leading-tight">
              {mode === 'simple' ? 'Generate Code with Natural Language' : 'Build connectors end-to-end'}
            </h1>
            <p className="text-lg text-slate-600 max-w-3xl mx-auto sm:mx-0 leading-relaxed">
              {mode === 'simple'
                ? 'Choose between API Connectors or Cloudflare Workflows. Describe what you need in plain English, and AI will generate production-ready code for you.'
                : 'Upload specs, generate connectors with Workers AI, verify exports, and install them into the Tool Registry. Use the Visual Editor and Monitoring pages for advanced collaboration tools.'}
            </p>
          </div>
          <div className="flex justify-center sm:justify-start">
            <ModeToggle mode={mode} onChange={setMode} />
          </div>
          <div className="flex flex-wrap justify-center sm:justify-start items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => onNavigate('chat')}
              className="btn-secondary"
            >
              AI Chat with Tools
            </button>
            <button
              type="button"
              onClick={() => onNavigate('monitoring')}
              className="btn-secondary"
            >
              Monitoring & Scenarios
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

        {mode === 'simple' ? (
          <>
            {/* Creation Mode Toggle */}
            <div className="flex justify-center mb-6">
              <div className="inline-flex rounded-lg border border-slate-300 p-1 bg-white">
                <button
                  type="button"
                  onClick={() => setCreationMode('connector')}
                  className={`px-6 py-2 rounded-md text-sm font-medium transition-colors ${creationMode === 'connector'
                    ? 'bg-cloudflare-orange text-white'
                    : 'text-slate-600 hover:text-slate-900'
                    }`}
                >
                  API Connectors
                </button>
                <button
                  type="button"
                  onClick={() => setCreationMode('workflow')}
                  className={`px-6 py-2 rounded-md text-sm font-medium transition-colors ${creationMode === 'workflow'
                    ? 'bg-cloudflare-orange text-white'
                    : 'text-slate-600 hover:text-slate-900'
                    }`}
                >
                  Cloudflare Workflows
                </button>
              </div>
            </div>

            {/* Conditional Rendering based on creation mode */}
            {creationMode === 'connector' ? (
              <SimpleModeCreator
                onGenerate={handleSimpleGenerate}
                isGenerating={isSimpleModeGenerating}
              />
            ) : (
              <WorkflowCreator
                onGenerate={handleWorkflowGenerate}
                isGenerating={isWorkflowGenerating}
              />
            )}
          </>
        ) : null}

        {mode === 'developer' && (
          <>
            <section className="card p-4 md:p-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                <h2 className="text-lg font-semibold text-slate-900">Workflow Progress</h2>
                <span className="text-xs text-slate-500">Session ID: {sessionId}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                {stepOrder.map((step) => {
                  const state = stepStatus[step];
                  const indicator =
                    state === 'completed' ? 'bg-green-500' : state === 'in-progress' ? 'bg-orange-500' : 'bg-slate-300';
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
                  const { label, description, help } = stepLabels[step];
                  const tooltipId = `step-tooltip-${step}`;

                  return (
                    <div key={step} className="flex items-start gap-3">
                      <div className={`mt-1 h-3 w-3 rounded-full ${indicator}`}></div>
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

            <div className="grid gap-6 items-start xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1.4fr)]">
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
                    <button
                      onClick={() => void loadTemplates()}
                      className="text-xs text-slate-500 hover:text-slate-900"
                    >
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
                            <span>
                              {template.endpoint.method} {template.endpoint.path}
                            </span>
                            <button
                              className="text-slate-500 hover:text-slate-900"
                              onClick={() =>
                                openConnectorDetail({
                                  id: template.id,
                                  title: template.name,
                                  source: 'template',
                                  template,
                                })
                              }
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
                    <section className="card p-6 space-y-4" ref={parsedSpecRef}>
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
                                  onClick={() =>
                                    openConnectorDetail({
                                      id: endpoint.id,
                                      title: endpoint.path,
                                      source: 'generated',
                                      connector: connectors.get(endpoint.id),
                                    })
                                  }
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
                        const endpoint =
                          connector.metadata ||
                          parseResult?.csm.endpoints.find((e) => e.id === endpointId) ||
                          null;
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
                                onClick={() =>
                                  openConnectorDetail({
                                    id: endpointId,
                                    title: endpoint?.path || endpointId,
                                    source: 'generated',
                                    connector,
                                  })
                                }
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
                                  onClick={() =>
                                    handleCopyDeployCommand(connector.installedToolId || endpointId)
                                  }
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
            </div>
          </>
        )}
      </div>

      <ConnectorDetailModal
        detail={detailState}
        sessionId={sessionId}
        apiBase={API_BASE}
        onClose={() => setDetailState(null)}
      />
    </>
  );
}
