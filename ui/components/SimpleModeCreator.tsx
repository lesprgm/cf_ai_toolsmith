import React, { useState } from 'react';

interface SimpleModeCreatorProps {
    onGenerate: (apiName: string, intent: string) => Promise<void>;
    onSwitchMode?: () => void;
    isGenerating?: boolean;
}

const POPULAR_APIS = [
    { name: 'Stripe', category: 'Payments' },
    { name: 'GitHub', category: 'Development' },
    { name: 'Google Maps', category: 'Location' },
    { name: 'OpenAI', category: 'AI' },
];

export default function SimpleModeCreator({
    onGenerate,
    onSwitchMode,
    isGenerating = false,
}: SimpleModeCreatorProps): JSX.Element {
    const [apiName, setApiName] = useState('');
    const [intent, setIntent] = useState('');
    const [suggestions, setSuggestions] = useState<string[]>([]);

    const handleApiNameChange = (value: string) => {
        setApiName(value);

        // Show suggestions as user types
        if (value.length > 1) {
            const matches = POPULAR_APIS
                .filter(api => api.name.toLowerCase().includes(value.toLowerCase()))
                .map(api => api.name);
            setSuggestions(matches);
        } else {
            setSuggestions([]);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (apiName.trim() && intent.trim()) {
            await onGenerate(apiName.trim(), intent.trim());
        }
    };

    const handleQuickSelect = (api: string) => {
        setApiName(api);
        setSuggestions([]);
    };

    return (
        <div className="max-w-3xl mx-auto">
            <div className="bg-white rounded-lg shadow-lg border border-slate-200">
                <div className="p-8">
                    <div className="text-center mb-8">
                        <h2 className="text-3xl font-bold text-slate-900 mb-2">
                            Create API Connector
                        </h2>
                        <p className="text-slate-600">
                            Describe what you want to do in plain English - no coding required
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* API Name Input */}
                        <div>
                            <label htmlFor="api-name" className="block text-sm font-medium text-slate-700 mb-2">
                                What API do you want to use?
                            </label>
                            <div className="relative">
                                <input
                                    id="api-name"
                                    type="text"
                                    value={apiName}
                                    onChange={(e) => handleApiNameChange(e.target.value)}
                                    placeholder="e.g., Stripe, GitHub, Twilio"
                                    disabled={isGenerating}
                                    className="w-full px-4 py-3 border border-slate-300 rounded-lg text-lg focus:ring-2 focus:ring-cloudflare-orange focus:border-transparent disabled:bg-slate-50 disabled:text-slate-500"
                                />

                                {/* Suggestions dropdown */}
                                {suggestions.length > 0 && (
                                    <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-lg shadow-lg">
                                        {suggestions.map((suggestion) => (
                                            <button
                                                key={suggestion}
                                                type="button"
                                                onClick={() => handleQuickSelect(suggestion)}
                                                className="w-full px-4 py-2 text-left hover:bg-slate-50 first:rounded-t-lg last:rounded-b-lg"
                                            >
                                                {suggestion}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Intent Input */}
                        <div>
                            <label htmlFor="intent" className="block text-sm font-medium text-slate-700 mb-2">
                                What do you want to do with it?
                            </label>
                            <textarea
                                id="intent"
                                value={intent}
                                onChange={(e) => setIntent(e.target.value)}
                                placeholder="e.g., I want to charge credit cards and send email receipts to customers"
                                disabled={isGenerating}
                                className="w-full px-4 py-3 border border-slate-300 rounded-lg text-lg h-32 focus:ring-2 focus:ring-cloudflare-orange focus:border-transparent resize-none disabled:bg-slate-50 disabled:text-slate-500"
                            />
                            <p className="mt-2 text-xs text-slate-500">
                                Be as specific as possible about what you want to accomplish
                            </p>
                        </div>

                        {/* Generate Button */}
                        <button
                            type="submit"
                            disabled={!apiName.trim() || !intent.trim() || isGenerating}
                            className="w-full bg-cloudflare-orange text-white py-4 rounded-lg text-lg font-semibold hover:bg-orange-600 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                        >
                            {isGenerating ? (
                                <>
                                    <span className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-white"></span>
                                    Generating Connector...
                                </>
                            ) : (
                                'Generate Connector'
                            )}
                        </button>
                    </form>

                    {/* Popular APIs Section */}
                    <div className="mt-8 pt-8 border-t border-slate-200">
                        <p className="text-sm font-medium text-slate-700 mb-3">
                            Or try these popular APIs:
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {POPULAR_APIS.map((api) => (
                                <button
                                    key={api.name}
                                    type="button"
                                    onClick={() => handleQuickSelect(api.name)}
                                    disabled={isGenerating}
                                    className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 hover:border-slate-300 text-sm font-medium text-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <div className="font-semibold">{api.name}</div>
                                    <div className="text-xs text-slate-500">{api.category}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Switch to Developer Mode */}
                    {onSwitchMode && (
                        <div className="mt-6 text-center">
                            <p className="text-sm text-slate-600">
                                Have an OpenAPI spec?{' '}
                                <button
                                    type="button"
                                    onClick={onSwitchMode}
                                    className="text-cloudflare-orange hover:text-orange-600 font-medium underline"
                                >
                                    Switch to Developer Mode
                                </button>
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
