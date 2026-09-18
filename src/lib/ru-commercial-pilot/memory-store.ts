import type { RuCommercialPilotState, RuCommercialPilotStatus } from './lifecycle';
import type { RuCommercialPilotStore } from './service';

function key(accountId: string, propertyId: string): string {
  return `${accountId}::${propertyId}`;
}

/** In-memory store for focused tests — simulates compare-and-set concurrency. */
export function createMemoryRuCommercialPilotStore(): RuCommercialPilotStore {
  const rows = new Map<string, RuCommercialPilotState>();

  return {
    async get(accountId, propertyId) {
      return rows.get(key(accountId, propertyId)) ?? null;
    },
    async compareAndSet(accountId, propertyId, expectedStatus, next) {
      const k = key(accountId, propertyId);
      const current = rows.get(k) ?? null;
      const currentStatus = current?.status ?? null;
      if (currentStatus !== expectedStatus) return false;
      rows.set(k, structuredClone(next));
      return true;
    },
    async upsertIfAbsent(state) {
      const k = key(state.accountId, state.propertyId);
      const existing = rows.get(k);
      if (existing) return structuredClone(existing);
      rows.set(k, structuredClone(state));
      return structuredClone(state);
    },
  };
}

export function cloneState(state: RuCommercialPilotState): RuCommercialPilotState {
  return structuredClone(state);
}

export type { RuCommercialPilotStatus };
