import React, { createContext, useContext, useMemo, useState } from 'react';

interface SessionContextValue {
  sessionId: string;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

function generateSessionId(): string {
  return `session-${Date.now()}`;
}

export function SessionProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [sessionId] = useState<string>(() => {
    if (typeof window === 'undefined') {
      return generateSessionId();
    }
    const existing =
      window.sessionStorage.getItem('toolsmith-session') ||
      window.localStorage.getItem('toolsmith-session');
    if (existing) {
      return existing;
    }
    const newId = generateSessionId();
    window.sessionStorage.setItem('toolsmith-session', newId);
    window.localStorage.setItem('toolsmith-session', newId);
    return newId;
  });

  const value = useMemo<SessionContextValue>(() => ({ sessionId }), [sessionId]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
