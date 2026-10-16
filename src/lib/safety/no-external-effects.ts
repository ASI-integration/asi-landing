import { appendFileSync } from 'node:fs';

/** One-way safety interlock. Enabling this flag can only DENY external effects. */
export function guardExternalEffect(boundary: string): void {
  if (process.env.ASI_SYNTHETIC_NO_SEND !== 'YES') return;
  if (process.env.CI === 'true' && process.env.STRIGUNOV_SYNTHETIC_ONLY === 'YES') {
    const file = process.env.ASI_SYNTHETIC_CANARY === 'YES' ? 'effect-canary.ndjson' : 'effect-attempts.ndjson';
    appendFileSync(`finishline-results/${file}`, JSON.stringify({ boundary, pid: process.pid }) + '\n');
  }
  throw new Error('external_effects_disabled');
}
