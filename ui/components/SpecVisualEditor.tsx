import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';

interface EndpointNode {
  id: string;
  method: string;
  path: string;
  description?: string;
}

interface ConnectorNode {
  endpointId: string;
  name: string;
  verified?: boolean;
  installed?: boolean;
}

interface LineSegment {
  id: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

interface SpecVisualEditorProps {
  endpoints: EndpointNode[];
  connectors: ConnectorNode[];
  onGenerate: (endpointId: string) => void;
  onOpenDetail: (endpointId: string) => void;
}

const ENDPOINT_DRAG_MIME = 'application/x-endpoint-id';

export default function SpecVisualEditor({
  endpoints,
  connectors,
  onGenerate,
  onOpenDetail,
}: SpecVisualEditorProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const endpointRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const connectorRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [lines, setLines] = useState<LineSegment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const generatedEndpoints = useMemo(
    () => new Set(connectors.map((connector) => connector.endpointId)),
    [connectors],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const knownEndpointIds = new Set(endpoints.map((endpoint) => endpoint.id));
    Object.keys(endpointRefs.current).forEach((key) => {
      if (!knownEndpointIds.has(key)) {
        delete endpointRefs.current[key];
      }
    });

    const knownConnectorIds = new Set(connectors.map((connector) => connector.endpointId));
    Object.keys(connectorRefs.current).forEach((key) => {
      if (!knownConnectorIds.has(key)) {
        delete connectorRefs.current[key];
      }
    });
  }, [endpoints, connectors]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      setLines([]);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const segments: LineSegment[] = [];
    connectors.forEach((connector) => {
      const endpointEl = endpointRefs.current[connector.endpointId];
      const connectorEl = connectorRefs.current[connector.endpointId];
      if (!endpointEl || !connectorEl) {
        return;
      }

      const endpointRect = endpointEl.getBoundingClientRect();
      const connectorRect = connectorEl.getBoundingClientRect();
      segments.push({
        id: connector.endpointId,
        from: {
          x: endpointRect.right - containerRect.left,
          y: endpointRect.top + endpointRect.height / 2 - containerRect.top,
        },
        to: {
          x: connectorRect.left - containerRect.left,
          y: connectorRect.top + connectorRect.height / 2 - containerRect.top,
        },
      });
    });
    setLines(segments);
  }, [connectors, endpoints, containerSize]);

  const handleDragStart = (event: DragEvent<HTMLDivElement>, endpointId: string) => {
    event.dataTransfer.setData(ENDPOINT_DRAG_MIME, endpointId);
    event.dataTransfer.effectAllowed = 'copyMove';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    const endpointId =
      event.dataTransfer.getData(ENDPOINT_DRAG_MIME) || event.dataTransfer.getData('text/plain');
    if (endpointId) {
      onGenerate(endpointId);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!isDragOver) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  return (
    <section className="card p-6 space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Visual Spec Editor</h3>
          <p className="text-xs text-slate-500">
            Drag endpoints into the builder to generate connectors and see the relationships at a
            glance.
          </p>
        </div>
        <p className="text-xs text-slate-500 italic hidden sm:block">
          Tip: Double-click an endpoint to generate immediately.
        </p>
      </div>
      <div
        ref={containerRef}
        className="relative border border-slate-200 rounded-xl bg-gradient-to-br from-slate-50 to-white overflow-hidden"
      >
        <svg
          className="pointer-events-none absolute inset-0"
          width={containerSize.width || 0}
          height={containerSize.height || 0}
        >
          {lines.map((line) => (
            <line
              key={line.id}
              x1={line.from.x}
              y1={line.from.y}
              x2={line.to.x}
              y2={line.to.y}
              stroke="#f38020"
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray="4 3"
            />
          ))}
        </svg>
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.8fr)_minmax(0,1.1fr)] items-start p-4 lg:p-6">
          <div className="space-y-3">
            <h4 className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
              Spec Endpoints
            </h4>
            {endpoints.length === 0 ? (
              <p className="text-xs text-slate-500">Upload a spec to see endpoints here.</p>
            ) : (
              endpoints.map((endpoint) => (
                <div
                  key={endpoint.id}
                  ref={(element) => {
                    endpointRefs.current[endpoint.id] = element;
                  }}
                  draggable
                  onDragStart={(event) => handleDragStart(event, endpoint.id)}
                  onDoubleClick={() => onGenerate(endpoint.id)}
                  className={`cursor-grab active:cursor-grabbing border rounded-lg bg-white px-4 py-3 shadow-sm transition-all ${
                    generatedEndpoints.has(endpoint.id)
                      ? 'border-cloudflare-orange/70 ring-1 ring-cloudflare-orange/40'
                      : 'border-slate-200 hover:border-cloudflare-orange/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide bg-slate-900 text-cloudflare-orange rounded">
                      {endpoint.method}
                    </span>
                    <button
                      type="button"
                      className="text-xs text-slate-500 hover:text-slate-900 underline"
                      onClick={() => onOpenDetail(endpoint.id)}
                    >
                      Inspect
                    </button>
                  </div>
                  <p className="font-mono text-xs text-slate-800 mt-2 break-all">{endpoint.path}</p>
                  {endpoint.description && (
                    <p className="text-xs text-slate-500 mt-1">{endpoint.description}</p>
                  )}
                </div>
              ))
            )}
          </div>

          <div>
            <h4 className="text-xs uppercase tracking-wide text-slate-500 font-semibold text-center">
              Builder
            </h4>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`mt-3 flex flex-col items-center justify-center border-2 border-dashed rounded-xl min-h-[180px] transition-colors ${
                isDragOver ? 'border-cloudflare-orange bg-orange-50/50' : 'border-slate-300 bg-white'
              }`}
            >
              <div className="text-center px-4 py-6 space-y-2">
                <p className="text-sm font-medium text-slate-700">
                  {isDragOver ? 'Release to generate' : 'Drag an endpoint here'}
                </p>
                <p className="text-xs text-slate-500">
                  We will call Workers AI to generate a connector for the dropped endpoint.
                </p>
              </div>
              <button
                type="button"
                className="mb-4 text-xs font-medium text-cloudflare-orange hover:text-orange-600"
                onClick={() => {
                  if (endpoints.length) {
                    onGenerate(endpoints[0].id);
                  }
                }}
              >
                Quick-generate first endpoint
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
              Generated Connectors
            </h4>
            {connectors.length === 0 ? (
              <p className="text-xs text-slate-500">
                Generated connectors will appear here once the builder runs.
              </p>
            ) : (
              connectors.map((connector) => (
                <div
                  key={connector.endpointId}
                  ref={(element) => {
                    connectorRefs.current[connector.endpointId] = element;
                  }}
                  className="border border-slate-200 bg-white rounded-lg px-4 py-3 shadow-sm"
                >
                  <p className="text-sm font-semibold text-slate-900">{connector.name}</p>
                  <div className="flex items-center gap-2 mt-2 text-[11px]">
                    {connector.verified && (
                      <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full font-medium">
                        Verified
                      </span>
                    )}
                    {connector.installed && (
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full font-medium">
                        Installed
                      </span>
                    )}
                    {!connector.verified && (
                      <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-full font-medium">
                        Pending verification
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => onOpenDetail(connector.endpointId)}
                      className="text-xs text-slate-600 hover:text-slate-900 underline"
                    >
                      View detail
                    </button>
                    {!connector.verified && (
                      <button
                        type="button"
                        onClick={() => onGenerate(connector.endpointId)}
                        className="text-xs text-cloudflare-orange hover:text-orange-600 underline"
                      >
                        Regenerate
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
