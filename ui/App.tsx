import { useCallback, useState } from 'react';
import WorkflowPage from './pages/index';
import InsightsPage from './pages/insights';
import ChatPage from './pages/chat';
import { SessionProvider } from './context/SessionContext';

type AppView = 'workflow' | 'insights' | 'chat';

function getInitialView(): AppView {
  if (typeof window === 'undefined') {
    return 'workflow';
  }
  const hash = window.location.hash;
  if (hash === '#/insights') return 'insights';
  if (hash === '#/chat') return 'chat';
  return 'workflow';
}

function Navigation({
  current,
  onNavigate,
}: {
  current: AppView;
  onNavigate: (view: AppView) => void;
}): JSX.Element {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const buttonClasses = (view: AppView) =>
    [
      'px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 relative whitespace-nowrap',
      current === view
        ? 'bg-slate-900 text-white shadow-lg hover:bg-slate-800 hover:shadow-xl'
        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 border-2 border-slate-200 hover:border-slate-300 active:scale-[0.98] shadow-sm hover:shadow-md',
    ].join(' ');

  return (
    <nav className="fixed inset-x-0 top-0 z-50 bg-gradient-to-b from-white to-slate-50 border-b-2 border-slate-200 shadow-lg">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-5">
        <div className="flex items-center justify-between gap-8">
          <div className="flex items-center min-w-0">
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight whitespace-nowrap">
              <span className="bg-gradient-to-r from-orange-500 to-orange-600 bg-clip-text text-transparent">
                Cloudflare
              </span>
              <span className="text-slate-900"> AI ToolSmith</span>
            </h1>
          </div>

          <button
            type="button"
            className="lg:hidden p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle navigation menu"
            aria-expanded={isMobileMenuOpen ? 'true' : 'false'}
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {isMobileMenuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>

          <div className="hidden lg:flex items-center gap-4">
            <div className="flex items-center gap-3 px-3 py-2 bg-white rounded-xl border-2 border-slate-200 shadow-sm">
              <button
                type="button"
                className={buttonClasses('workflow')}
                onClick={() => onNavigate('workflow')}
                aria-current={current === 'workflow' ? 'page' : undefined}
              >
                Workflow
              </button>
              <div className="w-px h-8 bg-slate-300"></div>
              <button
                type="button"
                className={buttonClasses('chat')}
                onClick={() => onNavigate('chat')}
                aria-current={current === 'chat' ? 'page' : undefined}
              >
                Chat
              </button>
              <div className="w-px h-8 bg-slate-300"></div>
              <button
                type="button"
                className={buttonClasses('insights')}
                onClick={() => onNavigate('insights')}
                aria-current={current === 'insights' ? 'page' : undefined}
              >
                Insights & Settings
              </button>
            </div>
          </div>
        </div>

        {isMobileMenuOpen && (
          <div className="lg:hidden mt-4 pt-4 border-t-2 border-slate-200 space-y-2 animate-fade-in">
            <button
              type="button"
              className={`w-full ${buttonClasses('workflow')} justify-center`}
              onClick={() => {
                onNavigate('workflow');
                setIsMobileMenuOpen(false);
              }}
              aria-current={current === 'workflow' ? 'page' : undefined}
            >
              Workflow
            </button>
            <button
              type="button"
              className={`w-full ${buttonClasses('chat')} justify-center`}
              onClick={() => {
                onNavigate('chat');
                setIsMobileMenuOpen(false);
              }}
              aria-current={current === 'chat' ? 'page' : undefined}
            >
              Chat
            </button>
            <button
              type="button"
              className={`w-full ${buttonClasses('insights')} justify-center`}
              onClick={() => {
                onNavigate('insights');
                setIsMobileMenuOpen(false);
              }}
              aria-current={current === 'insights' ? 'page' : undefined}
            >
              Insights & Settings
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}

export default function App(): JSX.Element {
  const [view, setView] = useState<AppView>(getInitialView);

  const navigate = useCallback((next: AppView) => {
    setView(next);
    if (typeof window !== 'undefined') {
      if (next === 'insights') {
        window.location.hash = '#/insights';
      } else if (next === 'chat') {
        window.location.hash = '#/chat';
      } else {
        window.location.hash = '';
      }
    }
  }, []);

  return (
    <SessionProvider>
      <Navigation current={view} onNavigate={navigate} />
      <div className="h-20"></div>
      <main className="bg-slate-50 min-h-screen">
        {view === 'workflow' ? (
          <WorkflowPage onNavigate={navigate} />
        ) : view === 'chat' ? (
          <ChatPage />
        ) : (
          <InsightsPage onNavigate={navigate} />
        )}
      </main>
    </SessionProvider>
  );
}
