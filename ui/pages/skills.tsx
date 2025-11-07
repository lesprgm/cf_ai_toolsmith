import React, { useState, useEffect } from 'react';
import { useSession } from '../context/SessionContext';
import { Bot, CheckCircle2, FileText, Upload, RefreshCw, Loader2, Trash2, Plus, X, Folder, FileCode } from 'lucide-react';
import { parse as parseYaml } from 'yaml';

interface RegisteredAPI {
    apiName: string;
    baseUrl: string;
    skillCount: number;
    skillNames: string[];
    registeredAt: string;
    metadata?: {
        title?: string;
        version?: string;
        description?: string;
    };
}

declare const window: any;

const API_BASE = ((import.meta as any).env?.VITE_WORKER_BASE_URL as string | undefined)?.replace(/\/$/, '') || '';

function showAlert(msg: string) {
    if (typeof window !== 'undefined' && window.alert) {
        window.alert(msg);
    } else {
        console.warn('Alert:', msg);
    }
}

export default function SkillsPage() {
    const { sessionId } = useSession();
    const [apis, setApis] = useState<RegisteredAPI[]>([]);
    const [loading, setLoading] = useState(false);
    const [registering, setRegistering] = useState(false);
    const [showRegisterForm, setShowRegisterForm] = useState(false);

    const [apiName, setApiName] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [specInput, setSpecInput] = useState('');
    const [specFile, setSpecFile] = useState<File | null>(null);

    useEffect(() => {
        fetchSkills();
    }, []);

    const fetchSkills = async () => {
        setLoading(true);
        try {
            const response = await fetch(`${API_BASE}/api/skills/list`, {
                headers: {
                    'X-User-ID': sessionId
                }
            });
            const data = await response.json() as any;
            if (data.apis) {
                setApis(data.apis);
            }
        } catch (error) {
            console.error('Failed to fetch skills:', error);
            showAlert('Failed to load registered skills');
        } finally {
            setLoading(false);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSpecFile(file);
            const reader = new FileReader();
            reader.onload = (event) => {
                const content = event.target?.result as string;
                setSpecInput(content);

                // Try to extract API name from the file content
                try {
                    let parsed;
                    const isYaml = file.name.endsWith('.yaml') || file.name.endsWith('.yml');

                    if (isYaml) {
                        parsed = parseYaml(content);
                    } else {
                        try {
                            parsed = JSON.parse(content);
                        } catch {
                            // Maybe it's YAML without .yaml extension
                            parsed = parseYaml(content);
                        }
                    }

                    if (parsed?.info?.title && !apiName) {
                        setApiName(parsed.info.title);
                    }
                } catch (err) {
                    console.log('Could not auto-extract API name:', err);
                }
            };
            reader.readAsText(file);
        }
    };

    const handleRegister = async () => {
        if (!apiName.trim()) {
            showAlert('Please enter an API name');
            return;
        }

        if (!specInput.trim()) {
            showAlert('Please provide an OpenAPI spec (paste JSON/YAML or upload file)');
            return;
        }

        setRegistering(true);
        try {
            // Parse spec - handle both JSON and YAML
            let spec;
            try {
                spec = JSON.parse(specInput);
            } catch (jsonError) {
                // Try YAML parsing
                try {
                    spec = parseYaml(specInput);
                    if (!spec) {
                        throw new Error('YAML parsing returned null');
                    }
                } catch (yamlError) {
                    showAlert('Invalid JSON or YAML in OpenAPI spec. Please check your file format.');
                    return;
                }
            }

            // Validate it's an OpenAPI spec
            if (!spec.openapi && !spec.swagger) {
                showAlert('Not a valid OpenAPI/Swagger specification. Missing "openapi" or "swagger" field.');
                return;
            }

            // Check spec size (rough estimate: 5MB limit)
            const specSize = JSON.stringify(spec).length;
            if (specSize > 5 * 1024 * 1024) {
                showAlert(`Spec is too large (${(specSize / 1024 / 1024).toFixed(2)}MB). Maximum is 5MB.`);
                return;
            }

            const response = await fetch(`${API_BASE}/api/skills/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': sessionId
                },
                body: JSON.stringify({
                    apiName: apiName.trim(),
                    spec,
                    apiKey: apiKey.trim()
                })
            });

            const result = await response.json() as any;

            if (response.ok && result.success) {
                showAlert(`Success! Registered ${result.skillCount} skills for ${apiName}`);
                // Reset form
                setApiName('');
                setApiKey('');
                setSpecInput('');
                setSpecFile(null);
                setShowRegisterForm(false);
                // Refresh list
                fetchSkills();
            } else {
                showAlert(`Failed: ${result.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Registration error:', error);
            showAlert(`Error: ${(error as Error).message}`);
        } finally {
            setRegistering(false);
        }
    };

    const handleDelete = async (apiName: string) => {
        if (!window.confirm(`Delete ${apiName} and all its skills?`)) {
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/api/skills/delete`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': sessionId
                },
                body: JSON.stringify({ apiName })
            });

            const result = await response.json() as any;

            if (response.ok && result.success) {
                showAlert(`Deleted ${apiName}`);
                fetchSkills();
            } else {
                showAlert(`Failed: ${result.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Delete error:', error);
            showAlert(`Error: ${(error as Error).message}`);
        }
    };

    const loadExampleSpec = (apiType: string) => {
        let exampleSpec: any;
        let name: string;

        switch (apiType) {
            case 'jsonplaceholder':
                name = 'JSONPlaceholder';
                exampleSpec = {
                    openapi: "3.0.0",
                    info: {
                        title: "JSONPlaceholder API",
                        version: "1.0.0",
                        description: "Free fake REST API for testing and prototyping"
                    },
                    servers: [{ url: "https://jsonplaceholder.typicode.com" }],
                    paths: {
                        "/posts": {
                            get: {
                                operationId: "listPosts",
                                summary: "Get all posts",
                                responses: { "200": { description: "Success" } }
                            }
                        },
                        "/posts/{id}": {
                            get: {
                                operationId: "getPost",
                                summary: "Get a post by ID",
                                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                                responses: { "200": { description: "Success" } }
                            }
                        },
                        "/users": {
                            get: {
                                operationId: "listUsers",
                                summary: "Get all users",
                                responses: { "200": { description: "Success" } }
                            }
                        },
                        "/users/{id}": {
                            get: {
                                operationId: "getUser",
                                summary: "Get a user by ID",
                                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                                responses: { "200": { description: "Success" } }
                            }
                        }
                    }
                };
                break;

            case 'coindesk':
                name = 'CoinDesk Bitcoin Price';
                exampleSpec = {
                    openapi: "3.0.0",
                    info: {
                        title: "CoinDesk Bitcoin Price Index API",
                        version: "1.0.0",
                        description: "Real-time Bitcoin price data in multiple currencies"
                    },
                    servers: [{ url: "https://api.coindesk.com/v1" }],
                    paths: {
                        "/bpi/currentprice.json": {
                            get: {
                                operationId: "getCurrentBitcoinPrice",
                                summary: "Get current Bitcoin price index",
                                description: "Returns current BTC price in USD, GBP, and EUR",
                                responses: { "200": { description: "Success" } }
                            }
                        },
                        "/bpi/currentprice/{currency}.json": {
                            get: {
                                operationId: "getBitcoinPriceByCurrency",
                                summary: "Get Bitcoin price in specific currency",
                                parameters: [{
                                    name: "currency",
                                    in: "path",
                                    required: true,
                                    schema: { type: "string" },
                                    description: "Currency code (e.g., USD, GBP, EUR)"
                                }],
                                responses: { "200": { description: "Success" } }
                            }
                        }
                    }
                };
                break;

            case 'weather':
                name = 'Open-Meteo Weather';
                exampleSpec = {
                    openapi: "3.0.0",
                    info: {
                        title: "Open-Meteo Weather API",
                        version: "1.0.0",
                        description: "Free weather API - no key required"
                    },
                    servers: [{ url: "https://api.open-meteo.com/v1" }],
                    paths: {
                        "/forecast": {
                            get: {
                                operationId: "getWeatherForecast",
                                summary: "Get weather forecast",
                                parameters: [
                                    { name: "latitude", in: "query", required: true, schema: { type: "number" } },
                                    { name: "longitude", in: "query", required: true, schema: { type: "number" } },
                                    { name: "current_weather", in: "query", schema: { type: "boolean" } }
                                ],
                                responses: { "200": { description: "Success" } }
                            }
                        }
                    }
                };
                break;

            case 'pokemon':
                name = 'PokéAPI';
                exampleSpec = {
                    openapi: "3.0.0",
                    info: {
                        title: "PokéAPI",
                        version: "2.0.0",
                        description: "Pokémon data API"
                    },
                    servers: [{ url: "https://pokeapi.co/api/v2" }],
                    paths: {
                        "/pokemon": {
                            get: {
                                operationId: "listPokemon",
                                summary: "List Pokémon",
                                parameters: [
                                    { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
                                    { name: "offset", in: "query", schema: { type: "integer", default: 0 } }
                                ],
                                responses: { "200": { description: "Success" } }
                            }
                        },
                        "/pokemon/{name}": {
                            get: {
                                operationId: "getPokemon",
                                summary: "Get Pokémon by name",
                                parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
                                responses: { "200": { description: "Success" } }
                            }
                        }
                    }
                };
                break;

            case 'opensky':
                name = 'OpenSky Network';
                exampleSpec = {
                    openapi: "3.0.0",
                    info: {
                        title: "OpenSky Network API",
                        version: "1.0.0",
                        description: "Real-time air traffic data - track flights worldwide"
                    },
                    servers: [{ url: "https://opensky-network.org" }],
                    paths: {
                        "/api/states/all": {
                            get: {
                                operationId: "getAllStates",
                                summary: "Get all current flight states",
                                description: "Retrieve state vectors for all aircraft currently tracked",
                                parameters: [
                                    {
                                        name: "lamin",
                                        in: "query",
                                        schema: { type: "number" },
                                        description: "Lower bound for latitude in decimal degrees"
                                    },
                                    {
                                        name: "lomin",
                                        in: "query",
                                        schema: { type: "number" },
                                        description: "Lower bound for longitude in decimal degrees"
                                    },
                                    {
                                        name: "lamax",
                                        in: "query",
                                        schema: { type: "number" },
                                        description: "Upper bound for latitude in decimal degrees"
                                    },
                                    {
                                        name: "lomax",
                                        in: "query",
                                        schema: { type: "number" },
                                        description: "Upper bound for longitude in decimal degrees"
                                    }
                                ],
                                responses: { "200": { description: "Success" } }
                            }
                        }
                    }
                };
                break;

            default:
                name = 'JSONPlaceholder';
                exampleSpec = {
                    openapi: "3.0.0",
                    info: {
                        title: "JSONPlaceholder API",
                        version: "1.0.0",
                        description: "Free fake API for testing"
                    },
                    servers: [{ url: "https://jsonplaceholder.typicode.com" }],
                    paths: {
                        "/posts": {
                            get: {
                                operationId: "listPosts",
                                summary: "Get all posts",
                                responses: { "200": { description: "Success" } }
                            }
                        }
                    }
                };
        }

        setSpecInput(JSON.stringify(exampleSpec, null, 2));
        setApiName(name);
        setApiKey(''); // Clear API key for public APIs
        setShowRegisterForm(true);
    };

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Header */}
                <div className="mb-6">
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">
                        Skills
                    </h1>
                    <p className="text-slate-600">
                        Register OpenAPI specs to give AI access to your APIs
                    </p>
                </div>

                {/* Quick Start - Public APIs */}
                {!showRegisterForm && (
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200 p-6 mb-6">
                        <div className="mb-4">
                            <h2 className="text-xl font-bold text-slate-900 mb-2">
                                Quick Start - No API Key Required
                            </h2>
                            <p className="text-slate-600 text-sm">
                                These public APIs work immediately with no authentication required. Perfect for testing!
                            </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            <button
                                onClick={() => loadExampleSpec('jsonplaceholder')}
                                className="text-left p-4 bg-white rounded-lg border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all group"
                            >
                                <div className="font-semibold text-slate-900 mb-1">JSONPlaceholder</div>
                                <div className="text-xs text-slate-600">Fake REST API for testing - posts, users, todos</div>
                                <div className="text-xs text-blue-600 mt-2 group-hover:underline">Try it →</div>
                            </button>

                            <button
                                onClick={() => loadExampleSpec('coindesk')}
                                className="text-left p-4 bg-white rounded-lg border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all group"
                            >
                                <div className="font-semibold text-slate-900 mb-1">CoinDesk Bitcoin Price</div>
                                <div className="text-xs text-slate-600">Real-time Bitcoin price in multiple currencies</div>
                                <div className="text-xs text-blue-600 mt-2 group-hover:underline">Try it →</div>
                            </button>

                            <button
                                onClick={() => loadExampleSpec('weather')}
                                className="text-left p-4 bg-white rounded-lg border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all group"
                            >
                                <div className="font-semibold text-slate-900 mb-1">Open-Meteo Weather</div>
                                <div className="text-xs text-slate-600">Free weather forecasts worldwide - no key needed</div>
                                <div className="text-xs text-blue-600 mt-2 group-hover:underline">Try it →</div>
                            </button>

                            <button
                                onClick={() => loadExampleSpec('pokemon')}
                                className="text-left p-4 bg-white rounded-lg border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all group"
                            >
                                <div className="font-semibold text-slate-900 mb-1">PokéAPI</div>
                                <div className="text-xs text-slate-600">Pokémon data - species, abilities, moves, and more</div>
                                <div className="text-xs text-blue-600 mt-2 group-hover:underline">Try it →</div>
                            </button>

                            <button
                                onClick={() => loadExampleSpec('opensky')}
                                className="text-left p-4 bg-white rounded-lg border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all group"
                            >
                                <div className="font-semibold text-slate-900 mb-1">OpenSky Network</div>
                                <div className="text-xs text-slate-600">Real-time flight tracking - aircraft positions worldwide</div>
                                <div className="text-xs text-blue-600 mt-2 group-hover:underline">Try it →</div>
                            </button>
                        </div>
                    </div>
                )}

                {/* Register Button */}
                {!showRegisterForm && (
                    <div className="mb-6">
                        <button
                            onClick={() => setShowRegisterForm(true)}
                            className="px-6 py-3 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 transition-colors flex items-center gap-2 shadow-sm"
                        >
                            <Plus className="w-5 h-5" /> Register New API
                        </button>
                    </div>
                )}

                {/* Registration Form */}
                {showRegisterForm && (
                    <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 mb-6">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-bold text-slate-900">Register New API</h2>
                            <button
                                onClick={() => setShowRegisterForm(false)}
                                className="text-slate-400 hover:text-slate-600 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>                        <div className="space-y-4">
                            {/* API Name */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2">
                                    API Name *
                                </label>
                                <input
                                    type="text"
                                    value={apiName}
                                    onChange={(e) => setApiName(e.target.value)}
                                    placeholder="e.g., GitHub, Airtable, Stripe"
                                    className="w-full px-4 py-2 border-2 border-slate-300 rounded-lg focus:border-orange-500 focus:outline-none"
                                />
                            </div>

                            {/* API Key */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2">
                                    API Key (Optional)
                                </label>
                                <input
                                    type="password"
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    placeholder="Your API token or key"
                                    className="w-full px-4 py-2 border-2 border-slate-300 rounded-lg focus:border-orange-500 focus:outline-none"
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    Used for authenticated API calls. Stored securely.
                                </p>
                            </div>

                            {/* OpenAPI Spec */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2">
                                    OpenAPI Specification (JSON or YAML) *
                                </label>
                                <div className="flex gap-2 mb-2">
                                    <button
                                        onClick={() => document.getElementById('file-upload')?.click()}
                                        className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors text-sm font-medium flex items-center gap-2"
                                    >
                                        <Folder className="w-4 h-4" /> Upload File
                                    </button>
                                    <button
                                        onClick={() => loadExampleSpec('jsonplaceholder')}
                                        className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors text-sm font-medium flex items-center gap-2"
                                    >
                                        <FileCode className="w-4 h-4" /> Load Example
                                    </button>
                                </div>
                                <input
                                    id="file-upload"
                                    type="file"
                                    accept=".json,.yaml,.yml"
                                    onChange={handleFileUpload}
                                    className="hidden"
                                    aria-label="Upload OpenAPI spec file (JSON or YAML)"
                                />
                                {specFile && (
                                    <p className="text-sm text-green-600 mb-2 flex items-center gap-2">
                                        <CheckCircle2 className="w-4 h-4" /> Loaded: {specFile.name}
                                    </p>
                                )}
                                <textarea
                                    value={specInput}
                                    onChange={(e) => setSpecInput(e.target.value)}
                                    placeholder='Paste OpenAPI JSON or YAML here, or upload a file...'
                                    className="w-full h-64 px-4 py-2 border-2 border-slate-300 rounded-lg focus:border-orange-500 focus:outline-none font-mono text-sm"
                                />
                            </div>

                            {/* Actions */}
                            <div className="flex gap-3">
                                <button
                                    onClick={handleRegister}
                                    disabled={registering}
                                    className="px-6 py-3 bg-orange-600 text-white rounded-lg font-semibold hover:bg-orange-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                    {registering ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" /> Registering...
                                        </>
                                    ) : (
                                        <>
                                            <Upload className="w-5 h-5" /> Register Skills
                                        </>
                                    )}
                                </button>
                                <button
                                    onClick={() => setShowRegisterForm(false)}
                                    className="px-6 py-3 bg-slate-200 text-slate-700 rounded-lg font-semibold hover:bg-slate-300 transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Registered APIs List */}
                <div className="bg-white rounded-xl border-2 border-slate-200 shadow-sm p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-2xl font-bold text-slate-900">Registered APIs</h2>
                        <button
                            onClick={fetchSkills}
                            disabled={loading}
                            className="text-orange-600 hover:text-orange-700 font-medium flex items-center gap-2"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
                        </button>
                    </div>

                    {loading && apis.length === 0 ? (
                        <div className="text-center py-12 text-slate-500">
                            Loading skills...
                        </div>
                    ) : apis.length === 0 ? (
                        <div className="text-center py-12">
                            <Bot className="w-16 h-16 mx-auto mb-4 text-slate-400" />
                            <h3 className="text-xl font-bold text-slate-900 mb-2">
                                No Skills Registered Yet
                            </h3>
                            <p className="text-slate-600 max-w-md mx-auto mb-6">
                                Register your first API to give AI access to external services.
                                Upload an OpenAPI spec to get started!
                            </p>
                            <button
                                onClick={() => setShowRegisterForm(true)}
                                className="px-6 py-3 bg-orange-600 text-white rounded-lg font-semibold hover:bg-orange-700 transition-colors"
                            >
                                Register Your First API
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {apis.map((api, idx) => (
                                <div
                                    key={idx}
                                    className="border-2 border-slate-200 rounded-lg p-4 hover:border-orange-300 transition-colors"
                                >
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex-1">
                                            <h3 className="text-lg font-bold text-slate-900">
                                                {api.apiName}
                                            </h3>
                                            {api.metadata?.title && (
                                                <p className="text-sm text-slate-600">{api.metadata.title}</p>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => handleDelete(api.apiName)}
                                            className="text-red-500 hover:text-red-700 font-medium text-sm flex items-center gap-1"
                                        >
                                            <Trash2 className="w-4 h-4" /> Delete
                                        </button>
                                    </div>

                                    <div className="text-sm text-slate-600 mb-3">
                                        <div className="font-mono text-xs bg-slate-50 px-2 py-1 rounded inline-block mb-2">
                                            {api.baseUrl}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4 text-sm">
                                        <span className="font-semibold text-orange-600">
                                            {api.skillCount} skills
                                        </span>
                                        {api.metadata?.version && (
                                            <span className="text-slate-500">v{api.metadata.version}</span>
                                        )}
                                        <span className="text-slate-400">
                                            {new Date(api.registeredAt).toLocaleDateString()}
                                        </span>
                                    </div>

                                    {/* Skills Preview */}
                                    {api.skillNames.length > 0 && (
                                        <details className="mt-3">
                                            <summary className="cursor-pointer text-sm font-medium text-slate-700 hover:text-orange-600">
                                                View {api.skillNames.length} skill{api.skillNames.length !== 1 ? 's' : ''}
                                            </summary>
                                            <div className="mt-2 pl-4 space-y-1">
                                                {api.skillNames.map((skillName, skillIdx) => (
                                                    <div key={skillIdx} className="text-sm text-slate-600 font-mono">
                                                        • {skillName}
                                                    </div>
                                                ))}
                                            </div>
                                        </details>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Instructions */}
                <div className="mt-8 bg-blue-50 border-2 border-blue-200 rounded-xl p-6">
                    <h3 className="text-lg font-bold text-blue-900 mb-3 flex items-center gap-2">
                        <FileText className="w-5 h-5" /> How to Use Skills
                    </h3>
                    <ol className="space-y-2 text-sm text-blue-800">
                        <li><strong>1. Register an API:</strong> Upload an OpenAPI spec and optionally provide an API key</li>
                        <li><strong>2. Go to Chat:</strong> Navigate to the AI Chat page</li>
                        <li><strong>3. Ask AI to Use Your APIs:</strong> Example: "List my GitHub repos" or "Get post #1 from JSONPlaceholder"</li>
                        <li><strong>4. AI Executes Skills:</strong> The AI will automatically use your registered skills to fulfill requests</li>
                    </ol>
                </div>
            </div>
        </div>
    );
}
