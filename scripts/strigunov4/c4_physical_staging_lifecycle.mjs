// Physical staging C4: exactly one synthetic account/property and owned booking.
// Run ONLY as reviewed source inside GitHub staging owner-approved host gate.
// Never start this with laptop credentials or on a public endpoint.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sealData } from 'iron-session';
import { createClient } from '@supabase/supabase-js';
const STAGE = 'http://127.0.0.1:3001';
const G0 = 'd912aec6663de90e5ca4293cc5a69e2e0ed9ff94';
const EMAIL = 'staging-acceptance@asi.local';
const PROJECT = 'meeravcldnmocjtlqoeu';
const env = process.env;

const token = String(env.C4_RUN_ID ?? '');
const exactSha = String(env.C4_REVIEWED_MAIN_SHA ?? '');
assert.match(token, /^[1-9][0-9]{0,19}$/);
assert.match(exactSha, /^[a-f0-9]{40}$/);
assert.equal(env.C4_PHYSICAL_APPROVED, 'YES');
assert.equal(env.ASI_SYNTHETIC_NO_SEND, 'YES');
assert.equal(env.ASI_DEPLOY_ENV, 'staging');
for (const [key, expected] of Object.entries({
  EMAIL_AUTO_SEND: 'false', EMAIL_DRAFT_ONLY: 'true',
  DRY_RUN_TELEGRAM_OUTBOUND: 'true', ALLOW_REAL_TELEGRAM_SYNTHETIC: 'false',
  YOOKASSA_ENABLED: 'false',
})) assert.equal(String(env[key] ?? '').toLowerCase(), expected, key);
const url = new URL(String(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || ''));
assert.equal(url.hostname, PROJECT + '.supabase.co');
const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY ?? '');
const secret = String(env.SESSION_SECRET ?? '');
assert.ok(serviceKey.length > 30 && secret.length >= 32);
const emails = (s) => new Set(String(s || '').toLowerCase().split(/[,\s;]+/).filter(Boolean));
const operators = emails(env.CRM_OPERATOR_EMAILS);
const admins = emails(env.OPS_ADMIN_EMAILS);
assert.ok(operators.has(EMAIL) && admins.has(EMAIL));

