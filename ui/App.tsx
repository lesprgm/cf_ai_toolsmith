import { useCallback, useState } from 'react';
import ChatPage from './pages/chat';
import SkillsPage from './pages/skills';
import { SessionProvider } from './context/SessionContext';

type AppView = 'skills' | 'chat';

function getInitialView(): AppView {
  if (typeof window === 'undefined') {
    return 'skills';
  }
  const hash = window.location.hash;
  if (hash === '#/chat') return 'chat';
  return 'skills';
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
    { id: 'skills' as AppView, label: 'Skills' },
    { id: 'chat' as AppView, label: 'Chat' },
  ];

  return (
    <nav className="bg-gradient-to-r from-orange-600 via-orange-500 to-orange-600 shadow-lg sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo/Brand */}
          <div className="flex-shrink-0">
            <button
              onClick={() => onNavigate('skills')}
              className="text-2xl font-bold text-white hover:opacity-90 transition-opacity flex items-center gap-2"
              aria-label="Go to skills page"
            >
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
              </svg>
              CF ToolSmith
            </button>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden sm:flex sm:items-center sm:space-x-1">
            {navLinks.map((link) => (
              <button
                key={link.id + link.label}
                onClick={() => onNavigate(link.id)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${current === link.id
                    ? 'bg-white text-orange-600 shadow-md'
                    : 'text-white hover:bg-orange-400'
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
              className="inline-flex items-center justify-center p-2 rounded-md text-white hover:bg-orange-400 focus:outline-none"
              aria-expanded={isMobileMenuOpen ? 'true' : 'false'}
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
        <div className="sm:hidden border-t border-orange-400">
          <div className="px-2 pt-2 pb-2 space-y-1">
            {navLinks.map((link) => (
              <button
                key={link.id + link.label}
                onClick={() => {
                  onNavigate(link.id);
                  setIsMobileMenuOpen(false);
                }}
                className={`block w-full text-left px-3 py-2 rounded text-sm font-medium transition-colors ${current === link.id
                    ? 'bg-white text-orange-600'
                    : 'text-white hover:bg-orange-400'
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
        if (next === 'chat') {
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
      <Navigation current={view} onNavigate={navigate} />
      <main className={`bg-slate-50 min-h-screen transition-opacity duration-150 ${isTransitioning ? 'opacity-50' : 'opacity-100'
        }`}>
        {view === 'chat' ? (
          <ChatPage />
        ) : (
          <SkillsPage />
        )}
      </main>
    </SessionProvider>
  );
}
