import { createHmac } from 'node:crypto';
import type { PropertyRole } from '@/lib/booking-ops/property-role-access';

export type ShadowIdentity = {
  userId: string;
  accountId: string;
  propertyId: string;
  appRole: PropertyRole;
};

export const SHADOW_REST_URL = 'http://asi-shadow-rest-gateway:3000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Server-only bridge: iron-session gives userId; the database-verified property
 * grant gives appRole. Never accept role or account claims from the browser.
 * The HMAC secret is configured on the isolated Next shadow runtime and must
 * equal that isolated PostgREST server's PGRST_JWT_SECRET.
 */
export function createShadowPostgrestJwt(
  identity: ShadowIdentity,
  env: Readonly<Record<string, string | undefined>> = process.env,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  if (
    env.ASI_SYNTHETIC_NO_SEND !== 'YES' ||
    env.SUPABASE_URL !== SHADOW_REST_URL ||
    env.ASI_SHADOW_REST_URL !== SHADOW_REST_URL ||
    !env.ASI_SHADOW_JWT_SECRET || Buffer.byteLength(env.ASI_SHADOW_JWT_SECRET) < 32 ||
    ![identity.userId, identity.accountId, identity.propertyId].every((s) => UUID.test(s)) ||
    !['owner', 'manager', 'operator'].includes(identity.appRole)
  ) {
    throw new Error('shadow_jwt_bridge_unavailable');
  }

  const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const claims = encode({
    iss: 'asi-shadow-iron-session-674',
    role: 'authenticated', // Database role; never a user-selected tenant role
    sub: identity.userId,
    account_id: identity.accountId,
    property_id: identity.propertyId,
    app_role: identity.appRole,
    iat: nowSeconds,
    exp: nowSeconds + 60,
  });
  const data = header + '.' + claims;
  const signature = createHmac('sha256', env.ASI_SHADOW_JWT_SECRET)
    .update(data).digest('base64url');
  return data + '.' + signature;
}

export async function shadowPostgrestRequest(
  identity: ShadowIdentity,
  path: string,
  init: Pick<RequestInit, 'method' | 'body'> = {},
): Promise<Response> {
  if (!path.startsWith('/rest/v1/ops_tasks?') || /[^\x20-\x7e]/.test(path)) {
    throw new Error('shadow_task_path_denied');
  }
  const token = createShadowPostgrestJwt(identity);
  return fetch(SHADOW_REST_URL + path, {
    method: init.method ?? 'GET',
    body: init.body,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json', Prefer: 'return=representation' } : {}),
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
}