const sb = createClient(url.toString(), serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const fixture = { userId: randomUUID(), accountId: randomUUID(),
  propertyId: randomUUID(), bookingIds: [], intakeIds: [], runId: token };
const receipt = { status: 'BLOCK', reason: 'NOT_STARTED',
  owned: fixture, checks: [], cleanup: 'NOT_RUN',
  realExternalEffectsIndependentProof: 'NOT_ESTABLISHED' };
const checks = receipt.checks;
const check = (ok, name) => { assert.ok(ok, name); checks.push(name); };
const result = async (value, name) => {
  if (value.error) throw Error(name + '_' + String(value.error.code || 'DB_ERROR'));
  return value.data;
};
async function count(table, filters) {
  let q = sb.from(table).select('id', { count: 'exact', head: true });
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const out = await q;
  if (out.error) throw Error('READ_' + table);
  return out.count;
}
async function insert(table, row) {
  return result(await sb.from(table).insert(row).select('id').single(), 'INSERT_' + table);
}
async function get(pathname, cookie) {
  const r = await fetch(STAGE + pathname, {
    headers: cookie ? { Cookie: cookie } : {},
    signal: AbortSignal.timeout(18000),
  });
  const body = await r.json().catch(() => ({}));
  return { code: r.status, body };
}
async function post(pathname, data, cookie) {
  const r = await fetch(STAGE + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(20000),
  });
  return { code: r.status, body: await r.json().catch(() => ({})) };
}
async function ownedBookingIds() {
  const response = await sb.from('booking_ops_records')
    .select('id,account_id,property_id')
    .eq('property_id', fixture.propertyId);
  const rows = await result(response, 'LOOKUP_BOOKINGS');
  if (rows.length > 2 || rows.some(r => r.account_id !== fixture.accountId ||
      r.property_id !== fixture.propertyId)) throw Error('OWNERSHIP_UNCERTAIN');
  return rows.map(r => r.id);
}
async function deleteExact(table, filter) {
  let q = sb.from(table).delete();
  for (const [key, value] of Object.entries(filter)) q = q.eq(key, value);
  await result(await q, 'DELETE_' + table);
}
async function cleanupOwned() {
  // Never delete by prefix, time range or global customer contact.
  const bookings = await ownedBookingIds();
  fixture.bookingIds = [...new Set([...fixture.bookingIds, ...bookings])];
  for (const id of fixture.bookingIds) {
    if (!bookings.includes(id)) throw Error('BOOKING_SCOPE_MISMATCH');
    const row = await sb.from('booking_ops_records').select('account_id,property_id')
      .eq('id', id).maybeSingle();
    const item = await result(row, 'BOOKING_SCOPE');
    assert.equal(item?.account_id, fixture.accountId);
    assert.equal(item?.property_id, fixture.propertyId);
    for (const [table, fk] of [
      ['booking_ops_telegram_drafts', 'booking_ops_record_id'],
      ['booking_ops_tasks', 'booking_ops_record_id'],
      ['booking_ops_communication_intents', 'booking_ops_record_id'],
    ]) await deleteExact(table, { [fk]: id });
    await deleteExact('booking_ops_records', {
      id, account_id: fixture.accountId, property_id: fixture.propertyId,
    });
  }
  if (await count('booking_ops_records', { account_id: fixture.accountId,
      property_id: fixture.propertyId }) !== 0) throw Error('BOOKING_REMAINS');
  await deleteExact('properties', { id: fixture.propertyId, account_id: fixture.accountId });
  await deleteExact('account_members', { user_id: fixture.userId, account_id: fixture.accountId });
  await deleteExact('accounts', { id: fixture.accountId });
  await deleteExact('users', { id: fixture.userId, email: EMAIL });
  for (const [table, filters] of [
    ['users', { id: fixture.userId }],
    ['accounts', { id: fixture.accountId }],
    ['properties', { id: fixture.propertyId }],
    ['account_members', { user_id: fixture.userId, account_id: fixture.accountId }],
    ['booking_ops_records', { account_id: fixture.accountId, property_id: fixture.propertyId }],
    ['booking_inbound_intake_events', { account_id: fixture.accountId }],
  ]) if (await count(table, filters) !== 0) throw Error('RESIDUE_' + table);
  for (const id of fixture.intakeIds) {
    if (await count('booking_inbound_intake_events', { id }) !== 0)
      throw Error('INTAKE_RECEIPT_REMAINS');
  }
  receipt.cleanup = 'PASS';
}

