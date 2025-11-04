import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import React from 'react';
import WorkflowPage from './pages/index';
import InsightsPage from './pages/insights';
import { SessionProvider } from './context/SessionContext';

function Navigation(): JSX.Element {
  const linkClasses = ({ isActive }: { isActive: boolean }) =>
    [
      'px-3 py-2 rounded-md text-sm font-medium transition-colors',
      isActive
        ? 'bg-slate-900 text-white shadow'
        : 'text-slate-500 hover:text-slate-900 hover:bg-white/70',
    ].join(' ');

  return (
    <nav className="fixed inset-x-0 top-0 z-50 bg-slate-100/90 backdrop-blur border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        <span className="text-lg font-semibold text-slate-900">Cloudflare AI ToolSmith</span>
        <div className="flex items-center gap-2">
          <NavLink to="/" className={linkClasses} end>
            Workflow
          </NavLink>
          <NavLink to="/insights" className={linkClasses}>
            Insights & Settings
          </NavLink>
        </div>
      </div>
    </nav>
  );
}

export default function App(): JSX.Element {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Navigation />
        <main className="pt-24">
          <Routes>
            <Route path="/" element={<WorkflowPage />} />
            <Route path="/insights" element={<InsightsPage />} />
          </Routes>
        </main>
      </SessionProvider>
    </BrowserRouter>
  );
}
