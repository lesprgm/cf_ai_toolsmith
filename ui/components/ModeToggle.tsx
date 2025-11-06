interface ModeToggleProps {
    mode: 'simple' | 'developer';
    onChange: (mode: 'simple' | 'developer') => void;
}

export default function ModeToggle({ mode, onChange }: ModeToggleProps): JSX.Element {
    return (
        <div className="inline-flex gap-1 bg-slate-100 rounded-lg p-1">
            <button
                type="button"
                onClick={() => onChange('simple')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${mode === 'simple'
                    ? 'bg-white shadow-sm text-slate-900'
                    : 'text-slate-600 hover:text-slate-900'
                    }`}
            >
                Simple Mode
            </button>
            <button
                type="button"
                onClick={() => onChange('developer')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${mode === 'developer'
                    ? 'bg-white shadow-sm text-slate-900'
                    : 'text-slate-600 hover:text-slate-900'
                    }`}
            >
                Developer Mode
            </button>
        </div>
    );
}
