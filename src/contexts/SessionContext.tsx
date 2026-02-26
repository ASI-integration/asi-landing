'use client';

import { createContext, useContext, useState, useCallback, useEffect } from 'react';

type Session = {
  user: { id: string; email: string };
  subscription: { status: string } | null;
};

const SessionContext = createContext<{
  session: Session | null;
  loading: boolean;
  refresh: () => Promise<void>;
} | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/auth/session');
    const data = await res.json();
    if (data.user) {
      setSession({ user: data.user, subscription: data.subscription });
    } else {
      setSession(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  return (
    <SessionContext.Provider value={{ session, loading, refresh }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
