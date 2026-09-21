import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';

const fixture = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, any>[]>,
  failTable: '',
  ruHost: true,
  noLifecycleColumn: true,
  session: { userId: '', email: '', googleOauthState: undefined as string | undefined, googleOauthPlan: undefined as unknown, googleOauthRedirect: undefined as string | undefined, save: vi.fn(async () => {}) },
}));

vi.mock('@/lib/getIsRuHost', () => ({ getIsRuHost: async () => fixture.ruHost }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ getSession: async () => fixture.session, isSessionSecretConfigured: () => true }));
vi.mock('@/lib/telegram', () => ({ sendTelegramMessage: vi.fn(async () => {}) }));
vi.mock('@/lib/cabinet/api-auth', () => ({ requireCabinetSession: async () => fixture.session.userId ? { session: fixture.session } : { error: NextResponse.json({ message: 'Войдите' }, { status: 401 }) } }));
vi.mock('@/lib/ru-legal', () => ({
  LEGAL_ACCEPTANCE_REQUIRED_CODE: 'LEGAL_ACCEPTANCE_REQUIRED',
  hasCurrentRuLegalAcceptance: async () => true,
}));
vi.mock('google-auth-library', () => ({ OAuth2Client: class { async verifyIdToken() { return { getPayload: () => ({ email: 'oauth@example.test', aud: 'fixture-client' }) }; } } }));

// In-memory Data API boundary: real route, password hashing, account service,
// onboarding service and RU lifecycle execute; no remote DB, email or Telegram calls.
vi.mock('@/lib/supabase', () => ({ supabase: { from(table: string) {
  let action = 'select'; let payload: Record<string, any>[] = []; let conflict = 'id';
  const filters: ((r: Record<string, any>) => boolean)[] = [];
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => { filters.push((r) => r[key] === value); return query; },
    in: (key: string, values: unknown[]) => { filters.push((r) => values.includes(r[key])); return query; },
    order: () => query, limit: () => query,
    insert: (value: any) => { action = 'insert'; payload = Array.isArray(value) ? value : [value]; return query; },
    upsert: (value: any, options?: { onConflict?: string }) => { action = 'upsert'; payload = Array.isArray(value) ? value : [value]; conflict = options?.onConflict ?? 'id'; return query; },
    update: (value: any) => { action = 'update'; payload = [value]; return query; },
    delete: () => { action = 'delete'; return query; },
    single: async () => execute(true), maybeSingle: async () => execute(true),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(execute(false)).then(resolve, reject),
  };
  function execute(single: boolean) {
    if (fixture.failTable === table) return { data: null, error: { message: 'fixture storage failure' } };
    if (table === 'accounts' && fixture.noLifecycleColumn && payload.some((row) => 'lifecycle_status' in row)) return { data: null, error: { code: 'PGRST204', message: "Could not find the 'lifecycle_status' column of 'accounts' in the schema cache" } };
    const rows = fixture.rows[table] ??= [];
    let selected = rows.filter((row) => filters.every((f) => f(row)));
    if (action === 'insert' || action === 'upsert') {
      selected = [];
      for (const item of payload) {
        if (table === 'users' && rows.some((row) => row.email === item.email)) return { data: null, error: { code: '23505' } };
        const keys = conflict.split(',');
        const existing = action === 'upsert' ? rows.find((row) => keys.every((key) => row[key] === item[key])) : undefined;
        if (existing) { Object.assign(existing, item); selected.push(existing); }
        else { const row = { id: `${table}-${rows.length + 1}`, ...item }; rows.push(row); selected.push(row); }
      }
    } else if (action === 'update') selected.forEach((row) => Object.assign(row, payload[0]));
    else if (action === 'delete') fixture.rows[table] = rows.filter((row) => !selected.includes(row));
    if (table === 'account_members') selected = selected.map((row) => ({ ...row, accounts: fixture.rows.accounts?.find((account) => account.id === row.account_id) }));
    return { data: single ? selected[0] ?? null : selected, error: null };
  }
  return query;
} } }));

