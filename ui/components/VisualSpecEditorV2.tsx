import { useState, useMemo } from 'react';
import { Search, Plus, Edit, Trash2, FileText, List, Folder, FolderOpen, ChevronDown, ChevronRight, Lock, FileCode } from 'lucide-react';

interface Endpoint {
    path: string;
    method: string;
    summary?: string;
    description?: string;
    parameters?: Parameter[];
    requestBody?: RequestBody;
    responses?: Record<string, Response>;
    tags?: string[];
    security?: SecurityRequirement[];
}

interface Parameter {
    name: string;
    in: 'query' | 'header' | 'path' | 'cookie';
    required?: boolean;
    schema?: Schema;
    description?: string;
}

interface Schema {
    type: string;
    format?: string;
    properties?: Record<string, Schema>;
    items?: Schema;
    required?: string[];
    enum?: any[];
    default?: any;
}

interface RequestBody {
    description?: string;
    required?: boolean;
    content?: Record<string, { schema: Schema }>;
}

interface Response {
    description: string;
    content?: Record<string, { schema: Schema }>;
}

interface SecurityRequirement {
    [key: string]: string[];
}

interface GroupedEndpoints {
    [tag: string]: Endpoint[];
}

type ViewMode = 'list' | 'cards' | 'tree';

interface VisualSpecEditorV2Props {
    spec: any;
    onSave?: (updatedSpec: any) => void;
    onGenerateCode?: (endpointId: string) => void;
}

