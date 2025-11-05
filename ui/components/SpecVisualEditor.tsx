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
  onGenerateAll?: () => void;
  onOpenDetail: (endpointId: string) => void;
  isGenerating?: boolean;
}

const ENDPOINT_DRAG_MIME = 'application/x-endpoint-id';

export default function SpecVisualEditor({
  endpoints,
  connectors,
  onGenerate,
  onGenerateAll,
  onOpenDetail,
  isGenerating = false,
}: SpecVisualEditorProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const endpointRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const connectorRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [lines, setLines] = useState<LineSegment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showAllEndpoints, setShowAllEndpoints] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const generatedEndpoints = useMemo(
    () => new Set(connectors.map((connector) => connector.endpointId)),
    [connectors],
  );

  // Filter endpoints based on search
  const filteredEndpoints = useMemo(() => {
    if (!searchQuery) return endpoints;

    const query = searchQuery.toLowerCase();
    return endpoints.filter((endpoint) =>
      endpoint.path.toLowerCase().includes(query) ||
      endpoint.method.toLowerCase().includes(query) ||
      endpoint.description?.toLowerCase().includes(query)
    );
  }, [endpoints, searchQuery]);

  // Display logic: Show samples by default, or filtered results
  const displayedEndpoints = useMemo(() => {
    if (searchQuery) {
      // Show all matching when searching
      return filteredEndpoints;
    }

    if (showAllEndpoints) {
      // Show everything
      return endpoints;
    }

    // Default: Sample first 5 endpoints
    const MAX_SAMPLES = 5;
    return endpoints.slice(0, MAX_SAMPLES);
  }, [endpoints, filteredEndpoints, searchQuery, showAllEndpoints]);

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

      {/* Search and Status */}
      {endpoints.length > 0 && (
        <div className="space-y-3">
          {/* Search bar */}
          <div className="relative">
            <input
              type="text"
              placeholder="🔍 Search endpoints by path, method, or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-cloudflare-orange focus:border-transparent"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            )}
          </div>

          {/* Status message */}
          <div className="flex items-center justify-between text-sm text-slate-600">
            <div>
              {searchQuery ? (
                <span>
                  Found <strong className="text-slate-900">{filteredEndpoints.length}</strong> endpoint{filteredEndpoints.length !== 1 ? 's' : ''} matching "{searchQuery}"
                </span>
              ) : showAllEndpoints ? (
                <span>
                  Showing <strong className="text-slate-900">all {endpoints.length}</strong> endpoint{endpoints.length !== 1 ? 's' : ''}
                </span>
              ) : (
                <span>
                  Showing <strong className="text-slate-900">{displayedEndpoints.length}</strong> of <strong className="text-slate-900">{endpoints.length}</strong> endpoint{endpoints.length !== 1 ? 's' : ''} · <button onClick={() => setShowAllEndpoints(true)} className="text-cloudflare-orange hover:text-orange-600 underline">Show all</button>
                </span>
              )}
            </div>
            {(showAllEndpoints || searchQuery) && (
              <button
                onClick={() => {
                  setShowAllEndpoints(false);
                  setSearchQuery('');
                }}
                className="text-slate-600 hover:text-slate-900 underline"
              >
                Reset view
              </button>
            )}
          </div>
        </div>
      )}
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
            <div className="flex items-center justify-between">
              <h4 className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
                Spec Endpoints
              </h4>
              {!showAllEndpoints && !searchQuery && endpoints.length > 5 && (
                <span className="text-[10px] text-slate-400 italic">
                  Showing sample
                </span>
              )}
            </div>
            {displayedEndpoints.length === 0 ? (
              <div className="text-center py-8">
                {endpoints.length === 0 ? (
                  <p className="text-xs text-slate-500">Upload a spec to see endpoints here.</p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500">No endpoints match your search.</p>
                    <button
                      onClick={() => setSearchQuery('')}
                      className="text-xs text-cloudflare-orange hover:text-orange-600 underline"
                    >
                      Clear search
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                {displayedEndpoints.map((endpoint) => (
                  <div
                    key={endpoint.id}
                    ref={(element) => {
                      endpointRefs.current[endpoint.id] = element;
                    }}
                    draggable
                    onDragStart={(event) => handleDragStart(event, endpoint.id)}
                    onDoubleClick={() => onGenerate(endpoint.id)}
                    className={`cursor-grab active:cursor-grabbing border rounded-lg bg-white px-4 py-3 shadow-sm transition-all ${generatedEndpoints.has(endpoint.id)
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
                ))}
                {!showAllEndpoints && !searchQuery && endpoints.length > 5 && (
                  <button
                    onClick={() => setShowAllEndpoints(true)}
                    className="w-full py-3 text-xs font-medium text-cloudflare-orange hover:text-orange-600 border-2 border-dashed border-slate-200 hover:border-cloudflare-orange/40 rounded-lg transition-colors"
                  >
                    + Show {endpoints.length - displayedEndpoints.length} more endpoint{endpoints.length - displayedEndpoints.length !== 1 ? 's' : ''}
                  </button>
                )}
              </>
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
              className={`mt-3 flex flex-col items-center justify-center border-2 border-dashed rounded-xl min-h-[180px] transition-colors ${isDragOver ? 'border-cloudflare-orange bg-orange-50/50' : 'border-slate-300 bg-white'
                }`}
            >
              {isGenerating ? (
                <div className="text-center px-4 py-8 space-y-3">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-cloudflare-orange"></div>
                  <p className="text-sm font-medium text-slate-700">Generating code...</p>
                  <p className="text-xs text-slate-500">This may take a moment</p>
                </div>
              ) : (
                <>
                  <div className="text-center px-4 py-6 space-y-3">
                    <div className="text-4xl">💡</div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-slate-700">
                        {isDragOver ? '🎯 Release to generate' : 'Generate AI Connectors'}
                      </p>
                      <p className="text-xs text-slate-500 max-w-[200px] mx-auto">
                        {isDragOver
                          ? 'Drop here to generate code for this endpoint'
                          : 'Generate code for all endpoints at once, or drag individual endpoints to customize'}
                      </p>
                    </div>
                  </div>

                  {onGenerateAll && endpoints.length > 0 && (
                    <div className="mb-4 flex flex-col gap-2 w-full px-4">
                      <button
                        type="button"
                        onClick={onGenerateAll}
                        disabled={isGenerating}
                        className="w-full px-4 py-2 bg-cloudflare-orange text-white rounded-lg hover:bg-orange-600 font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        🚀 Generate All {endpoints.length} Endpoints
                      </button>
                      <p className="text-[10px] text-slate-400 text-center italic">
                        Or drag endpoints individually
                      </p>
                    </div>
                  )}
                </>
              )}
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