vi.mock('@/lib/pilot-readiness/repository', () => ({
  upsertPilotObjectKnowledge: async (input: Record<string, any>) => {
    const rows = fixture.rows.tg_property_knowledge ??= [];
    const previous = rows.find((row) => row.property_id === input.property_id);
    if (previous) Object.assign(previous, input); else rows.push(input);
    return { ok: true };
  },
  getPilotReadinessForProperty: async () => ({ ready: false, checks: [{ id: 'operator', labelRu: 'Проверка ASI', ok: false }] }),
}));

import { POST as signup } from '@/app/api/auth/signup/route';
import { POST as legacyOnboarding } from '@/app/api/auth/onboarding/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as google } from '@/app/api/auth/google/route';
import { GET as googleStart } from '@/app/api/auth/google/start/route';
import { GET as googleCallback } from '@/app/api/auth/google/callback/route';
import { GET as read, POST as save } from '@/app/api/cabinet/connect/route';
import { safeAuthRedirectPath } from '@/lib/auth/app-url';
import { RU_SETUP_PATH } from '../model';
import { connectionOperatorTaskId, connectionPropertyId } from '../service';

const request = (body: unknown) => new Request('http://localhost/api/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const credentials = { email: 'owner@example.test', password: 'fixture-password-2026' };
const property = { name: 'Тестовая квартира', address: 'Тестовый адрес', description: 'Описание для проверки', rules: 'Не курить', checkIn: '14:00', checkOut: '12:00', wifiName: 'TestNetwork', wifiPassword: 'synthetic-wifi', instructions: 'Инструкция для теста', photosLater: true };
const createOwner = async () => { expect((await signup(request(credentials))).status).toBe(200); };
const saveManager = () => save(request({ step: 0, values: { manager: 'bnovo', otherManager: '' } }));
async function prepare() { await createOwner(); await saveManager(); await save(request({ step: 1, values: { channels: ['direct'] } })); }

beforeEach(() => {
  fixture.rows = {}; fixture.failTable = ''; fixture.ruHost = true; fixture.noLifecycleColumn = true;
  Object.assign(fixture.session, { userId: '', email: '', googleOauthState: undefined, googleOauthPlan: undefined, googleOauthRedirect: undefined });
  vi.clearAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe('RU connection route and persistence contracts', () => {
  it('derives stable, distinct server task UUIDs', () => {
    const id = connectionOperatorTaskId('account-a', 'property-a');
    expect(id).toBe(connectionOperatorTaskId('account-a', 'property-a'));
    expect(id).not.toBe(connectionOperatorTaskId('account-a', 'property-b'));
    expect(id).not.toBe(connectionOperatorTaskId('account-b', 'property-a'));
    expect(id).not.toBe(connectionPropertyId('account-a'));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('RU signup succeeds without accounts.lifecycle_status, creates membership and never starts a trial', async () => {
    await createOwner();
    expect(await bcrypt.compare(credentials.password, fixture.rows.users[0].password_hash)).toBe(true);
    expect(fixture.session.save).toHaveBeenCalled();
    expect(fixture.rows.account_members[0]).toMatchObject({ account_id: fixture.rows.accounts[0].id, user_id: fixture.rows.users[0].id, role: 'owner' });
    expect(fixture.rows.accounts[0]).not.toHaveProperty('lifecycle_status');
    expect(fixture.rows.accounts[0]).not.toHaveProperty('trial_ends_at');
    expect(fixture.rows.subscriptions ?? []).toHaveLength(0);
    expect(fixture.rows.accounts[0].trial_started_at).toBeUndefined();
    fixture.session.userId = '';
    expect((await login(request(credentials))).status).toBe(200);
    expect(fixture.session.userId).toBe(fixture.rows.users[0].id);
    expect(fixture.rows.accounts[0].trial_started_at).toBeUndefined();
  });

  it('rejects weak passwords and reports an already registered email', async () => {
    expect((await signup(request({ ...credentials, password: '123' }))).status).toBe(400);
    expect(fixture.rows.users).toBeUndefined();
    await createOwner();
    expect((await signup(request(credentials))).status).toBe(409);
    expect(fixture.rows.users).toHaveLength(1);
  });

  it('does not create a session for the wrong password', async () => {
    await createOwner(); fixture.session.userId = '';
    expect((await login(request({ ...credentials, password: 'wrong-password' }))).status).toBe(401);
    expect(fixture.session.userId).toBe('');
  });

  it('requires authentication and an owner/manager membership', async () => {
    expect((await read()).status).toBe(401);
    expect((await saveManager()).status).toBe(401);
    fixture.session.userId = 'outsider';
    fixture.rows.account_members = [{ user_id: 'outsider', account_id: 'foreign', role: 'operator' }];
    expect((await read()).status).toBe(403);
    expect((await saveManager()).status).toBe(403);
    expect(fixture.rows.ops_v17_onboardings).toBeUndefined();
  });

  it('keeps each owner in their account and does not disclose another owner’s instructions', async () => {
    await prepare(); await save(request({ step: 2, values: property }));
    const firstId = fixture.session.userId;
    fixture.session.userId = '';
    await signup(request({ ...credentials, email: 'second@example.test' }));
    const second = await (await read()).json();
    expect(second.draft.name).toBe(''); expect(second.draft.wifiPassword).toBe('');
    fixture.session.userId = firstId;
    expect((await (await read()).json()).draft.name).toBe(property.name);
  });

  it('saves the three steps, reloads them and enters canonical setup without activating the pilot', async () => {
    await prepare();
    const response = await save(request({ step: 2, values: property }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.draft.step).toBe(3); expect(data.pilotStatus).toBe('setup');
    expect(data.readiness.ready).toBe(false);
    expect((await (await read()).json()).draft).toMatchObject(property);
    expect(fixture.rows.properties[0].account_id).toBe(fixture.rows.accounts[0].id);
    expect(fixture.rows.tg_property_knowledge[0]).toMatchObject({ object_name: property.name, communication_autopilot: 'disabled' });
    expect(fixture.rows.ru_commercial_pilot_lifecycle[0].pilot_started_at).toBeNull();
    expect(fixture.rows.ops_v17_onboardings[0].data.rentalConnection.manager).toBe('bnovo');
  });

  it('requires the manager, a named other service and prior steps', async () => {
    await createOwner();
    expect((await save(request({ step: 0, values: { manager: 'other', otherManager: '' } }))).status).toBe(400);
    expect((await save(request({ step: 2, values: property }))).status).toBe(400);
    expect(fixture.rows.properties).toBeUndefined();
  });

  it('rejects attempts to set account IDs, property IDs, readiness or activation from the browser', async () => {
    await createOwner();
    for (const key of ['accountId', 'propertyId', 'ready', 'pilot_activated_at']) {
      expect((await save(request({ step: 0, values: { manager: 'bnovo', [key]: 'foreign' } }))).status).toBe(400);
    }
    expect((await save(request({ step: 0, values: { manager: 'bnovo' }, accountId: 'foreign' }))).status).toBe(400);
  });

  it('validates booking sites, times and field lengths on the server', async () => {
    await prepare();
    expect((await save(request({ step: 1, values: { channels: ['injected-site'] } }))).status).toBe(400);
    expect((await save(request({ step: 2, values: { ...property, checkIn: '25:90' } }))).status).toBe(400);
    expect((await save(request({ step: 2, values: { ...property, instructions: 'x'.repeat(5001) } }))).status).toBe(400);
  });

  it('keeps the previous saved step when storage fails and allows retry', async () => {
    await prepare(); fixture.failTable = 'properties';
    expect((await save(request({ step: 2, values: property }))).status).toBe(503);
    expect((await (await read()).json()).draft.step).toBe(2);
    fixture.failTable = '';
    expect((await save(request({ step: 2, values: property }))).status).toBe(200);
  });

  it('retries the final submission without duplicating the object or restarting setup', async () => {
    await prepare(); await save(request({ step: 2, values: property }));
    const started = fixture.rows.ru_commercial_pilot_lifecycle[0].setup_started_at;
    await save(request({ step: 2, values: property }));
    expect(fixture.rows.properties).toHaveLength(1);
    expect(fixture.rows.ru_commercial_pilot_lifecycle).toHaveLength(1);
    expect(fixture.rows.ru_commercial_pilot_lifecycle[0].setup_started_at).toBe(started);
    expect(connectionPropertyId('first')).not.toBe(connectionPropertyId('second'));
    fixture.rows.ru_commercial_pilot_lifecycle[0].status = 'pilot_active';
    const previousName = fixture.rows.properties[0].name;
    expect((await save(request({ step: 2, values: { ...property, name: 'Changed' } }))).status).toBe(400);
    expect(fixture.rows.properties[0].name).toBe(previousName);
  });

  it('creates one operator handoff and retries a failed handoff without completing the wizard', async () => {
    await prepare(); fixture.failTable = 'ops_operator_tasks';
    expect((await save(request({ step: 2, values: property }))).status).toBe(503);
    expect((await (await read()).json()).draft.step).toBe(2);
    fixture.failTable = '';
    expect((await save(request({ step: 2, values: property }))).status).toBe(200);
    await save(request({ step: 2, values: property }));
    expect(fixture.rows.ops_operator_tasks).toHaveLength(1);
    const task = fixture.rows.ops_operator_tasks[0];
    expect(task).toMatchObject({ task_type: 'verify_channel_manager', task_status: 'needs_operator', object_id: fixture.rows.properties[0].id });
    expect(task.id).toBe(connectionOperatorTaskId(fixture.rows.accounts[0].id, fixture.rows.properties[0].id));
    expect(task.metadata.account_id).toBe(fixture.rows.accounts[0].id);
    expect(task.description).toContain('bnovo');
    expect(task.description).toContain('Свой сайт / соцсети');
    expect(JSON.stringify(task)).not.toContain(property.wifiPassword);
    expect(fixture.rows.ops_v17_onboardings[0].data.channelManager).toBeUndefined();
    expect(fixture.rows.channel_manager_connections).toBeUndefined();
  });

  it('keeps international signup and login on the deferred international lifecycle', async () => {
    fixture.ruHost = false; fixture.noLifecycleColumn = false;
    await createOwner(); await login(request(credentials));
    expect(fixture.rows.accounts[0].lifecycle_status).toBe('signup');
    expect(fixture.rows.accounts[0].trial_started_at).toBeUndefined();
    expect(fixture.rows.subscriptions ?? []).toHaveLength(0);
  });

  it('keeps the legacy RU registration endpoint free of all pilot clocks', async () => {
    expect((await legacyOnboarding(request({ name: 'Fixture owner', email: credentials.email }))).status).toBe(200);
    expect(fixture.rows.accounts[0]).not.toHaveProperty('lifecycle_status');
    expect(fixture.rows.accounts[0]).not.toHaveProperty('trial_started_at');
    expect(fixture.rows.accounts[0]).not.toHaveProperty('trial_ends_at');
    expect(fixture.rows.subscriptions ?? []).toHaveLength(0);
  });

  it.each(['token', 'callback'])('keeps international Google %s on the international lifecycle', async (method) => {
    fixture.ruHost = false; fixture.noLifecycleColumn = false;
    vi.stubEnv('GOOGLE_CLIENT_ID', 'fixture-client'); vi.stubEnv('GOOGLE_CLIENT_SECRET', 'fixture-secret');
    if (method === 'token') {
      expect((await google(request({ idToken: 'synthetic-token' }))).status).toBe(200);
    } else {
      fixture.session.googleOauthState = 'fixture-state';
      vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id_token: 'synthetic-token' })));
      expect((await googleCallback(new Request('http://localhost/api/auth/google/callback?code=test&state=fixture-state'))).status).toBe(307);
    }
    expect(fixture.rows.accounts[0].lifecycle_status).toBe('signup');
    expect(fixture.rows.accounts[0]).not.toHaveProperty('trial_started_at');
    expect(fixture.rows.subscriptions ?? []).toHaveLength(0);
  });

  it('keeps the intended internal redirect and rejects external/open redirect variants', () => {
    expect(safeAuthRedirectPath(RU_SETUP_PATH)).toBe(RU_SETUP_PATH);
    for (const value of ['https://evil.test', '//evil.test', '/\\evil.test', '/\nevil.test', 'javascript:alert(1)']) expect(safeAuthRedirectPath(value)).toBe('/dashboard');
  });

  it('preserves the connection destination across Google start and unavailable-provider recovery', async () => {
    const req = new Request(`http://localhost/api/auth/google/start?redirect=${encodeURIComponent(RU_SETUP_PATH)}`);
    const unavailable = await googleStart(req);
    expect(new URL(unavailable.headers.get('location')!).searchParams.get('redirect')).toBe(RU_SETUP_PATH);
    vi.stubEnv('GOOGLE_CLIENT_ID', 'fixture-client'); vi.stubEnv('GOOGLE_CLIENT_SECRET', 'fixture-secret');
    const response = await googleStart(req);
    expect(new URL(response.headers.get('location')!).hostname).toBe('accounts.google.com');
    expect(fixture.session.googleOauthRedirect).toBe(RU_SETUP_PATH);
  });

  it('completes Google callback with the saved destination and no premature clock', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'fixture-client'); vi.stubEnv('GOOGLE_CLIENT_SECRET', 'fixture-secret');
    fixture.session.googleOauthState = 'fixture-state'; fixture.session.googleOauthRedirect = RU_SETUP_PATH;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id_token: 'synthetic-token' })));
    const response = await googleCallback(new Request('http://localhost/api/auth/google/callback?code=fixture-code&state=fixture-state'));
    expect(response.headers.get('location')).toBe(`http://localhost${RU_SETUP_PATH}`);
    expect(fixture.session.email).toBe('oauth@example.test');
    expect(fixture.rows.subscriptions ?? []).toHaveLength(0);
    expect(fixture.rows.accounts[0].trial_started_at).toBeUndefined();
  });

  it('rejects the wrong OAuth state before token exchange or data writes', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'fixture-client'); vi.stubEnv('GOOGLE_CLIENT_SECRET', 'fixture-secret');
    fixture.session.googleOauthState = 'expected'; fixture.session.googleOauthRedirect = RU_SETUP_PATH;
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const response = await googleCallback(new Request('http://localhost/api/auth/google/callback?code=fixture-code&state=wrong'));
    expect(new URL(response.headers.get('location')!).searchParams.get('google_error')).toBe('bad_state');
    expect(fetchMock).not.toHaveBeenCalled(); expect(fixture.rows.users).toBeUndefined();
  });

  it('supports the existing Google identity-token path without starting a trial', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'fixture-client');
    expect((await google(request({ idToken: 'synthetic-token' }))).status).toBe(200);
    expect(fixture.rows.subscriptions ?? []).toHaveLength(0);
    expect(fixture.rows.accounts[0].trial_started_at).toBeUndefined();
  });

  it('does not downgrade an existing paid account or reset its clock on email login', async () => {
    await createOwner();
    Object.assign(fixture.rows.accounts[0], { plan_code: 'growth', subscription_status: 'active', trial_started_at: '2026-01-01' });
    await login(request(credentials));
    expect(fixture.rows.accounts[0]).toMatchObject({ plan_code: 'growth', subscription_status: 'active', trial_started_at: '2026-01-01' });
  });
});
