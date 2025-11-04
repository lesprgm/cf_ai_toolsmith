import { useCallback, useState } from 'react';
import WorkflowPage from './pages/index';
import InsightsPage from './pages/insights';
import ChatPage from './pages/chat';
import EditorPage from './pages/editor';
import MonitoringPage from './pages/monitoring';
import { SessionProvider } from './context/SessionContext';
import { WorkflowProvider } from './context/WorkflowContext';

type AppView = 'workflow' | 'editor' | 'monitoring' | 'chat' | 'insights';

function getInitialView(): AppView {
  if (typeof window === 'undefined') {
    return 'workflow';
  }
  const hash = window.location.hash;
  if (hash === '#/editor') return 'editor';
  if (hash === '#/monitoring') return 'monitoring';
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

  const navLinks = [
    { id: 'workflow' as AppView, label: 'Workflow' },
    { id: 'editor' as AppView, label: 'Editor' },
    { id: 'monitoring' as AppView, label: 'Monitoring' },
    { id: 'chat' as AppView, label: 'Chat' },
    { id: 'insights' as AppView, label: 'Insights' },
  ];

  return (
    <nav className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-14">
          {/* Logo/Brand */}
          <div className="flex-shrink-0">
            <h1 className="text-lg font-bold">
              <span className="bg-gradient-to-r from-orange-500 to-orange-600 bg-clip-text text-transparent">
                CF
              </span>
              <span className="text-slate-900"> ToolSmith</span>
            </h1>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden sm:flex sm:items-center sm:space-x-1">
            {navLinks.map((link) => (
              <button
                key={link.id}
                onClick={() => onNavigate(link.id)}
                className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${current === link.id
                    ? 'bg-orange-500 text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                  }`}
                aria-current={current === link.id ? 'page' : undefined}
              >
                {link.label}
              </button>
            ))}
          </div>

          {/* Mobile menu button */}
          <div className="flex items-center sm:hidden">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="inline-flex items-center justify-center p-2 rounded-md text-slate-700 hover:bg-slate-100 focus:outline-none"
              aria-expanded={isMobileMenuOpen}
              aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
            >
              {isMobileMenuOpen ? (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {isMobileMenuOpen && (
        <div className="sm:hidden border-t border-slate-200">
          <div className="px-2 pt-2 pb-2 space-y-1">
            {navLinks.map((link) => (
              <button
                key={link.id}
                onClick={() => {
                  onNavigate(link.id);
                  setIsMobileMenuOpen(false);
                }}
                className={`block w-full text-left px-3 py-2 rounded text-sm font-medium transition-colors ${current === link.id
                    ? 'bg-orange-500 text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                  }`}
                aria-current={current === link.id ? 'page' : undefined}
              >
                {link.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}

export default function App(): JSX.Element {
  const [view, setView] = useState<AppView>(getInitialView);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const navigate = useCallback((next: AppView) => {
    if (next === view) return;

    setIsTransitioning(true);

    // Small delay for visual feedback
    setTimeout(() => {
      setView(next);
      if (typeof window !== 'undefined') {
        if (next === 'insights') {
          window.location.hash = '#/insights';
        } else if (next === 'editor') {
          window.location.hash = '#/editor';
        } else if (next === 'monitoring') {
          window.location.hash = '#/monitoring';
        } else if (next === 'chat') {
          window.location.hash = '#/chat';
        } else {
          window.location.hash = '';
        }
      }
      setIsTransitioning(false);
    }, 150);
  }, [view]);

  return (
    <SessionProvider>
      <WorkflowProvider>
        <Navigation current={view} onNavigate={navigate} />
        <main className={`bg-slate-50 min-h-screen transition-opacity duration-150 ${isTransitioning ? 'opacity-50' : 'opacity-100'
          }`}>
          {view === 'workflow' ? (
            <WorkflowPage onNavigate={navigate} />
          ) : view === 'editor' ? (
            <EditorPage onNavigate={navigate} />
          ) : view === 'monitoring' ? (
            <MonitoringPage />
          ) : view === 'chat' ? (
            <ChatPage />
          ) : (
            <InsightsPage onNavigate={navigate} />
          )}
        </main>
      </WorkflowProvider>
    </SessionProvider>
  );
}
