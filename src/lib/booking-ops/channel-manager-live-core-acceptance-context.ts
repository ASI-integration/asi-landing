/**
 * Narrow acceptance-only create context.
 * Attaches harness ownership metadata during Booking Ops creation without
 * changing normal non-harness import behavior.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
  LIVE_CORE_ACCEPTANCE_HARNESS,
  LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
} from './channel-manager-live-core-acceptance-constants';

export type LiveCoreAcceptanceCreateContext = {
  acceptanceHarness: typeof LIVE_CORE_ACCEPTANCE_HARNESS;
  acceptanceExecutionId: string;
  importRunId?: string | null;
  reservationMetadata: Record<string, unknown>;
};

const storage = new AsyncLocalStorage<LiveCoreAcceptanceCreateContext>();

export function buildLiveCoreAcceptanceReservationMetadata(input: {
  acceptanceExecutionId: string;
  importRunId?: string | null;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    acceptanceHarness: LIVE_CORE_ACCEPTANCE_HARNESS,
    acceptanceExecutionId: input.acceptanceExecutionId,
    acceptance_safe: true,
    test_reservation: true,
    environment: 'test',
    synthetic: true,
    kind: 'booking_ops',
    ...(input.importRunId ? { importRunId: input.importRunId } : {}),
    ...(input.extra ?? {}),
  };
}

export function runWithLiveCoreAcceptanceCreateContext<T>(
  context: LiveCoreAcceptanceCreateContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(context, fn);
}

export function getLiveCoreAcceptanceCreateContext(): LiveCoreAcceptanceCreateContext | null {
  return storage.getStore() ?? null;
}

/**
 * Returns harness reservation_metadata only when the create target matches the
 * deterministic acceptance identity. Never attaches markers to unrelated bookings.
 */
export function resolveAcceptanceReservationMetadataForCreate(input: {
  propertyId?: string | null;
  bookingId?: string | null;
  explicit?: Record<string, unknown> | null;
}): Record<string, unknown> | null {
  const propertyId = String(input.propertyId ?? '').trim();
  const bookingId = String(input.bookingId ?? '').trim();
  if (
    propertyId !== LIVE_CORE_ACCEPTANCE_PROPERTY_ID
    || bookingId !== LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID
  ) {
    return null;
  }

  if (input.explicit && typeof input.explicit === 'object') {
    if (input.explicit.acceptanceHarness === LIVE_CORE_ACCEPTANCE_HARNESS) {
      return { ...input.explicit };
    }
  }

  const ctx = getLiveCoreAcceptanceCreateContext();
  if (!ctx || ctx.acceptanceHarness !== LIVE_CORE_ACCEPTANCE_HARNESS) return null;
  return { ...ctx.reservationMetadata };
}
