interface ScenarioRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: any;
}

interface SandboxScenario {
  id: string;
  name: string;
  description?: string;
  endpointId?: string;
  request: ScenarioRequest;
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

interface ScenarioRunResult {
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

interface ScenarioSuiteProps {
  scenarios: SandboxScenario[];
  isLoading: boolean;
  error: string | null;
  runningScenarios: string[];
  isRunningSuite: boolean;
  onRunScenario: (scenarioId: string) => void;
  onRunSuite: () => void;
  onDeleteScenario: (scenarioId: string) => void;
  onRefresh: () => void;
  latestResults: ScenarioRunResult[];
}

function formatInterval(minutes?: number | null): string {
  if (!minutes || minutes <= 0) {
    return 'Manual';
  }
  if (minutes % 1440 === 0) {
    const days = Math.round(minutes / 1440);
    return days === 1 ? 'Daily' : `Every ${days} days`;
  }
  if (minutes % 60 === 0) {
    const hours = Math.round(minutes / 60);
    return hours === 1 ? 'Hourly' : `Every ${hours} hours`;
  }
  return `Every ${minutes} min`;
}

function formatTimestamp(value?: string): string {
  if (!value) {
    return '—';
  }
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '—';
    }
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  } catch {
    return '—';
  }
}

function formatStatus(status?: number, error?: string): string {
  if (typeof status === 'number') {
    return `Status ${status}`;
  }
  if (error) {
    return error;
  }
  return 'Not run yet';
}

export default function ScenarioSuite({
  scenarios,
  isLoading,
  error,
  runningScenarios,
  isRunningSuite,
  onRunScenario,
  onRunSuite,
  onDeleteScenario,
  onRefresh,
  latestResults,
}: ScenarioSuiteProps): JSX.Element {
  const runningSet = new Set(runningScenarios);
  const hasScenarios = scenarios.length > 0;

  return (
    <section className="card p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Scenario Testing Suite</h2>
          <p className="text-xs text-slate-500">
            Save sandbox requests, replay them, and monitor smoke results. Ask chat to &ldquo;Rerun
            smoke suite&rdquo; for remote execution.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="text-xs text-slate-500 hover:text-slate-900 underline"
          >
            Refresh
          </button>
          <button
            type="button"
            className="btn-primary text-xs px-3 py-2 disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={onRunSuite}
            disabled={isRunningSuite || !hasScenarios}
          >
            {isRunningSuite ? 'Running suite…' : 'Run smoke suite'}
          </button>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading scenarios…</p>
      ) : hasScenarios ? (
        <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
          {scenarios.map((scenario) => (
            <div key={scenario.id} className="border border-slate-200 rounded-lg bg-white p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{scenario.name}</p>
                  {scenario.description && (
                    <p className="text-xs text-slate-500">{scenario.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-full font-medium">
                    {formatInterval(scenario.intervalMinutes)}
                  </span>
                  {typeof scenario.lastDurationMs === 'number' && (
                    <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-full font-medium">
                      {scenario.lastDurationMs} ms
                    </span>
                  )}
                </div>
              </div>
              <div className="text-xs font-mono text-slate-700 break-words">
                {scenario.request.method} {scenario.request.url}
              </div>
              <div className="text-xs text-slate-500">
                Last run: {formatTimestamp(scenario.lastRunAt)} · {formatStatus(scenario.lastStatus, scenario.lastError)}
              </div>
              {scenario.lastBodyPreview && (
                <pre className="bg-slate-900 text-slate-100 text-[11px] rounded p-2 max-h-32 overflow-auto">
                  {scenario.lastBodyPreview}
                </pre>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onRunScenario(scenario.id)}
                  className="btn-secondary text-xs px-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={runningSet.has(scenario.id)}
                >
                  {runningSet.has(scenario.id) ? 'Running…' : 'Run now'}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteScenario(scenario.id)}
                  className="text-xs text-red-500 hover:text-red-600 underline"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">Save a sandbox request to create your first scenario.</p>
      )}

      {latestResults.length > 0 && (
        <div className="border-t border-slate-200 pt-3 space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
            Latest execution
          </h3>
          <ul className="space-y-2 text-xs text-slate-600">
            {latestResults.map((result) => (
              <li key={result.id} className="border border-slate-200 rounded px-3 py-2 bg-slate-50">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">{result.name}</span>
                  <span
                    className={`text-[11px] px-2 py-1 rounded-full font-medium ${
                      result.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                    }`}
                  >
                    {result.success ? 'Passed' : 'Failed'}
                  </span>
                </div>
                <div className="mt-1 text-slate-500">
                  {formatStatus(result.status, result.error)} · Ran at {formatTimestamp(result.ranAt)}
                </div>
                {result.preview && (
                  <pre className="mt-2 bg-white border border-slate-200 rounded p-2 max-h-32 overflow-auto">
                    {result.preview}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