try {
  const version = await get('/api/version');
  check(version.code === 200 && version.body.sha === G0 &&
    version.body.environment === 'staging', 'EXACT_LIVE_RELEASE');
  check(await count('users', { email: EMAIL }) === 0, 'NO_EXISTING_TEST_IDENTITY');
  for (const [table,id] of [['users',fixture.userId],['accounts',fixture.accountId],
      ['properties',fixture.propertyId]]) {
    check(await count(table, { id }) === 0, 'NO_UUID_COLLISION_'+table);
  }
  await insert('users', { id: fixture.userId, email: EMAIL,
    password_hash: 'C4_NOT_A_REAL_PASSWORD_' + fixture.runId });
  await insert('accounts', { id: fixture.accountId,
    name: 'C4 staging isolated account ' + token,
    plan_code: 'small', subscription_status: 'trial' });
  await result(await sb.from('account_members').insert({
    account_id: fixture.accountId, user_id: fixture.userId, role: 'owner',
  }), 'CREATE_FIXTURE_MEMBERSHIP');
  await insert('properties', { id: fixture.propertyId, account_id: fixture.accountId,
    name: 'C4 isolated property ' + token, status: 'active' });
  const sealed = await sealData({ userId: fixture.userId, email: EMAIL },
    { password: secret, ttl: 1800 });
  const cookie = 'asi_session=' + sealed;
  const guest = 'C4 synthetic guest ' + token;
  const payload = {
    source: 'admin', action: 'process',
    guestName: guest, guestEmail: 'c4-' + token + '@example.invalid',
    guestCount: 1, propertyId: fixture.propertyId,
    propertyLabel: 'C4 isolated property ' + token,
    checkInAt: '2026-11-16T14:00:00Z',
    checkOutAt: '2026-11-18T11:00:00Z',
    bookingReference: 'C4-' + token,
  };
  const first = await post('/api/dashboard/booking-ops/intake/process', payload, cookie);
  check(first.code === 200 && first.body.ok === true, 'REAL_HTTP_INTAKE');
  const bookingId = first.body.result?.bookingId;
  check(typeof bookingId === 'string' && /^[0-9a-f-]{36}$/.test(bookingId),
    'BOOKING_CREATED');
  fixture.bookingIds.push(bookingId);
  const intakeId = first.body.result?.intakeId;
  check(typeof intakeId === 'string' && /^[0-9a-f-]{36}$/.test(intakeId),
    'INTAKE_RECEIPT_CREATED');
  fixture.intakeIds.push(intakeId);
  const intake = await sb.from('booking_inbound_intake_events')
    .select('id,account_id,booking_id').eq('id',intakeId).single();
  const intakeRow = await result(intake, 'READ_INTAKE_EVENT');
  check(intakeRow.account_id === fixture.accountId &&
    intakeRow.booking_id === bookingId, 'INTAKE_OWNERSHIP');
  const book = await sb.from('booking_ops_records')
    .select('id,account_id,property_id,guest_name').eq('id',bookingId).single();
  const actual = await result(book, 'BOOKING_READ');
  check(actual.account_id === fixture.accountId &&
    actual.property_id === fixture.propertyId &&
    actual.guest_name === guest, 'BOOKING_BOUND_TO_FIXTURE');
  const repeated = await post('/api/dashboard/booking-ops/intake/process', payload, cookie);
  check(repeated.code === 200 && repeated.body.ok === true,
    'INTAKE_RETRY');
  check([null, undefined, bookingId].includes(repeated.body.result?.bookingId) ||
    repeated.body.result?.duplicateOfBookingId === bookingId, 'RETRY_IDENTITY');
  check((await ownedBookingIds()).length === 1, 'NO_DUPLICATE_BOOKING');
  const ops = await get('/api/dashboard/booking-ops', cookie);
  check(ops.code === 200 && ops.body.ok === true &&
    ops.body.records?.some(x => x.id === bookingId), 'OPERATOR_BOOKING_QUEUE');
  const crm = await get('/api/dashboard/crm/queue', cookie);
  check(crm.code === 200 && crm.body.ok === true, 'CRM_ROUTE_AUTHORIZED');
  const outbound = await sb.from('booking_ops_communication_intents')
    .select('id', { count: 'exact', head: true })
    .eq('booking_ops_record_id', bookingId).in('status', ['sent', 'sending']);
  check(!outbound.error && outbound.count === 0, 'NO_SENT_INTENT_FOR_FIXTURE');
  receipt.status = 'CORE_PASS';
  receipt.reason = 'AWAIT_CLEANUP';
} catch (error) {
  receipt.reason = String(error?.message ?? 'FAILED').replace(/[^A-Za-z0-9_]/g,'_').slice(0,95);
} finally {
  try { await cleanupOwned(); }
  catch (err) { receipt.cleanup = 'BLOCK'; receipt.cleanupReason =
    String(err?.message ?? 'UNKNOWN').replace(/[^A-Za-z0-9_]/g,'_').slice(0,95); }
}
if (receipt.status !== 'CORE_PASS' || receipt.cleanup !== 'PASS') {
  receipt.status = 'BLOCK';
  process.stdout.write(JSON.stringify(receipt) + '\n');
  process.exitCode = 2;
} else {
  receipt.status = 'C4_PHYSICAL_CORE_PASS';
  receipt.reason = 'CORE_ONLY_NOT_FULL_OPERATOR_ACK_OR_EXTERNAL_EGRESS_PROOF';
  process.stdout.write(JSON.stringify(receipt) + '\n');
}
