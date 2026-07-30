'use client';

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { readResponseJson } from '@/lib/safeResponseJson';

type Session = {
  user: { id: string; email: string };
  subscription: { status: string } | null;
  account: {
    id: string;
    name: string;
    plan_code: string;
    subscription_status: string;
    trial_started_at: string | null;
    trial_ends_at: string | null;
  } | null;
  isCrmOperator?: boolean;
  isDevelopmentOwner?: boolean;
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
    try {
      const res = await fetch('/api/auth/session');
      const data = await readResponseJson(res, {
        user: null as Session['user'] | null,
        subscription: null as Session['subscription'] | null,
        account: null as Session['account'] | null,
        isCrmOperator: false,
        isDevelopmentOwner: false,
      });
      if (data.user) {
        setSession({
          user: data.user,
          subscription: data.subscription,
          account: data.account ?? null,
          isCrmOperator: data.isCrmOperator === true,
          isDevelopmentOwner: data.isDevelopmentOwner === true,
        });
      } else {
        setSession(null);
      }
    } catch {
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
