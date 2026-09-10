/**
 * SP-09 — resolve asi-os-runtime events module for Telegram matrix proof.
 * Landing CI remains green using the local contract; runtime import deepens proof when present.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

export async function importRuntimeOwnerTelegramEvents(cwd?: string) {
  const root = resolveAsiOsRuntimeRoot(cwd);
  if (!root) return null;
  const file = path.join(root, 'lib', 'agent-ops', 'events.mjs');
  return import(pathToFileURL(file).href) as Promise<{
    TASK_EVENTS: Record<string, string>;
    STRIGUNOV_PILOT_TELEGRAM_PROFILE: string;
    isNotifiableEvent: (event: string, options?: { profile?: string; payload?: object }) => boolean;
    isExplicitHitlPayload: (payload?: object) => boolean;
  }>;
}
