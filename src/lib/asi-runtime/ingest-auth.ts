import { timingSafeEqual } from 'node:crypto';

export function isRuntimeIngestAuthorized(request: Request): boolean {
  const expected = process.env.ASI_RUNTIME_INGEST_TOKEN?.trim();
  if (!expected) return false;

  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (!supplied || expected.length !== supplied.length) return false;

  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export function getRuntimeOwnerUserId(): string | null {
  const userId = process.env.ASI_RUNTIME_OWNER_USER_ID?.trim();
  return userId || null;
}
