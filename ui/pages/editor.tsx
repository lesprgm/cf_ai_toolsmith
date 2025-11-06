import { useState } from 'react';
import SimpleModeCreator from '../components/SimpleModeCreator';
import { useWorkflow } from '../context/WorkflowContext';
import { useSession } from '../context/SessionContext';

type AppView = 'workflow' | 'editor' | 'monitoring' | 'chat' | 'insights';

const API_BASE =
  ((import.meta as any).env?.VITE_WORKER_BASE_URL as string | undefined)?.replace(/\/$/, '') || '';

export default function EditorPage({
  onNavigate,
}: {
  onNavigate: (view: AppView) => void;
}): JSX.Element {
  const { sessionId } = useSession();
  const { parseSpec } = useWorkflow();

  const [statusMessage, setStatusMessage] = useState<{
    type: 'info' | 'success' | 'error';
    text: string;
  } | null>(null);
  const [isSimpleModeGenerating, setIsSimpleModeGenerating] = useState(false);

  const handleSimpleGenerate = async (apiName: string, intent: string) => {
    setIsSimpleModeGenerating(true);
    setStatusMessage({
      type: 'info',
      text: `Analyzing "${apiName}" API and generating spec...`,
    });

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
        spec?: any;
        analysis?: {
          provider: string;
          category: string;
          endpointCount: number;
        };
      };

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to generate connector');
      }

      if (!data.spec) {
        throw new Error('No spec returned from server');
      }

      const specJson = JSON.stringify(data.spec, null, 2);
      const blob = new Blob([specJson], { type: 'application/json' });
      const specFile = new File([blob], `${apiName}.json`, { type: 'application/json' });

      await parseSpec(specFile);

      const successMessage = data.analysis
        ? `Successfully analyzed ${data.analysis.provider}! Found ${data.analysis.endpointCount} relevant endpoints.`
        : `Successfully generated spec for ${apiName}!`;

      setStatusMessage({
        type: 'success',
        text: successMessage,
      });
    } catch (error) {
      console.error('Simple mode generation failed:', error);
      const message = error instanceof Error ? error.message : 'Failed to generate connector';
      setStatusMessage({ type: 'error', text: message });
      window.alert(message);
    } finally {
      setIsSimpleModeGenerating(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 pb-16 space-y-8">
      <header className="space-y-4 text-center sm:text-left">
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-wider text-slate-500 font-semibold">
            API Connector Builder
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 leading-tight">
            Create API Connector
          </h1>
          <p className="text-lg text-slate-600 max-w-3xl mx-auto sm:mx-0 leading-relaxed">
            Describe what you want to build in plain English. Our AI will find or generate the API specification and create connectors for you automatically.
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

      <SimpleModeCreator
        onGenerate={handleSimpleGenerate}
        isGenerating={isSimpleModeGenerating}
      />
    </div>
  );
}
