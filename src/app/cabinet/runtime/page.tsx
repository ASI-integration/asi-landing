'use client';

import { useEffect, useState } from 'react';
import { CabinetRuntimeView } from './CabinetRuntimeView';
import type { AsiRuntimeStatusResponse, PublicAsiRuntimeSnapshot } from '@/lib/asi-runtime/types';

export default function CabinetRuntimePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<PublicAsiRuntimeSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/cabinet/runtime/status', { cache: 'no-store' });
        if (response.status === 401) {
          if (!cancelled) {
            setSnapshot(null);
            setError('Войдите, чтобы открыть Runtime.');
          }
          return;
        }
        const payload = (await response.json()) as AsiRuntimeStatusResponse | { ok: false; message: string };
        if (!response.ok || !payload.ok) {
          throw new Error('message' in payload ? payload.message : 'Не удалось загрузить статус Runtime.');
        }
        if (!cancelled) {
          setSnapshot('connected' in payload && payload.connected ? payload.snapshot : null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setSnapshot(null);
          setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить статус Runtime.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  return <CabinetRuntimeView loading={loading} error={error} snapshot={snapshot} />;
}
