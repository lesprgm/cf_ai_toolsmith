import { useMemo, useState } from 'react';
import SpecVisualEditor from '../components/SpecVisualEditor';
import ConnectorDetailModal from '../components/ConnectorDetailModal';
import { useWorkflow } from '../context/WorkflowContext';
import { usePromptSettings } from '../hooks/usePromptSettings';
import { useSession } from '../context/SessionContext';
import type { ConnectorEntry, TemplateConnector } from '../types/workflow';

type AppView = 'workflow' | 'editor' | 'monitoring' | 'chat' | 'insights';

interface DetailState {
  id: string;
  title: string;
  source: 'generated' | 'template';
  connector?: ConnectorEntry;
  template?: TemplateConnector;
}

const API_BASE =
  (import.meta.env.VITE_WORKER_BASE_URL as string | undefined)?.replace(/\/$/, '') || '';

const showAlert = (message: string) => window.alert(message);

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export default function EditorPage({
  onNavigate,
}: {
  onNavigate: (view: AppView) => void;
}): JSX.Element {
  const { sessionId } = useSession();
  const { promptSettings } = usePromptSettings();
  const { parseResult, connectors, generateConnector } = useWorkflow();

  const [statusMessage, setStatusMessage] = useState<{
    type: 'info' | 'success' | 'error';
    text: string;
  } | null>(null);
  const [detailState, setDetailState] = useState<DetailState | null>(null);

  const endpoints = useMemo(() => {
    if (!parseResult) return [];
    return parseResult.csm.endpoints.map((endpoint) => ({
      id: endpoint.id,
      method: endpoint.method,
      path: endpoint.path,
      description: endpoint.description,
    }));
  }, [parseResult]);

  const connectorNodes = useMemo(() => {
    return Array.from(connectors.entries()).map(([endpointId, connector]) => {
      const endpoint =
        parseResult?.csm.endpoints.find((candidate) => candidate.id === endpointId) || null;
      return {
        endpointId,
        name: endpoint?.path || endpointId,
        verified: connector.verified,
        installed: connector.installed,
      };
    });
  }, [connectors, parseResult]);

  const handleGenerate = async (endpointId: string) => {
    try {
      await generateConnector(endpointId, {
        customPrompt: promptSettings.generatePrompt.trim() || undefined,
        customSystemPrompt: promptSettings.generateSystemPrompt.trim() || undefined,
      });
      const endpoint =
        parseResult?.csm.endpoints.find((candidate) => candidate.id === endpointId) || null;
      setStatusMessage({
        type: 'success',
        text: `Generated connector for ${endpoint?.path || endpointId}`,
      });
    } catch (error) {
      console.error('Visual editor generate failed', error);
      const message = getErrorMessage(error, 'Failed to generate connector');
      setStatusMessage({ type: 'error', text: message });
      showAlert(message);
    }
  };

  const handleOpenDetail = (endpointId: string) => {
    const connector = connectors.get(endpointId);
    const endpoint =
      parseResult?.csm.endpoints.find((candidate) => candidate.id === endpointId) || null;

    setDetailState({
      id: endpointId,
      title: endpoint?.path || endpointId,
      source: 'generated',
      connector,
    });
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 pb-16 space-y-8">
      <header className="space-y-4 text-center sm:text-left">
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-wider text-slate-500 font-semibold">
            Visual Editor
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 leading-tight">
            Diagram the Common Spec Model
          </h1>
          <p className="text-lg text-slate-600 max-w-3xl mx-auto sm:mx-0 leading-relaxed">
            Drag endpoints from your parsed specification, generate connectors with Workers AI, and
            inspect the relationships to installed tools. Use the workflow page to upload new specs
            or the monitoring page to manage smoke scenarios.
          </p>
        </div>
        <div className="flex flex-wrap justify-center sm:justify-start items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => onNavigate('workflow')}
            className="btn-secondary"
          >
            Back to Workflow
          </button>
          <button
            type="button"
            onClick={() => onNavigate('monitoring')}
            className="btn-secondary"
          >
            Monitoring & Scenarios
          </button>
        </div>
      </header>

      {statusMessage && (
        <div
          role="status"
          className={`border rounded-lg px-4 py-3 text-sm flex items-start justify-between ${
            statusMessage.type === 'success'
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

      {!parseResult ? (
        <section className="card p-8 text-center space-y-4">
          <h2 className="text-2xl font-semibold text-slate-900">No specification loaded yet</h2>
          <p className="text-sm text-slate-600">
            Parse a specification from the Workflow page to populate the visual editor. Once parsed,
            endpoints and generated connectors appear here automatically.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('workflow')}
            className="btn-primary px-6 py-3 text-sm"
          >
            Go to Workflow
          </button>
        </section>
      ) : (
        <SpecVisualEditor
          endpoints={endpoints}
          connectors={connectorNodes}
          onGenerate={handleGenerate}
          onOpenDetail={handleOpenDetail}
        />
      )}

      <ConnectorDetailModal
        detail={
          detailState
            ? {
                ...detailState,
                connector: detailState.connector,
              }
            : null
        }
        sessionId={sessionId}
        apiBase={API_BASE}
        onClose={() => setDetailState(null)}
      />
    </div>
  );
}
