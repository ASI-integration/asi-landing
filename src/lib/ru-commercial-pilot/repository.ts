import { supabase } from '@/lib/supabase';
import {
  emptyTimestamps,
  type RuCommercialPilotState,
  type RuCommercialPilotStatus,
  type RuCommercialPilotTimestamps,
} from './lifecycle';
import type { OwnershipProbe, ReadinessProbe, RuCommercialPilotStore } from './service';
import { getPilotReadinessForProperty } from '@/lib/pilot-readiness/repository';

type LifecycleRow = {
  account_id: string;
  property_id: string;
  status: RuCommercialPilotStatus;
  setup_started_at: string | null;
  ready_at: string | null;
  pilot_started_at: string | null;
  pilot_ends_at: string | null;
  pilot_completed_at: string | null;
  report_ready_at: string | null;
  continuation_decided_at: string | null;
};

function parseTs(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function rowToState(row: LifecycleRow): RuCommercialPilotState {
  const timestamps: RuCommercialPilotTimestamps = {
    setupStartedAt: parseTs(row.setup_started_at),
    readyAt: parseTs(row.ready_at),
    pilotStartedAt: parseTs(row.pilot_started_at),
    pilotEndsAt: parseTs(row.pilot_ends_at),
    pilotCompletedAt: parseTs(row.pilot_completed_at),
    reportReadyAt: parseTs(row.report_ready_at),
    continuationDecidedAt: parseTs(row.continuation_decided_at),
  };
  return {
    accountId: row.account_id,
    propertyId: row.property_id,
    status: row.status,
    timestamps,
  };
}

function stateToRow(state: RuCommercialPilotState): Omit<LifecycleRow, never> & {
  updated_at: string;
} {
  return {
    account_id: state.accountId,
    property_id: state.propertyId,
    status: state.status,
    setup_started_at: toIso(state.timestamps.setupStartedAt),
    ready_at: toIso(state.timestamps.readyAt),
    pilot_started_at: toIso(state.timestamps.pilotStartedAt),
    pilot_ends_at: toIso(state.timestamps.pilotEndsAt),
    pilot_completed_at: toIso(state.timestamps.pilotCompletedAt),
    report_ready_at: toIso(state.timestamps.reportReadyAt),
    continuation_decided_at: toIso(state.timestamps.continuationDecidedAt),
    updated_at: new Date().toISOString(),
  };
}

export function createSupabaseRuCommercialPilotStore(): RuCommercialPilotStore {
  return {
    async get(accountId, propertyId) {
      const { data, error } = await supabase
        .from('ru_commercial_pilot_lifecycle')
        .select('*')
        .eq('account_id', accountId)
        .eq('property_id', propertyId)
        .maybeSingle();
      if (error || !data) return null;
      return rowToState(data as LifecycleRow);
    },

    async compareAndSet(accountId, propertyId, expectedStatus, next) {
      if (expectedStatus === null) {
        const { error } = await supabase.from('ru_commercial_pilot_lifecycle').insert(stateToRow(next));
        return !error;
      }
      const { data, error } = await supabase
        .from('ru_commercial_pilot_lifecycle')
        .update(stateToRow(next))
        .eq('account_id', accountId)
        .eq('property_id', propertyId)
        .eq('status', expectedStatus)
        .select('account_id')
        .maybeSingle();
      if (error) return false;
      return Boolean(data);
    },

    async upsertIfAbsent(state) {
      const existing = await this.get(state.accountId, state.propertyId);
      if (existing) return existing;
      const { error } = await supabase.from('ru_commercial_pilot_lifecycle').insert(stateToRow(state));
      if (error) {
        const again = await this.get(state.accountId, state.propertyId);
        if (again) return again;
        throw new Error(error.message);
      }
      return state;
    },
  };
}

/**
 * Ownership: property must belong to account via multitenant `properties` table.
 * property_id is stored as text; matches properties.id::text.
 */
export const supabaseOwnsProperty: OwnershipProbe = async (accountId, propertyId) => {
  const { data, error } = await supabase
    .from('properties')
    .select('id')
    .eq('account_id', accountId)
    .eq('id', propertyId)
    .maybeSingle();
  if (error || !data) return false;
  return true;
};

export const supabaseReadinessProbe: ReadinessProbe = async (propertyId) => {
  const result = await getPilotReadinessForProperty(propertyId);
  return result?.ready === true;
};

export function emptyLifecycleState(
  accountId: string,
  propertyId: string,
  status: RuCommercialPilotStatus = 'application',
): RuCommercialPilotState {
  return { accountId, propertyId, status, timestamps: emptyTimestamps() };
}
