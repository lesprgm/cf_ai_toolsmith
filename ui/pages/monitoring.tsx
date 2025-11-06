import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ScenarioSuite from '../components/ScenarioSuite';
import ConsoleLog from '../components/ConsoleLog';
import { useSession } from '../context/SessionContext';
import type { SandboxScenario, ScenarioRunResult } from '../types/workflow';

const API_BASE =
  ((import.meta as any).env?.VITE_WORKER_BASE_URL as string | undefined)?.replace(/\/$/, '') || '';

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export default function MonitoringPage(): JSX.Element {
  const { sessionId } = useSession();

  const [scenarios, setScenarios] = useState<SandboxScenario[]>([]);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [isLoadingScenarios, setIsLoadingScenarios] = useState(false);
  const [runningScenarioIds, setRunningScenarioIds] = useState<string[]>([]);
  const [isRunningSuite, setIsRunningSuite] = useState(false);
  const [latestScenarioResults, setLatestScenarioResults] = useState<ScenarioRunResult[]>([]);
  const scenarioTimersRef = useRef<Map<string, number>>(new Map());
  const [statusMessage, setStatusMessage] = useState<{
    type: 'info' | 'success' | 'error';
    text: string;
  } | null>(null);
  const [scenarioDraft, setScenarioDraft] = useState({
    name: '',
    description: '',
    endpointId: '',
    url: '',
    method: 'GET',
    headers: '',
    body: '',
    intervalMinutes: '',
  });
  const [isSavingScenario, setIsSavingScenario] = useState(false);
  const [scenarioSaveError, setScenarioSaveError] = useState<string | null>(null);

  const notify = useCallback((type: 'info' | 'success' | 'error', text: string) => {
    setStatusMessage({ type, text });
  }, []);

  const loadScenarios = useCallback(async () => {
    setIsLoadingScenarios(true);
    setScenarioError(null);
    try {
      const response = await fetch(`${API_BASE}/api/scenarios`, {
        method: 'GET',
        headers: { 'X-Session-ID': sessionId },
      });
      const data = (await response.json()) as { scenarios?: SandboxScenario[]; error?: string };
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load scenarios');
      }
      setScenarios(Array.isArray(data.scenarios) ? data.scenarios : []);
    } catch (error) {
      console.error('Unable to load scenarios', error);
      setScenarioError(getErrorMessage(error, 'Unable to load scenarios'));
    } finally {
      setIsLoadingScenarios(false);
    }
  }, [sessionId]);

  useEffect(() => {
    loadScenarios();
  }, [loadScenarios]);

  useEffect(() => {
    const timers = scenarioTimersRef.current;
    timers.forEach((timer, id) => {
      const stillActive = scenarios.some(
        (scenario) => scenario.id === id && typeof scenario.intervalMinutes === 'number' && scenario.intervalMinutes > 0,
      );
      if (!stillActive) {
        clearInterval(timer);
        timers.delete(id);
      }
    });

    scenarios.forEach((scenario) => {
      if (typeof scenario.intervalMinutes === 'number' && scenario.intervalMinutes > 0) {
        if (!timers.has(scenario.id)) {
          const intervalMs = scenario.intervalMinutes * 60_000;
          const handle = window.setInterval(() => {
            void runScenario(scenario.id, true);
          }, intervalMs);
          timers.set(scenario.id, handle);
        }
      }
    });

    return () => {
      timers.forEach((timer) => clearInterval(timer));
      timers.clear();
    };
  }, [scenarios]);

  const summarizeScenarioResults = useCallback((results: ScenarioRunResult[]) => {
    if (!results.length) {
      return 'No saved scenarios were available to run.';
    }
    return results
      .map((result) =>
        result.success
          ? `${result.name} passed${typeof result.status === 'number' ? ` (status ${result.status})` : ''}`
          : `${result.name} failed: ${result.error || 'Unknown error'}`,
      )
      .join('; ');
  }, []);

  const runScenario = useCallback(
    async (scenarioId: string, silent = false) => {
      setRunningScenarioIds((previous) => (previous.includes(scenarioId) ? previous : [...previous, scenarioId]));
      try {
        const response = await fetch(`${API_BASE}/api/scenarios/run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-ID': sessionId,
          },
          body: JSON.stringify({ scenarioIds: [scenarioId] }),
        });
        const data = (await response.json()) as { results?: ScenarioRunResult[]; error?: string };
        if (!response.ok) {
          throw new Error(data.error || 'Failed to run scenario');
        }
        const results = Array.isArray(data.results) ? data.results : [];
        setLatestScenarioResults(results);
        await loadScenarios();

        if (!silent) {
          const target = results.find((result) => result.id === scenarioId);
          if (target) {
            if (target.success) {
              notify('success', `Scenario "${target.name}" passed${typeof target.status === 'number' ? ` (status ${target.status})` : ''}`);
            } else {
              notify('error', `Scenario "${target.name}" failed: ${target.error || 'Unknown error'}`);
            }
          } else {
            notify('info', 'Scenario run completed.');
          }
        }
      } catch (error) {
        if (!silent) {
          const message = getErrorMessage(error, 'Scenario run failed');
          notify('error', message);
        }
      } finally {
        setRunningScenarioIds((previous) => previous.filter((id) => id !== scenarioId));
      }
    },
    [loadScenarios, notify, sessionId],
  );

  const runScenarioSuite = useCallback(async () => {
    setIsRunningSuite(true);
    try {
      const response = await fetch(`${API_BASE}/api/scenarios/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId,
        },
        body: JSON.stringify({}),
      });
      const data = (await response.json()) as { results?: ScenarioRunResult[]; error?: string };
      if (!response.ok) {
        throw new Error(data.error || 'Failed to run smoke suite');
      }
      const results = Array.isArray(data.results) ? data.results : [];
      setLatestScenarioResults(results);
      await loadScenarios();
      notify(results.every((result) => result.success) ? 'success' : 'info', summarizeScenarioResults(results));
    } catch (error) {
      const message = getErrorMessage(error, 'Smoke suite failed');
      notify('error', message);
    } finally {
      setIsRunningSuite(false);
    }
  }, [loadScenarios, notify, sessionId, summarizeScenarioResults]);

  const handleDeleteScenario = useCallback(
    async (scenarioId: string) => {
      try {
        const response = await fetch(`${API_BASE}/api/scenarios/${scenarioId}`, {
          method: 'DELETE',
          headers: { 'X-Session-ID': sessionId },
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(data.error || 'Failed to delete scenario');
        }
        notify('info', 'Scenario removed');
        await loadScenarios();
      } catch (error) {
        notify('error', getErrorMessage(error, 'Unable to delete scenario'));
      }
    },
    [loadScenarios, notify, sessionId],
  );

  const autoRunsEnabled = useMemo(
    () => scenarios.some((scenario) => typeof scenario.intervalMinutes === 'number' && scenario.intervalMinutes > 0),
    [scenarios],
  );

  const handleCreateScenario = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!scenarioDraft.url.trim()) {
        setScenarioSaveError('Request URL is required.');
        return;
      }

      let parsedHeaders: Record<string, string> = {};
      if (scenarioDraft.headers.trim()) {
        try {
          const candidate = JSON.parse(scenarioDraft.headers);
          Object.entries(candidate).forEach(([key, value]) => {
            if (typeof value === 'string') {
              parsedHeaders[key] = value;
            }
          });
        } catch (error) {
          setScenarioSaveError('Headers must be a valid JSON object.');
          return;
        }
      }

      let requestBody: any;
      if (scenarioDraft.body.trim()) {
        try {
          requestBody = JSON.parse(scenarioDraft.body);
        } catch (error) {
          requestBody = scenarioDraft.body;
        }
      }

      let intervalMinutes: number | undefined;
      if (scenarioDraft.intervalMinutes.trim()) {
        const parsed = Number.parseInt(scenarioDraft.intervalMinutes, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          setScenarioSaveError('Interval must be a positive number of minutes.');
          return;
        }
        intervalMinutes = parsed;
      }

      setIsSavingScenario(true);
      setScenarioSaveError(null);

      try {
        const response = await fetch(`${API_BASE}/api/scenarios`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-ID': sessionId,
          },
          body: JSON.stringify({
            name: scenarioDraft.name.trim() || `Smoke: ${scenarioDraft.method} ${scenarioDraft.url}`,
            description: scenarioDraft.description.trim() || undefined,
            endpointId: scenarioDraft.endpointId.trim() || undefined,
            intervalMinutes,
            request: {
              url: scenarioDraft.url.trim(),
              method: scenarioDraft.method.trim() || 'GET',
              headers: parsedHeaders,
              body: requestBody,
            },
          }),
        });

        const data = (await response.json()) as { scenario?: SandboxScenario; error?: string };
        if (!response.ok) {
          throw new Error(data.error || 'Failed to save scenario');
        }

        notify('success', `Scenario saved: ${data.scenario?.name || 'New scenario'}`);
        setScenarioDraft({
          name: '',
          description: '',
          endpointId: '',
          url: '',
          method: 'GET',
          headers: '',
          body: '',
          intervalMinutes: '',
        });
        await loadScenarios();
      } catch (error) {
        const message = getErrorMessage(error, 'Unable to save scenario');
        setScenarioSaveError(message);
        notify('error', message);
      } finally {
        setIsSavingScenario(false);
      }
    },
    [loadScenarios, notify, scenarioDraft, sessionId],
  );

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 pb-16 space-y-8">
      <header className="space-y-4 text-center sm:text-left">
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-wider text-slate-500 font-semibold">
            Monitoring
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 leading-tight">
            Observe logs & smoke scenarios
          </h1>
          <p className="text-lg text-slate-600 max-w-3xl mx-auto sm:mx-0 leading-relaxed">
            Replay saved sandbox requests, schedule recurring smoke tests, and monitor live logs.
            Create new scenarios from the Workflow page by opening a connector detail panel.
          </p>
        </div>
        <div className="flex flex-wrap justify-center sm:justify-start items-center gap-3 pt-2">
          <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="btn-secondary">
            Back to top
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

      <section className="card p-6 space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Create Scenario</h2>
          <p className="text-sm text-slate-600">
            Capture a smoke test from any connector. Optional fields let you associate the scenario
            with a specific endpoint ID and schedule automatic replays.
          </p>
        </div>
        <form onSubmit={handleCreateScenario} className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="scenario-name" className="text-xs font-semibold text-slate-600 uppercase block">Scenario name</label>
            <input
              id="scenario-name"
              type="text"
              value={scenarioDraft.name}
              onChange={(event) => setScenarioDraft((prev) => ({ ...prev, name: event.target.value }))}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
              placeholder="Smoke: GET /users"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="scenario-endpoint-id" className="text-xs font-semibold text-slate-600 uppercase block">Endpoint ID (optional)</label>
            <input
              id="scenario-endpoint-id"
              type="text"
              value={scenarioDraft.endpointId}
              onChange={(event) => setScenarioDraft((prev) => ({ ...prev, endpointId: event.target.value }))}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
              placeholder="match parsed endpoint id"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label htmlFor="scenario-description" className="text-xs font-semibold text-slate-600 uppercase block">Description</label>
            <textarea
              id="scenario-description"
              value={scenarioDraft.description}
              onChange={(event) => setScenarioDraft((prev) => ({ ...prev, description: event.target.value }))}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm min-h-[60px]"
              placeholder="Documents the expected behaviour for this smoke test"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="scenario-url" className="text-xs font-semibold text-slate-600 uppercase block">Request URL</label>
            <input
              id="scenario-url"
              type="text"
              value={scenarioDraft.url}
              onChange={(event) => setScenarioDraft((prev) => ({ ...prev, url: event.target.value }))}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
              placeholder="https://api.example.com/resource"
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="scenario-method" className="text-xs font-semibold text-slate-600 uppercase block">Method</label>
            <input
              id="scenario-method"
              type="text"
              value={scenarioDraft.method}
              onChange={(event) => setScenarioDraft((prev) => ({ ...prev, method: event.target.value }))}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="scenario-headers" className="text-xs font-semibold text-slate-600 uppercase block">Headers (JSON)</label>
            <textarea
              id="scenario-headers"
              value={scenarioDraft.headers}
              onChange={(event) => setScenarioDraft((prev) => ({ ...prev, headers: event.target.value }))}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm min-h-[80px]"
              placeholder='{"Authorization": "Bearer ..."}'
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="scenario-body" className="text-xs font-semibold text-slate-600 uppercase block">Body (JSON or string)</label>
            <textarea
              id="scenario-body"
              value={scenarioDraft.body}
              onChange={(event) => setScenarioDraft((prev) => ({ ...prev, body: event.target.value }))}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm min-h-[80px]"
              placeholder='{"name": "demo"}'
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="scenario-interval" className="text-xs font-semibold text-slate-600 uppercase block">Auto-run cadence (minutes)</label>
            <input
              id="scenario-interval"
              type="number"
              min={1}
              value={scenarioDraft.intervalMinutes}
              onChange={(event) => setScenarioDraft((prev) => ({ ...prev, intervalMinutes: event.target.value }))}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
              placeholder="Leave blank for manual"
            />
          </div>
          <div className="md:col-span-2 flex items-center justify-between">
            <span className="text-xs text-slate-500">Saved scenarios appear below and can be triggered from chat with “rerun smoke suite”.</span>
            <button
              type="submit"
              className="btn-primary text-sm px-4 py-2 disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={isSavingScenario}
            >
              {isSavingScenario ? 'Saving…' : 'Save scenario'}
            </button>
          </div>
        </form>
        {scenarioSaveError && <p className="text-xs text-red-500">{scenarioSaveError}</p>}
      </section>

      <section className="card p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Scenario Suite</h2>
            <p className="text-sm text-slate-600">
              Saved sandbox requests are replayed from the Worker environment. Auto-run cadence: {autoRunsEnabled ? 'enabled' : 'manual only'}.
            </p>
          </div>
        </div>

        <ScenarioSuite
          scenarios={scenarios}
          isLoading={isLoadingScenarios}
          error={scenarioError}
          runningScenarios={runningScenarioIds}
          isRunningSuite={isRunningSuite}
          onRunScenario={(id) => void runScenario(id)}
          onRunSuite={() => void runScenarioSuite()}
          onDeleteScenario={(id) => void handleDeleteScenario(id)}
          onRefresh={() => void loadScenarios()}
          latestResults={latestScenarioResults}
        />
      </section>

      <section className="card p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-slate-900">Workflow Console</h2>
          <span className="text-xs text-slate-500">Live logs for this session ({sessionId})</span>
        </div>
        <ConsoleLog sessionId={sessionId} />
      </section>
    </div>
  );
}
