import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createShadowPostgrestJwt, SHADOW_REST_URL } from '../shadow-postgrest-jwt';

const id = {
  userId: '11111111-1111-4111-8111-111111111111',
  accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  propertyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  appRole: 'operator' as const,
};
const env = {
  ASI_SYNTHETIC_NO_SEND: 'YES', SUPABASE_URL: SHADOW_REST_URL,
  ASI_SHADOW_REST_URL: SHADOW_REST_URL, ASI_SHADOW_JWT_SECRET: 'local-test-signing-key-at-least-32-characters',
};

function decode(token: string) {
  const [header, body, signature] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString()),
    claims: JSON.parse(Buffer.from(body, 'base64url').toString()),
    signature,
    expected: createHmac('sha256', env.ASI_SHADOW_JWT_SECRET)
      .update(header + '.' + body).digest('base64url'),
  };
}

describe('isolated PostgREST JWT bridge', () => {
  it('uses only verified server-side identity and role with short lifetime', () => {
    const jwt = decode(createShadowPostgrestJwt(id, env, 1000));
    expect(jwt.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(jwt.claims).toMatchObject({
      iss: 'asi-shadow-iron-session-674', role: 'authenticated', sub: id.userId,
      account_id: id.accountId, property_id: id.propertyId, app_role: 'operator',
      iat: 1000, exp: 1060,
    });
    expect(jwt.signature).toBe(jwt.expected);
  });

  it('fails closed without no-send or exact shadow-only hostname and key', () => {
    for (const patch of [
      { ASI_SYNTHETIC_NO_SEND: 'NO' }, { SUPABASE_URL: 'https://supabase.co' },
      { ASI_SHADOW_REST_URL: 'http://127.0.0.1:3001' },
      { ASI_SHADOW_JWT_SECRET: 'short' },
    ]) expect(() => createShadowPostgrestJwt(id, { ...env, ...patch })).toThrow('shadow_jwt_bridge_unavailable');
  });
  it('rejects invalid UUIDs and forged property role', () => {
    expect(() => createShadowPostgrestJwt({ ...id, userId: 'bad' }, env)).toThrow();
    expect(() => createShadowPostgrestJwt({ ...id, appRole: 'service_role' as never }, env)).toThrow();
  });
});

const auth = vi.hoisted(() => ({
  configured: vi.fn(), getSession: vi.fn(), permission: vi.fn(), shadow: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ isSessionSecretConfigured: auth.configured, getSession: auth.getSession }));
vi.mock('@/lib/booking-ops/property-role-access', () => ({ requirePropertyPermission: auth.permission }));
vi.mock('@/lib/booking-ops/shadow-postgrest-jwt', async (importOriginal) => {
  const original = await importOriginal<typeof import('../shadow-postgrest-jwt')>();
  return { ...original, shadowPostgrestRequest: auth.shadow };
});
const request = (method: 'GET' | 'PATCH', extra = '') =>
  new Request('http://localhost/api/dashboard/property-tasks?accountId=' + id.accountId +
    '&propertyId=' + id.propertyId + extra, { method });

beforeEach(() => {
  vi.clearAllMocks();
  auth.configured.mockReturnValue(true);
  auth.getSession.mockResolvedValue({ userId: id.userId });
  auth.permission.mockResolvedValue('operator');
  auth.shadow.mockResolvedValue({ ok: true, json: async () => [] });
});

describe('session-scoped worker API', () => {
  it('denies anonymous user before any DB reads', async () => {
    auth.getSession.mockResolvedValue({});
    const { GET } = await import('@/app/api/dashboard/property-tasks/route');
    expect((await GET(request('GET'))).status).toBe(401);
    expect(auth.permission).not.toHaveBeenCalled();
    expect(auth.shadow).not.toHaveBeenCalled();
  });
  it('does not accept caller-controlled grants', async () => {
    auth.permission.mockRejectedValue(new Error('property_access_denied'));
    const { GET } = await import('@/app/api/dashboard/property-tasks/route');
    expect((await GET(request('GET', '&role=owner'))).status).toBe(403);
    expect(auth.shadow).not.toHaveBeenCalled();
  });
  it('sends resolved role and scoped property to JWT gateway', async () => {
    const { GET } = await import('@/app/api/dashboard/property-tasks/route');
    expect((await GET(request('GET'))).status).toBe(200);
    expect(auth.shadow).toHaveBeenCalledWith(expect.objectContaining(id), expect.stringContaining('property_id=eq.' + id.propertyId));
  });
  it('PATCH only ever sets done, resolved_at and updated_at', async () => {
    auth.shadow.mockResolvedValue({ ok: true, json: async () => [{ id: id.userId, task_status: 'resolved' }] });
    const { PATCH } = await import('@/app/api/dashboard/property-tasks/route');
    expect((await PATCH(request('PATCH', '&taskId=' + id.userId))).status).toBe(200);
    const call = auth.shadow.mock.calls[0];
    expect(call[2].method).toBe('PATCH');
    const body = JSON.parse(call[2].body);
    expect(Object.keys(body).sort()).toEqual(['resolved_at', 'task_status', 'updated_at']);
    expect(body.task_status).toBe('resolved');
  });
});
