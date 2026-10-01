import { createHash } from 'node:crypto';

/** Stable per-account first-pilot property identity. */
export function connectionPropertyId(accountId: string): string {
  const hash = createHash('sha256').update(`asi:ru-connect:v1:${accountId}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
