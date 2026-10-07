/**
 * SP-09 — resolve asi-os-runtime events module for Telegram matrix proof.
 * Landing CI remains green using the local contract; runtime import deepens proof when present.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type OwnerTelegramEventsModule = {
  TASK_EVENTS: Record<string, string>;
  STRIGUNOV_PILOT_TELEGRAM_PROFILE: string;
  isNotifiableEvent: (event: string, options?: { profile?: string; payload?: object }) => boolean;
  isExplicitHitlPayload: (payload?: object) => boolean;
};

const LANDING_TASK_EVENTS = Object.freeze({
  TASK_STARTED: 'TASK_STARTED',
  FIXING_STARTED: 'FIXING_STARTED',
  REVIEW_FINDINGS: 'REVIEW_FINDINGS',
  READY_FOR_OWNER: 'READY_FOR_OWNER',
  BLOCKED: 'BLOCKED',
  FAILED: 'FAILED',
});

export function resolveAsiOsRuntimeRoot(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const candidates = [
    env.ASI_OS_RUNTIME_ROOT,
    path.resolve(cwd, '../asi-os-runtime'),
    path.resolve(cwd, '../../asi-os-runtime'),
    'C:\\asi-os-runtime',
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  for (const root of candidates) {
    if (existsSync(path.join(root, 'lib', 'agent-ops', 'events.mjs'))) {
      return root;
    }
  }
  return null;
}

/**
 * Landing-owned strigunov_pilot_v1 notify matrix.
 * Used when asi-os-runtime is not checked out (GitHub Actions for this repo).
 * Semantics are independent of STRIGUNOV_PILOT_TELEGRAM_MATRIX so the
 * acceptance stages remain a real spec-vs-implementation check.
 */
function isLandingExplicitHitlPayload(payload?: object): boolean {
  if (payload == null || typeof payload !== 'object') return false;
  return (payload as { ownerMergeGate?: unknown }).ownerMergeGate === true;
}

export function getLandingStrigunovPilotTelegramEvents(): OwnerTelegramEventsModule {
  return {
    TASK_EVENTS: { ...LANDING_TASK_EVENTS },
    STRIGUNOV_PILOT_TELEGRAM_PROFILE: 'strigunov_pilot_v1',
    isExplicitHitlPayload: isLandingExplicitHitlPayload,
    isNotifiableEvent(event, options = {}) {
      const profile = options.profile ?? 'strigunov_pilot_v1';
      if (profile !== 'strigunov_pilot_v1') return false;
      if (event === LANDING_TASK_EVENTS.BLOCKED || event === LANDING_TASK_EVENTS.FAILED) {
        return true;
      }
      if (event === LANDING_TASK_EVENTS.READY_FOR_OWNER) {
        return isLandingExplicitHitlPayload(options.payload);
      }
      return false;
    },
  };
}

export async function importRuntimeOwnerTelegramEvents(
  cwd?: string,
): Promise<OwnerTelegramEventsModule | null> {
  const root = resolveAsiOsRuntimeRoot(cwd);
  if (!root) return null;
  const file = path.join(root, 'lib', 'agent-ops', 'events.mjs');
  return import(pathToFileURL(file).href) as Promise<OwnerTelegramEventsModule>;
}

export async function loadStrigunovPilotTelegramEvents(
  cwd?: string,
): Promise<OwnerTelegramEventsModule> {
  return (await importRuntimeOwnerTelegramEvents(cwd)) ?? getLandingStrigunovPilotTelegramEvents();
}