export default function VisualSpecEditorV2({ spec, onSave, onGenerateCode }: VisualSpecEditorV2Props) {
    const [viewMode, setViewMode] = useState<ViewMode>('tree');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedMethods, setSelectedMethods] = useState<Set<string>>(
        new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
    );
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['Ungrouped']));
    const [selectedEndpoints, setSelectedEndpoints] = useState<Set<string>>(new Set());
    const [editingEndpoint, setEditingEndpoint] = useState<{ endpoint: Endpoint; path: string; method: string } | null>(null);
    const [showAllEndpoints, setShowAllEndpoints] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

    const groupedEndpoints = useMemo(() => {
        if (!spec?.paths) return {};

        const groups: GroupedEndpoints = {};

        Object.entries(spec.paths).forEach(([path, methods]: [string, any]) => {
            Object.entries(methods).forEach(([method, endpoint]: [string, any]) => {
                if (!['get', 'post', 'put', 'delete', 'patch', 'options', 'head'].includes(method)) {
                    return;
                }

                const tags = endpoint.tags || ['Ungrouped'];
                const endpointObj: Endpoint = {
                    path,
                    method: method.toUpperCase(),
                    ...endpoint,
                };

                tags.forEach((tag: string) => {
                    if (!groups[tag]) groups[tag] = [];
                    groups[tag].push(endpointObj);
                });
            });
        });

        return groups;
    }, [spec]);

    const filteredGroups = useMemo(() => {
        const filtered: GroupedEndpoints = {};

        Object.entries(groupedEndpoints).forEach(([tag, endpoints]) => {
            const matchingEndpoints = endpoints.filter((endpoint) => {
                const methodMatch = selectedMethods.has(endpoint.method);
                const searchMatch =
                    !searchQuery ||
                    endpoint.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    endpoint.summary?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    endpoint.description?.toLowerCase().includes(searchQuery.toLowerCase());

                return methodMatch && searchMatch;
            });

            if (matchingEndpoints.length > 0) {
                filtered[tag] = matchingEndpoints;
            }
        });

        return filtered;
    }, [groupedEndpoints, searchQuery, selectedMethods]);

    const displayedEndpoints = useMemo(() => {
        if (searchQuery) {
            return filteredGroups;
        }

        if (selectedCategory) {
            return selectedCategory in filteredGroups
                ? { [selectedCategory]: filteredGroups[selectedCategory] }
                : {};
        }

        if (showAllEndpoints) {
            return filteredGroups;
        }

        const samples: GroupedEndpoints = {};
        let count = 0;
        const MAX_SAMPLES = 5;

        for (const [tag, endpoints] of Object.entries(filteredGroups)) {
            if (count >= MAX_SAMPLES) break;

            const take = Math.min(2, endpoints.length, MAX_SAMPLES - count);
            if (take > 0) {
                samples[tag] = endpoints.slice(0, take);
                count += take;
            }
        }

        return samples;
    }, [filteredGroups, searchQuery, selectedCategory, showAllEndpoints]);

    const totalEndpoints = useMemo(() =>
        Object.values(groupedEndpoints).reduce((sum, eps) => sum + eps.length, 0),
        [groupedEndpoints]
    );

    const displayedCount = useMemo(() =>
        Object.values(displayedEndpoints).reduce((sum, eps) => sum + eps.length, 0),
        [displayedEndpoints]
    );

    const filteredCount = useMemo(() =>
        Object.values(filteredGroups).reduce((sum, eps) => sum + eps.length, 0),
        [filteredGroups]
    );

    const toggleGroup = (tag: string) => {
        setExpandedGroups((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(tag)) {
                newSet.delete(tag);
            } else {
                newSet.add(tag);
            }
            return newSet;
        });
    };

    const handleCategoryClick = (tag: string) => {
        if (selectedCategory === tag) {
            setSelectedCategory(null);
        } else {
            setSelectedCategory(tag);
            setShowAllEndpoints(false);
            setExpandedGroups(new Set([tag]));
        }
    };

    const handleShowAll = () => {
        setShowAllEndpoints(true);
        setSelectedCategory(null);
    };

    const handleResetView = () => {
        setShowAllEndpoints(false);
        setSelectedCategory(null);
        setSearchQuery('');
    };

    const toggleEndpointSelection = (key: string) => {
        const newSelected = new Set(selectedEndpoints);
        if (newSelected.has(key)) {
            newSelected.delete(key);
        } else {
            newSelected.add(key);
        }
        setSelectedEndpoints(newSelected);
    };

    const toggleMethod = (method: string) => {
        const newMethods = new Set(selectedMethods);
        if (newMethods.has(method)) {
            newMethods.delete(method);
        } else {
            newMethods.add(method);
        }
        setSelectedMethods(newMethods);
    };

    const getMethodColor = (method: string) => {
        const colors: Record<string, string> = {
            GET: 'text-blue-600 bg-blue-50 border-blue-200',
            POST: 'text-green-600 bg-green-50 border-green-200',
            PUT: 'text-orange-600 bg-orange-50 border-orange-200',
            DELETE: 'text-red-600 bg-red-50 border-red-200',
            PATCH: 'text-purple-600 bg-purple-50 border-purple-200',
        };
        return colors[method] || 'text-gray-600 bg-gray-50 border-gray-200';
    };

    const getMethodIcon = (method: string) => {
        const icons: Record<string, JSX.Element> = {
            GET: <Search className="w-4 h-4" />,
            POST: <Plus className="w-4 h-4" />,
            PUT: <Edit className="w-4 h-4" />,
            DELETE: <Trash2 className="w-4 h-4" />,
            PATCH: <Edit className="w-4 h-4" />,
        };
        return icons[method] || <FileText className="w-4 h-4" />;
    };

    const handleEditEndpoint = (endpoint: Endpoint) => {
        setEditingEndpoint({
            endpoint: { ...endpoint },
            path: endpoint.path,
            method: endpoint.method
        });
    };

    const handleSaveEndpoint = (updatedEndpoint: Endpoint, originalPath: string, originalMethod: string) => {
        const newSpec = JSON.parse(JSON.stringify(spec));
        const method = originalMethod.toLowerCase();

        if (newSpec.paths[originalPath]?.[method]) {
            newSpec.paths[originalPath][method] = {
                ...updatedEndpoint,
                path: undefined,
                method: undefined,
            };
        }

        if (onSave) {
            onSave(newSpec);
        }
        setEditingEndpoint(null);
    };

    if (!spec) {
        return (
            <div className="flex items-center justify-center h-full bg-gray-50">
                <div className="text-center p-8">
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">No Spec Loaded</h2>
                    <p className="text-gray-600">Upload and parse an API spec to get started</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b px-6 py-4">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">{spec.info?.title || 'API Specification'}</h1>
                        <p className="text-sm text-gray-600">{spec.info?.version || 'v1.0.0'}</p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={onSave}
                            className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-medium"
                        >
                            Save & Regenerate
                        </button>
                    </div>
                </div>

                {/* Search and Filters */}
                <div className="flex gap-4 items-center">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search endpoints by path, method, or description..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                        />
                    </div>

                    {/* Method Filters */}
                    <div className="flex gap-2">
                        {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map(method => (
                            <button
                                key={method}
                                onClick={() => toggleMethod(method)}
                                className={`px-3 py-1 rounded text-xs font-bold border ${selectedMethods.has(method)
                                    ? getMethodColor(method)
                                    : 'bg-gray-100 text-gray-400 border-gray-200'
                                    }`}
                            >
                                {method}
                            </button>
                        ))}
                    </div>

                    {/* View Mode Toggle */}
                    <div className="flex border border-gray-300 rounded overflow-hidden">
                        <button
                            onClick={() => setViewMode('tree')}
                            className={`px-3 py-1 text-sm flex items-center gap-1 ${viewMode === 'tree' ? 'bg-orange-50 text-orange-600' : 'bg-white hover:bg-gray-50'}`}
                            title="Tree View"
                        >
                            <FileText className="w-4 h-4" /> Tree
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`px-3 py-1 border-x border-gray-300 text-sm flex items-center gap-1 ${viewMode === 'list' ? 'bg-orange-50 text-orange-600' : 'bg-white hover:bg-gray-50'}`}
                            title="List View"
                        >
                            <List className="w-4 h-4" /> List
                        </button>
                        <button
                            onClick={() => setViewMode('cards')}
                            className={`px-3 py-1 text-sm flex items-center gap-1 ${viewMode === 'cards' ? 'bg-orange-50 text-orange-600' : 'bg-white hover:bg-gray-50'}`}
                            title="Card View"
                        >
                            <FileText className="w-4 h-4" /> Cards
                        </button>
                    </div>
                </div>

                {/* Status Message & Category Browsing */}
                <div className="mt-4 space-y-3">
                    {/* Status bar */}
                    <div className="flex items-center justify-between">
                        <div className="text-sm text-gray-600">
                            {searchQuery ? (
                                <span>
                                    Found <strong className="text-gray-900">{filteredCount}</strong> endpoint{filteredCount !== 1 ? 's' : ''} matching "{searchQuery}"
                                </span>
                            ) : selectedCategory ? (
                                <span>
                                    Showing <strong className="text-gray-900">{displayedCount}</strong> endpoint{displayedCount !== 1 ? 's' : ''} in <strong className="text-orange-600">{selectedCategory}</strong>
                                </span>
                            ) : showAllEndpoints ? (
                                <span>
                                    Showing <strong className="text-gray-900">all {totalEndpoints}</strong> endpoint{totalEndpoints !== 1 ? 's' : ''}
                                </span>
                            ) : (
                                <span>
                                    Showing <strong className="text-gray-900">{displayedCount}</strong> of <strong className="text-gray-900">{totalEndpoints}</strong> endpoint{totalEndpoints !== 1 ? 's' : ''} · <button onClick={handleShowAll} className="text-orange-600 hover:text-orange-700 underline">Show all</button>
                                </span>
                            )}
                        </div>
                        {(selectedCategory || showAllEndpoints || searchQuery) && (
                            <button
                                onClick={handleResetView}
                                className="text-sm text-gray-600 hover:text-gray-900 underline"
                            >
                                Reset view
                            </button>
                        )}
                    </div>

                    {/* Category badges - only show when not searching and not in show-all mode */}
                    {!searchQuery && !showAllEndpoints && (
                        <div className="flex flex-wrap gap-2 items-center">
                            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                                Browse by category:
                            </span>
                            {Object.entries(filteredGroups).map(([tag, endpoints]) => (
                                <button
                                    key={tag}
                                    onClick={() => handleCategoryClick(tag)}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedCategory === tag
                                        ? 'bg-orange-600 text-white shadow-sm'
                                        : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 hover:border-orange-300'
                                        }`}
                                >
                                    <Folder className="w-4 h-4 inline-block mr-1" /> {tag} <span className="text-xs opacity-75">({endpoints.length})</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Selection Info */}
                {selectedEndpoints.size > 0 && (
                    <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg flex items-center justify-between">
                        <span className="text-sm font-medium text-orange-900">
                            {selectedEndpoints.size} endpoint{selectedEndpoints.size > 1 ? 's' : ''} selected
                        </span>
                        <button
                            onClick={() => setSelectedEndpoints(new Set())}
                            className="text-sm text-orange-600 hover:text-orange-700 font-medium"
                        >
                            Clear Selection
                        </button>
                    </div>
                )}
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-hidden flex">
                {/* Sidebar - Group List */}
                <aside className="w-64 bg-white border-r overflow-y-auto">
                    <div className="p-4">
                        <h3 className="font-semibold mb-3 text-xs text-gray-500 uppercase tracking-wide">Groups</h3>
                        {Object.entries(displayedEndpoints).length === 0 ? (
                            <p className="text-sm text-gray-500 italic">No endpoints to display</p>
                        ) : (
                            Object.entries(displayedEndpoints).map(([tag, endpoints]) => (
                                <button
                                    key={tag}
                                    onClick={() => toggleGroup(tag)}
                                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 flex items-center justify-between mb-1 group"
                                >
                                    <span className="flex items-center gap-2">
                                        {expandedGroups.has(tag) ? <FolderOpen className="w-5 h-5 text-gray-600" /> : <Folder className="w-5 h-5 text-gray-600" />}
                                        <span className="font-medium text-sm text-gray-900">{tag}</span>
                                    </span>
                                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full group-hover:bg-gray-200">
                                        {endpoints.length}
                                    </span>
                                </button>
                            ))
                        )}
                    </div>
                </aside>

                {/* Main Editor Area */}
                <main className="flex-1 overflow-y-auto p-6">
                    {viewMode === 'tree' && (
                        <TreeView
                            groups={displayedEndpoints}
                            expandedGroups={expandedGroups}
                            selectedEndpoints={selectedEndpoints}
                            onToggleGroup={toggleGroup}
                            onToggleSelection={toggleEndpointSelection}
                            onEdit={handleEditEndpoint}
                            onGenerate={onGenerateCode}
                            getMethodColor={getMethodColor}
                            getMethodIcon={getMethodIcon}
                        />
                    )}

                    {viewMode === 'list' && (
                        <ListView
                            groups={displayedEndpoints}
                            selectedEndpoints={selectedEndpoints}
                            onToggleSelection={toggleEndpointSelection}
                            onEdit={handleEditEndpoint}
                            onGenerate={onGenerateCode}
                            getMethodColor={getMethodColor}
                        />
                    )}

                    {viewMode === 'cards' && (
                        <CardView
                            groups={displayedEndpoints}
                            selectedEndpoints={selectedEndpoints}
                            onToggleSelection={toggleEndpointSelection}
                            onEdit={handleEditEndpoint}
                            onGenerate={onGenerateCode}
                            getMethodColor={getMethodColor}
                            getMethodIcon={getMethodIcon}
                        />
                    )}
                </main>
            </div>

            {/* Endpoint Editor Modal */}
            {editingEndpoint && (
                <EndpointEditorModal
                    endpoint={editingEndpoint.endpoint}
                    originalPath={editingEndpoint.path}
                    originalMethod={editingEndpoint.method}
                    onClose={() => setEditingEndpoint(null)}
                    onSave={handleSaveEndpoint}
                />
            )}
        </div>
    );
}

// Tree View Component
function TreeView({ groups, expandedGroups, selectedEndpoints, onToggleGroup, onToggleSelection, onEdit, onGenerate, getMethodColor, getMethodIcon }: any) {
    return (
        <div className="space-y-4">
            {Object.entries(groups).map(([tag, endpoints]: [string, any]) => (
                <div key={tag} className="bg-white rounded-lg shadow-sm border border-gray-200">
                    <button
                        onClick={() => onToggleGroup(tag)}
                        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                    >
                        <div className="flex items-center gap-3">
                            {expandedGroups.has(tag) ? <FolderOpen className="w-8 h-8 text-gray-600" /> : <Folder className="w-8 h-8 text-gray-600" />}
                            <div className="text-left">
                                <h3 className="font-semibold text-lg text-gray-900">{tag}</h3>
                                <p className="text-sm text-gray-500">{endpoints.length} endpoint{endpoints.length !== 1 ? 's' : ''}</p>
                            </div>
                        </div>
                        {expandedGroups.has(tag) ? <ChevronDown className="w-6 h-6 text-gray-400" /> : <ChevronRight className="w-6 h-6 text-gray-400" />}
                    </button>

                    {expandedGroups.has(tag) && (
                        <div className="border-t border-gray-200">
                            {endpoints.map((endpoint: Endpoint) => {
                                const key = `${endpoint.method}-${endpoint.path}`;
                                return (
                                    <div
                                        key={key}
                                        className="px-6 py-3 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 flex items-center gap-4"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedEndpoints.has(key)}
                                            onChange={() => onToggleSelection(key)}
                                            className="w-4 h-4 text-orange-600 rounded focus:ring-orange-500"
                                            aria-label={`Select ${endpoint.method} ${endpoint.path}`}
                                        />
                                        <span className="text-2xl">{getMethodIcon(endpoint.method)}</span>
                                        <span className={`px-2 py-1 rounded text-xs font-bold border ${getMethodColor(endpoint.method)}`}>
                                            {endpoint.method}
                                        </span>
                                        <code className="flex-1 font-mono text-sm text-gray-700">{endpoint.path}</code>
                                        <span className="text-sm text-gray-600 max-w-xs truncate">{endpoint.summary || 'No description'}</span>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => onEdit(endpoint)}
                                                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 font-medium"
                                            >
                                                Edit
                                            </button>
                                            {onGenerate && (
                                                <button
                                                    onClick={() => {
                                                        const key = `${endpoint.path}-${endpoint.method}`;
                                                        onGenerate(key);
                                                    }}
                                                    className="px-3 py-1.5 text-sm bg-cloudflare-orange text-white rounded-lg hover:bg-orange-600 font-medium"
                                                >
                                                    Generate
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

// List View Component
function ListView({ groups, selectedEndpoints, onToggleSelection, onEdit, onGenerate, getMethodColor }: any) {
    const allEndpoints = Object.values(groups).flat() as Endpoint[];

    return (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="w-8 px-6 py-3"></th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Method</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Path</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Summary</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Params</th>
                            <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {allEndpoints.map((endpoint: Endpoint) => {
                            const key = `${endpoint.method}-${endpoint.path}`;
                            const paramCount = endpoint.parameters?.length || 0;

                            return (
                                <tr key={key} className="hover:bg-gray-50">
                                    <td className="px-6 py-4">
                                        <input
                                            type="checkbox"
                                            checked={selectedEndpoints.has(key)}
                                            onChange={() => onToggleSelection(key)}
                                            className="w-4 h-4 text-orange-600 rounded focus:ring-orange-500"
                                            aria-label={`Select ${endpoint.method} ${endpoint.path}`}
                                        />
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-1 rounded text-xs font-bold border ${getMethodColor(endpoint.method)}`}>
                                            {endpoint.method}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <code className="font-mono text-sm text-gray-700">{endpoint.path}</code>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate">
                                        {endpoint.summary || <span className="italic text-gray-400">No description</span>}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-600">
                                        {paramCount > 0 ? `${paramCount} param${paramCount !== 1 ? 's' : ''}` : '-'}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex gap-2 justify-end">
                                            <button
                                                onClick={() => onEdit(endpoint)}
                                                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 font-medium"
                                            >
                                                Edit
                                            </button>
                                            {onGenerate && (
                                                <button
                                                    onClick={() => {
                                                        const key = `${endpoint.path}-${endpoint.method}`;
                                                        onGenerate(key);
                                                    }}
                                                    className="px-3 py-1.5 text-sm bg-cloudflare-orange text-white rounded-lg hover:bg-orange-600 font-medium"
                                                >
                                                    Generate
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// Card View Component
function CardView({ groups, selectedEndpoints, onToggleSelection, onEdit, onGenerate, getMethodColor, getMethodIcon }: any) {
    const allEndpoints = Object.values(groups).flat() as Endpoint[];

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {allEndpoints.map((endpoint: Endpoint) => {
                const key = `${endpoint.method}-${endpoint.path}`;
                const paramCount = endpoint.parameters?.length || 0;
                const hasAuth = endpoint.security && endpoint.security.length > 0;

                return (
                    <div
                        key={key}
                        className="bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
                    >
                        <div className="p-4">
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={selectedEndpoints.has(key)}
                                        onChange={() => onToggleSelection(key)}
                                        className="w-4 h-4 text-orange-600 rounded focus:ring-orange-500 mt-1"
                                        aria-label={`Select ${endpoint.method} ${endpoint.path}`}
                                    />
                                    <span className="text-2xl">{getMethodIcon(endpoint.method)}</span>
                                </div>
                                <span className={`px-2 py-1 rounded text-xs font-bold border ${getMethodColor(endpoint.method)}`}>
                                    {endpoint.method}
                                </span>
                            </div>

                            <code className="block font-mono text-sm mb-2 break-all text-gray-700">{endpoint.path}</code>
                            <p className="text-sm text-gray-600 mb-4 line-clamp-2 min-h-[2.5rem]">
                                {endpoint.summary || <span className="italic text-gray-400">No description</span>}
                            </p>

                            <div className="flex items-center gap-3 mb-4 text-xs text-gray-500">
                                {hasAuth && <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> Auth</span>}
                                {paramCount > 0 && <span className="flex items-center gap-1"><FileCode className="w-3 h-3" /> {paramCount} param{paramCount !== 1 ? 's' : ''}</span>}
                            </div>

                            <div className="space-y-2">
                                <button
                                    onClick={() => onEdit(endpoint)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
                                >
                                    Edit Endpoint
                                </button>
                                {onGenerate && (
                                    <button
                                        onClick={() => {
                                            const key = `${endpoint.path}-${endpoint.method}`;
                                            onGenerate(key);
                                        }}
                                        className="w-full px-3 py-2 text-sm bg-cloudflare-orange text-white rounded-lg hover:bg-orange-600 font-medium"
                                    >
                                        Generate Code
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// Endpoint Editor Modal
function EndpointEditorModal({ endpoint, originalPath, originalMethod, onClose, onSave }: any) {
    const [activeTab, setActiveTab] = useState<'overview' | 'parameters'>('overview');
    const [editedEndpoint, setEditedEndpoint] = useState<Endpoint>({ ...endpoint });
    const [newParam, setNewParam] = useState<Parameter>({
        name: '',
        in: 'query',
        required: false,
        description: '',
        schema: { type: 'string' }
    });
    const [showAddParam, setShowAddParam] = useState(false);

    const handleSave = () => {
        onSave(editedEndpoint, originalPath, originalMethod);
    };

    const handleAddParameter = () => {
        if (!newParam.name.trim()) return;

        const params = editedEndpoint.parameters || [];
        setEditedEndpoint({
            ...editedEndpoint,
            parameters: [...params, { ...newParam }]
        });
        setNewParam({
            name: '',
            in: 'query',
            required: false,
            description: '',
            schema: { type: 'string' }
        });
        setShowAddParam(false);
    };

    const handleRemoveParameter = (index: number) => {
        const params = [...(editedEndpoint.parameters || [])];
        params.splice(index, 1);
        setEditedEndpoint({
            ...editedEndpoint,
            parameters: params
        });
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-gray-200">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-2xl font-bold text-gray-900">Edit Endpoint</h2>
                            <p className="text-gray-600 mt-1">
                                <code className="text-sm font-mono">{editedEndpoint.method} {editedEndpoint.path}</code>
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-gray-600 text-2xl"
                        >
                            ×
                        </button>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-1 mt-4 border-b border-gray-200">
                        <button
                            onClick={() => setActiveTab('overview')}
                            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'overview'
                                ? 'border-orange-600 text-orange-600'
                                : 'border-transparent text-gray-600 hover:text-gray-900'
                                }`}
                        >
                            Overview
                        </button>
                        <button
                            onClick={() => setActiveTab('parameters')}
                            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'parameters'
                                ? 'border-orange-600 text-orange-600'
                                : 'border-transparent text-gray-600 hover:text-gray-900'
                                }`}
                        >
                            Parameters {editedEndpoint.parameters?.length ? `(${editedEndpoint.parameters.length})` : ''}
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {activeTab === 'overview' && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Summary
                                </label>
                                <input
                                    type="text"
                                    value={editedEndpoint.summary || ''}
                                    onChange={(e) => setEditedEndpoint({ ...editedEndpoint, summary: e.target.value })}
                                    placeholder="Brief description of the endpoint"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Description
                                </label>
                                <textarea
                                    value={editedEndpoint.description || ''}
                                    onChange={(e) => setEditedEndpoint({ ...editedEndpoint, description: e.target.value })}
                                    placeholder="Detailed description of the endpoint functionality"
                                    rows={4}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="endpoint-path" className="block text-sm font-medium text-gray-700 mb-1">
                                        Path
                                    </label>
                                    <input
                                        id="endpoint-path"
                                        type="text"
                                        value={editedEndpoint.path}
                                        disabled
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600 font-mono text-sm"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Path cannot be edited</p>
                                </div>

                                <div>
                                    <label htmlFor="endpoint-method" className="block text-sm font-medium text-gray-700 mb-1">
                                        Method
                                    </label>
                                    <input
                                        id="endpoint-method"
                                        type="text"
                                        value={editedEndpoint.method}
                                        disabled
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600 font-mono text-sm"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Method cannot be edited</p>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Tags
                                </label>
                                <input
                                    type="text"
                                    value={editedEndpoint.tags?.join(', ') || ''}
                                    onChange={(e) => setEditedEndpoint({
                                        ...editedEndpoint,
                                        tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean)
                                    })}
                                    placeholder="e.g., users, authentication, admin"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                />
                                <p className="text-xs text-gray-500 mt-1">Comma-separated tags for grouping</p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'parameters' && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-gray-900">Parameters</h3>
                                <button
                                    onClick={() => setShowAddParam(!showAddParam)}
                                    className="px-3 py-1.5 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-medium"
                                >
                                    {showAddParam ? 'Cancel' : '+ Add Parameter'}
                                </button>
                            </div>

                            {/* Add Parameter Form */}
                            {showAddParam && (
                                <div className="p-4 border border-orange-200 bg-orange-50 rounded-lg space-y-3">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                Name *
                                            </label>
                                            <input
                                                type="text"
                                                value={newParam.name}
                                                onChange={(e) => setNewParam({ ...newParam, name: e.target.value })}
                                                placeholder="parameterName"
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                            />
                                        </div>

                                        <div>
                                            <label htmlFor="param-location" className="block text-sm font-medium text-gray-700 mb-1">
                                                Location
                                            </label>
                                            <select
                                                id="param-location"
                                                value={newParam.in}
                                                onChange={(e) => setNewParam({ ...newParam, in: e.target.value as any })}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                            >
                                                <option value="query">Query</option>
                                                <option value="path">Path</option>
                                                <option value="header">Header</option>
                                                <option value="cookie">Cookie</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label htmlFor="param-type" className="block text-sm font-medium text-gray-700 mb-1">
                                                Type
                                            </label>
                                            <select
                                                id="param-type"
                                                value={newParam.schema?.type || 'string'}
                                                onChange={(e) => setNewParam({
                                                    ...newParam,
                                                    schema: { ...newParam.schema, type: e.target.value }
                                                })}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                            >
                                                <option value="string">String</option>
                                                <option value="number">Number</option>
                                                <option value="integer">Integer</option>
                                                <option value="boolean">Boolean</option>
                                                <option value="array">Array</option>
                                            </select>
                                        </div>

                                        <div className="flex items-end">
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={newParam.required || false}
                                                    onChange={(e) => setNewParam({ ...newParam, required: e.target.checked })}
                                                    className="w-4 h-4 text-orange-600 rounded focus:ring-orange-500"
                                                />
                                                <span className="text-sm font-medium text-gray-700">Required</span>
                                            </label>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Description
                                        </label>
                                        <input
                                            type="text"
                                            value={newParam.description || ''}
                                            onChange={(e) => setNewParam({ ...newParam, description: e.target.value })}
                                            placeholder="Parameter description"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                        />
                                    </div>

                                    <button
                                        onClick={handleAddParameter}
                                        disabled={!newParam.name.trim()}
                                        className="w-full px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
                                    >
                                        Add Parameter
                                    </button>
                                </div>
                            )}

                            {/* Parameter List */}
                            {(!editedEndpoint.parameters || editedEndpoint.parameters.length === 0) ? (
                                <div className="text-center py-8 text-gray-500">
                                    <p className="text-sm">No parameters defined</p>
                                    <p className="text-xs mt-1">Click "Add Parameter" to add one</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {editedEndpoint.parameters.map((param, index) => (
                                        <div key={index} className="p-4 border border-gray-200 rounded-lg bg-gray-50">
                                            <div className="flex items-start justify-between mb-3">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <code className="font-mono text-sm font-bold text-gray-900">{param.name}</code>
                                                        <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                                                            {param.in}
                                                        </span>
                                                        {param.required && (
                                                            <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded">
                                                                required
                                                            </span>
                                                        )}
                                                        <span className="text-xs text-gray-500">
                                                            {param.schema?.type || 'string'}
                                                        </span>
                                                    </div>
                                                    <p className="text-sm text-gray-600">{param.description || 'No description'}</p>
                                                </div>
                                                <button
                                                    onClick={() => handleRemoveParameter(index)}
                                                    className="ml-4 text-red-600 hover:text-red-700 text-sm font-medium"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-200 flex justify-end gap-3 bg-gray-50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 font-medium"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-medium"
                    >
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
}
