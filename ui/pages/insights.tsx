import { useEffect, useMemo, useState } from 'react';
import { usePromptSettings } from '../hooks/usePromptSettings';

const API_BASE =
  (import.meta.env.VITE_WORKER_BASE_URL as string | undefined)?.replace(/\/$/, '') || '';

interface AnalyticsEvent {
  id: string;
  type: string;
  timestamp: string;
  details?: Record<string, any>;
}

interface AnalyticsResponse {
  events?: AnalyticsEvent[];
}

export default function InsightsPage({
  onNavigate,
}: {
  onNavigate: (view: 'workflow' | 'insights') => void;
}): JSX.Element {
  const { promptSettings, updatePromptSettings, restorePromptSettings } = usePromptSettings();
  const [analyticsEvents, setAnalyticsEvents] = useState<AnalyticsEvent[]>([]);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);

  const fetchAnalytics = async () => {
    setIsLoadingAnalytics(true);
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
    } finally {
      setIsLoadingAnalytics(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
    const interval = window.setInterval(fetchAnalytics, 20000);
    return () => window.clearInterval(interval);
  }, []);

  const analyticsSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    analyticsEvents.forEach((event) => {
      counts[event.type] = (counts[event.type] || 0) + 1;
    });
    return counts;
  }, [analyticsEvents]);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 pb-16 space-y-10">
      <header className="space-y-3">
        <p className="text-sm uppercase tracking-wider text-slate-500 font-semibold">Insights</p>
        <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 leading-tight">Usage & Tuning</h1>
        <p className="text-lg text-slate-600 max-w-3xl leading-relaxed">
          Monitor connector activity and adjust advanced prompts without cluttering the main workflow.
        </p>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Usage Analytics</h2>
              <p className="text-sm text-slate-500">Events tracked across the ToolSmith pipeline.</p>
            </div>
            <button
              onClick={fetchAnalytics}
              className="text-xs text-slate-500 hover:text-slate-900"
              disabled={isLoadingAnalytics}
            >
              {isLoadingAnalytics ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {analyticsError ? (
            <p className="text-sm text-red-500">{analyticsError}</p>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 text-sm">
                {['parse', 'generate', 'verify', 'install', 'template-install', 'test'].map((type) => (
                  <div
                    key={type}
                    className="border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 flex flex-col"
                  >
                    <p className="font-semibold text-slate-800 capitalize">{type.replace('-', ' ')}</p>
                    <p className="text-slate-500 text-xs">{analyticsSummary[type] || 0} events</p>
                  </div>
                ))}
              </div>
              {analyticsEvents.length > 0 ? (
                <div className="space-y-2 text-xs text-slate-500">
                  <p>
                    Last event:{' '}
                    {new Date(analyticsEvents[analyticsEvents.length - 1].timestamp).toLocaleString()}{' '}
                    — {analyticsEvents[analyticsEvents.length - 1].type}
                  </p>
                  <div className="max-h-40 overflow-y-auto border border-slate-200 bg-white rounded p-2">
                    <ul className="space-y-1">
                      {analyticsEvents
                        .slice()
                        .reverse()
                        .map((event) => (
                          <li key={event.id}>
                            <span className="font-medium text-slate-700">{event.type}</span> ·{' '}
                            {new Date(event.timestamp).toLocaleTimeString()}
                          </li>
                        ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500">No analytics events recorded yet.</p>
              )}
            </div>
          )}
        </div>

        <div className="card p-6 space-y-4">
          <h2 className="text-xl font-semibold text-slate-900">Advanced Prompt Settings</h2>
          <p className="text-sm text-slate-500">
            Adjust custom prompts used during parsing and generation. Changes persist and are applied
            automatically in the workflow when uploading new specs.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase block mb-1">
                Custom Parse Prompt
              </label>
              <textarea
                value={promptSettings.parsePrompt}
                onChange={(e) => updatePromptSettings({ parsePrompt: e.target.value })}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm min-h-[120px]"
                placeholder="Override the instructions used when inferring a spec from natural language."
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase block mb-1">
                Parse System Prompt
              </label>
              <textarea
                value={promptSettings.parseSystemPrompt}
                onChange={(e) => updatePromptSettings({ parseSystemPrompt: e.target.value })}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm min-h-[120px]"
                placeholder="System instructions for the parsing LLM."
              />
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase block mb-1">
                Custom Generate Prompt
              </label>
              <textarea
                value={promptSettings.generatePrompt}
                onChange={(e) => updatePromptSettings({ generatePrompt: e.target.value })}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm min-h-[120px]"
                placeholder="Override the code generation instructions."
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase block mb-1">
                Generate System Prompt
              </label>
              <textarea
                value={promptSettings.generateSystemPrompt}
                onChange={(e) => updatePromptSettings({ generateSystemPrompt: e.target.value })}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm min-h-[120px]"
                placeholder="System instructions for the code generation LLM."
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <button onClick={restorePromptSettings} className="text-sm text-slate-600 hover:text-slate-900">
              Restore Defaults
            </button>
            <p className="text-xs text-slate-500">Prompts auto-save locally.</p>
          </div>
        </div>
      </section>

      <div className="card p-6 bg-slate-50 border border-dashed border-slate-300 text-sm text-slate-600">
        Live workflow console output and the AI assistant now reside on the Workflow view so you can
        iterate on connectors and get guidance side by side.
      </div>
      <div className="text-center">
        <button
          type="button"
          onClick={() => onNavigate('workflow')}
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          ← Back to workflow
        </button>
      </div>
    </div>
  );
}
