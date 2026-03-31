'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type TelemetryLogKind = 'ok' | 'info' | 'warn';

export interface TelemetryLogEntry {
  id: number;
  timestamp: string;
  badge: string;
  text: string;
  kind: TelemetryLogKind;
}

export interface LocationTelemetrySnapshot {
  evergreenIndex: number | null;
  magnetCount: number | null;
  competitorCount: number | null;
  demandTypeLabel: string | null;
  dataStatusLabel: string | null;
}

interface LocationTelemetryContextValue {
  entries: TelemetryLogEntry[];
  snapshot: LocationTelemetrySnapshot;
  pushLine: (entry: Omit<TelemetryLogEntry, 'id' | 'timestamp'>) => void;
  updateSnapshot: (patch: Partial<LocationTelemetrySnapshot>) => void;
  resetTelemetry: () => void;
}

const EMPTY_SNAPSHOT: LocationTelemetrySnapshot = {
  evergreenIndex: null,
  magnetCount: null,
  competitorCount: null,
  demandTypeLabel: null,
  dataStatusLabel: null,
};

const LocationTelemetryContext = createContext<LocationTelemetryContextValue | null>(null);

function makeTimestamp(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function LocationTelemetryProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<TelemetryLogEntry[]>([]);
  const [snapshot, setSnapshot] = useState<LocationTelemetrySnapshot>(EMPTY_SNAPSHOT);
  const nextId = useRef(0);

  const pushLine = useCallback((entry: Omit<TelemetryLogEntry, 'id' | 'timestamp'>) => {
    const id = nextId.current++;
    const timestamp = makeTimestamp(Date.now());
    setEntries(prev => [...prev.slice(-40), { ...entry, id, timestamp }]);
  }, []);

  const updateSnapshot = useCallback((patch: Partial<LocationTelemetrySnapshot>) => {
    setSnapshot(prev => ({ ...prev, ...patch }));
  }, []);

  const resetTelemetry = useCallback(() => {
    setEntries([]);
    setSnapshot(EMPTY_SNAPSHOT);
  }, []);

  const value = useMemo(
    () => ({ entries, snapshot, pushLine, updateSnapshot, resetTelemetry }),
    [entries, snapshot, pushLine, updateSnapshot, resetTelemetry],
  );

  return (
    <LocationTelemetryContext.Provider value={value}>
      {children}
    </LocationTelemetryContext.Provider>
  );
}

export function useLocationTelemetry(): LocationTelemetryContextValue {
  const ctx = useContext(LocationTelemetryContext);
  if (!ctx) {
    throw new Error('useLocationTelemetry must be used within LocationTelemetryProvider');
  }
  return ctx;
}

export function useLocationTelemetryOptional(): LocationTelemetryContextValue | null {
  return useContext(LocationTelemetryContext);
}
