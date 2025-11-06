import { FormEvent, useEffect, useMemo, useState } from 'react';
import APITester from './APITester';
import DeploymentGuide from './DeploymentGuide';
import { FileText, Play, Rocket } from 'lucide-react';
import type {
  ConnectorEntry,
  EndpointMetadata,
  SandboxFormState,
  TemplateConnector,
  TestConnectorResponse,
} from '../types/workflow';

interface DetailState {
  id: string;
  title: string;
  source: 'generated' | 'template';
  connector?: ConnectorEntry;
  template?: TemplateConnector;
}

interface ConnectorDetailModalProps {
  detail: DetailState | null;
  sessionId: string;
  apiBase: string;
  onClose: () => void;
}

export default function ConnectorDetailModal({
  detail,
  sessionId,
  apiBase,
  onClose,
}: ConnectorDetailModalProps): JSX.Element | null {
  const metadata: EndpointMetadata | null = detail
    ? detail.connector?.metadata || detail.template?.endpoint || null
    : null;
  const code =
    detail?.connector?.code || detail?.template?.code || 'No code available.';
  const exportsList = detail?.connector?.exports || detail?.template?.exports || [];

  const [formState, setFormState] = useState<SandboxFormState>({
    url: '',
    method: 'GET',
    headers: '',
    body: '',
  });
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const [sandboxResponse, setSandboxResponse] = useState<TestConnectorResponse | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    if (!detail) return;
    const suggestedBaseUrl =
      (detail.template?.metadata?.baseUrl as string | undefined) ||
      (metadata?.sampleRequest?.baseUrl as string | undefined) ||
      (metadata?.path?.startsWith('http') ? metadata.path : '');
    setFormState({
      url:
        suggestedBaseUrl && metadata?.path && !suggestedBaseUrl.endsWith(metadata.path)
          ? `${suggestedBaseUrl}${metadata.path.startsWith('/') ? metadata.path : `/${metadata.path}`}`
          : suggestedBaseUrl || '',
      method: metadata?.method || 'GET',
      headers: '',
      body: '',
    });
    setSandboxError(null);
    setSandboxResponse(null);
    setIsTesting(false);
  }, [detail, metadata]);

  const fieldIds = useMemo(
    () => ({
      url: `sandbox-url-${sessionId}`,
      method: `sandbox-method-${sessionId}`,
      headers: `sandbox-headers-${sessionId}`,
      body: `sandbox-body-${sessionId}`,
    }),
    [sessionId],
  );

  if (!detail) {
    return null;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!formState.url.trim()) {
      setSandboxError('URL is required for testing.');
      return;
    }

    let parsedHeaders: Record<string, string> = {};
    if (formState.headers.trim()) {
      try {
        const candidate = JSON.parse(formState.headers);
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

    let requestBody: any;
    if (formState.body.trim()) {
      try {
        requestBody = JSON.parse(formState.body);
      } catch (error) {
        requestBody = formState.body;
      }
    }

    setIsTesting(true);
    setSandboxError(null);
    setSandboxResponse(null);

    try {
      const response = await fetch(`${apiBase}/api/test-connector`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId,
        },
        body: JSON.stringify({
          url: formState.url.trim(),
          method: formState.method || 'GET',
          headers: parsedHeaders,
          body: requestBody,
        }),
      });
      const data = (await response.json()) as TestConnectorResponse & { error?: string };
      if (!response.ok) {
        setSandboxError(data.error || 'Request failed');
      } else {
        setSandboxResponse(data);
      }
    } catch (error) {
      console.error('Sandbox test failed', error);
      setSandboxError('Unable to execute test request');
    } finally {
      setIsTesting(false);
    }
  };

  const [activeTab, setActiveTab] = useState<'overview' | 'test' | 'deploy'>('overview');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8">
      <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">{detail.title}</h3>
            <p className="text-xs text-slate-500 capitalize">Source: {detail.source}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 text-2xl" aria-label="Close detail view">
            &times;
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 px-6">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-3 text-sm font-semibold transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'overview'
                ? 'border-orange-600 text-orange-600'
                : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
          >
            <FileText className="w-4 h-4" /> Overview
          </button>
          <button
            onClick={() => setActiveTab('test')}
            className={`px-4 py-3 text-sm font-semibold transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'test'
                ? 'border-orange-600 text-orange-600'
                : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
          >
            <Play className="w-4 h-4" /> Test Now
          </button>
          <button
            onClick={() => setActiveTab('deploy')}
            className={`px-4 py-3 text-sm font-semibold transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'deploy'
                ? 'border-orange-600 text-orange-600'
                : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
          >
            <Rocket className="w-4 h-4" /> Deploy
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-6">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Endpoint</h4>
                  {metadata ? (
                    <div className="mt-2 text-sm text-slate-600 space-y-1">
                      <p>
                        <span className="font-mono text-xs px-2 py-1 bg-slate-900 text-cloudflare-orange rounded mr-2">
                          {metadata.method}
                        </span>
                        <span className="font-mono">{metadata.path}</span>
                      </p>
                      {metadata.description && <p>{metadata.description}</p>}
                      {metadata.auth && (
                        <p className="text-xs text-slate-500">Auth: {metadata.auth}</p>
                      )}
                      {metadata.query && (
                        <div>
                          <p className="text-xs font-semibold text-slate-500 uppercase mt-2">Query Params</p>
                          <ul className="text-xs text-slate-500 list-disc list-inside space-y-1">
                            {Object.entries(metadata.query ?? {}).map(([key, value]) => (
                              <li key={key}>
                                <span className="font-semibold">{key}</span>
                                {value.description ? ` – ${value.description}` : ''}
                                {value.required ? ' (required)' : ''}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {metadata.headers && (
                        <div>
                          <p className="text-xs font-semibold text-slate-500 uppercase mt-2">Headers</p>
                          <ul className="text-xs text-slate-500 list-disc list-inside space-y-1">
                            {Object.entries(metadata.headers ?? {}).map(([key, value]) => (
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
                    <code>{code}</code>
                  </pre>
                  <p className="text-xs text-slate-500 mt-2">
                    Exports: {exportsList.length ? exportsList.join(', ') : 'none'}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Testing Sandbox</h4>
                  <form onSubmit={handleSubmit} className="space-y-3 mt-2">
                    <div>
                      <label
                        className="text-xs font-semibold text-slate-600 uppercase block mb-1"
                        htmlFor={fieldIds.url}
                      >
                        Request URL
                      </label>
                      <input
                        type="text"
                        id={fieldIds.url}
                        value={formState.url}
                        onChange={(event) =>
                          setFormState((previous) => ({ ...previous, url: event.target.value }))
                        }
                        className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                        placeholder="https://api.example.com/resource"
                      />
                    </div>
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label
                          className="text-xs font-semibold text-slate-600 uppercase block mb-1"
                          htmlFor={fieldIds.method}
                        >
                          Method
                        </label>
                        <input
                          type="text"
                          id={fieldIds.method}
                          value={formState.method}
                          onChange={(event) =>
                            setFormState((previous) => ({ ...previous, method: event.target.value }))
                          }
                          className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                        />
                      </div>
                      <div className="flex-1">
                        <label
                          className="text-xs font-semibold text-slate-600 uppercase block mb-1"
                          htmlFor={fieldIds.headers}
                        >
                          Headers (JSON)
                        </label>
                        <textarea
                          id={fieldIds.headers}
                          value={formState.headers}
                          onChange={(event) =>
                            setFormState((previous) => ({ ...previous, headers: event.target.value }))
                          }
                          className="w-full border border-slate-300 rounded px-3 py-2 text-sm min-h-[80px]"
                          placeholder='{"Authorization": "Bearer ..."}'
                        />
                      </div>
                    </div>
                    <div>
                      <label
                        className="text-xs font-semibold text-slate-600 uppercase block mb-1"
                        htmlFor={fieldIds.body}
                      >
                        Body (JSON or string)
                      </label>
                      <textarea
                        id={fieldIds.body}
                        value={formState.body}
                        onChange={(event) =>
                          setFormState((previous) => ({ ...previous, body: event.target.value }))
                        }
                        className="w-full border border-slate-300 rounded px-3 py-2 text-sm min-h-[100px]"
                        placeholder='{"name": "demo"}'
                      />
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-slate-500">Requests execute from the Worker runtime.</span>
                      <button
                        type="submit"
                        className="btn-primary text-sm px-4 py-2"
                        disabled={isTesting}
                      >
                        {isTesting ? 'Testing…' : 'Run Test'}
                      </button>
                    </div>
                  </form>
                  {sandboxError && <p className="text-sm text-red-500 mt-3">{sandboxError}</p>}
                  {sandboxResponse ? (
                    <div className="mt-4 border border-slate-200 rounded p-3 bg-slate-50 text-xs space-y-2">
                      <p className="text-slate-600">
                        Status: {sandboxResponse.status} {sandboxResponse.statusText} · {sandboxResponse.durationMs} ms
                      </p>
                      <div>
                        <p className="font-semibold text-slate-700">Headers</p>
                        <pre className="bg-white border border-slate-200 rounded p-2 max-h-32 overflow-auto">
                          {JSON.stringify(sandboxResponse.headers, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-700">Body</p>
                        <pre className="bg-white border border-slate-200 rounded p-2 max-h-48 overflow-auto">
                          {sandboxResponse.body}
                        </pre>
                      </div>
                    </div>
                  ) : null}
                </div>

                {metadata?.sampleRequest && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Sample Request</h4>
                    <pre className="mt-2 p-3 bg-slate-900 text-slate-100 text-xs rounded overflow-x-auto">
                      {JSON.stringify(metadata.sampleRequest, null, 2)}
                    </pre>
                  </div>
                )}
                {metadata?.sampleResponse && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Sample Response</h4>
                    <pre className="mt-2 p-3 bg-slate-900 text-slate-100 text-xs rounded overflow-x-auto">
                      {JSON.stringify(metadata.sampleResponse, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Test Now Tab */}
          {activeTab === 'test' && metadata && (
            <APITester
              endpoint={{
                method: metadata.method || 'GET',
                path: metadata.path || '',
                summary: metadata.description,
                query: metadata.query,
                headers: metadata.headers,
                auth: (metadata.auth as 'none' | 'apikey' | 'bearer' | 'basic' | undefined) || 'none',
              }}
              baseUrl={
                (detail.template?.metadata?.baseUrl as string) ||
                (metadata.sampleRequest?.baseUrl as string) ||
                ''
              }
              apiName={detail.title.split(':')[0] || 'API'}
            />
          )}

          {/* Deploy Tab */}
          {activeTab === 'deploy' && (
            <DeploymentGuide
              code={code}
              apiName={detail.title.split(':')[0] || 'API'}
              connectorName={detail.title}
            />
          )}
        </div>
      </div>
    </div>
  );
}
