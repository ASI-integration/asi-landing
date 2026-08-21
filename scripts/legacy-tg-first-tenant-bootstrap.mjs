#!/usr/bin/env node
import process from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const APPLY_CONFIRMATION = 'FIRST_TENANT_BOOTSTRAP_V1';
const ROLES = new Set(['owner', 'manager', 'operator']);
const PROPERTY_STATUSES = new Set(['draft', 'active', 'inactive']);

function normalized(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function flagValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? normalized(argv[index + 1]) : null;
}

export function parseBootstrapOptions(argv) {
  const options = {
    apply: argv.includes('--apply'),
    confirm: flagValue(argv, '--confirm'),
    accountId: flagValue(argv, '--account-id'),
    accountName: flagValue(argv, '--account-name'),
    userId: flagValue(argv, '--user-id'),
    role: flagValue(argv, '--role') ?? 'owner',
    propertyId: flagValue(argv, '--property-id'),
    propertyName: flagValue(argv, '--property-name'),
    propertyStatus: flagValue(argv, '--property-status') ?? 'active',
    legacyPropertyId: flagValue(argv, '--legacy-property-id'),
    reservationId: flagValue(argv, '--reservation-id'),
  };

  for (const [name, value] of [
    ['account-id', options.accountId],
    ['user-id', options.userId],
    ['property-id', options.propertyId],
  ]) {
    if (!value || !UUID_PATTERN.test(value)) throw new Error(`--${name} must be an explicit UUID`);
  }
  if (!options.legacyPropertyId) throw new Error('--legacy-property-id is required');
  if (!options.reservationId) throw new Error('--reservation-id is required');
  if (!ROLES.has(options.role)) throw new Error('--role must be owner, manager, or operator');
  if (!PROPERTY_STATUSES.has(options.propertyStatus)) {
    throw new Error('--property-status must be draft, active, or inactive');
  }
  if (options.apply) {
    if (options.confirm !== APPLY_CONFIRMATION) {
      throw new Error(`--apply requires --confirm ${APPLY_CONFIRMATION}`);
    }
    if (!options.propertyName) throw new Error('--apply requires --property-name');
  }
  return options;
}

function pass(value, detail) {
  return { status: value ? 'PASS' : 'FAIL', detail };
}

export function evaluateBootstrapReadiness(state) {
  const userExists = state.userRows.length === 1;
  const accountExists = state.accountRows.length === 1;
  const membershipExists = state.membershipRows.length === 1;
  const propertyExists = state.propertyRows.length === 1;
  const legacyPropertyExists = state.legacyPropertyRows.length === 1;
  const legacyReservationMatches = state.legacyReservationRows.length === 1
    && state.legacyReservationRows[0]?.property_id === state.expected.legacyPropertyId;
  const bindingExists = state.bindingRows.length === 1;
  const property = state.propertyRows[0];
  const binding = state.bindingRows[0];
  const relationshipConsistent = propertyExists
    && property.account_id === state.expected.accountId
    && bindingExists
    && binding.account_id === state.expected.accountId
    && binding.canonical_property_id === state.expected.propertyId
    && binding.legacy_property_id === state.expected.legacyPropertyId;

  const checks = {
    canonical_user_exists: pass(userExists, `${state.userRows.length} exact user row(s)`),
    canonical_account_exists: pass(accountExists, `${state.accountRows.length} exact account row(s)`),
    operator_membership_exists: pass(membershipExists, `${state.membershipRows.length} exact membership row(s)`),
    canonical_property_exists: pass(propertyExists, `${state.propertyRows.length} exact property row(s)`),
    legacy_property_exists: pass(legacyPropertyExists, `${state.legacyPropertyRows.length} exact legacy property row(s)`),
    legacy_reservation_matches_property: pass(
      legacyReservationMatches,
      `${state.legacyReservationRows.length} unique reservation match(es) for the expected property`,
    ),
    legacy_tg_property_binding_exists: pass(bindingExists, `${state.bindingRows.length} exact binding row(s)`),
    account_property_relationship_consistent: pass(
      relationshipConsistent,
      relationshipConsistent ? 'canonical property and binding agree on account' : 'canonical property or binding conflicts',
    ),
  };
  const ready = Object.values(checks).every((check) => check.status === 'PASS');
  return { checks, deployment_readiness: ready ? 'READY' : 'BLOCKED' };
}

async function rows(client, sql, params) {
  const result = await client.query(sql, params);
  return result.rows;
}

export async function inspectBootstrapState(client, options) {
  const expected = {
    userId: options.userId,
    accountId: options.accountId,
    propertyId: options.propertyId,
    legacyPropertyId: options.legacyPropertyId,
  };
  return {
    expected,
    userRows: await rows(client, 'SELECT id FROM public.users WHERE id = $1', [options.userId]),
    accountRows: await rows(client, 'SELECT id, name FROM public.accounts WHERE id = $1', [options.accountId]),
    membershipRows: await rows(
      client,
      'SELECT account_id, user_id, role FROM public.account_members WHERE account_id = $1 AND user_id = $2',
      [options.accountId, options.userId],
    ),
    userMembershipRows: await rows(
      client,
      'SELECT account_id, user_id, role FROM public.account_members WHERE user_id = $1',
      [options.userId],
    ),
    propertyRows: await rows(
      client,
      'SELECT id, account_id, name, status FROM public.properties WHERE id = $1',
      [options.propertyId],
    ),
    legacyPropertyRows: await rows(
      client,
      'SELECT property_id FROM public.tg_property_knowledge WHERE property_id = $1',
      [options.legacyPropertyId],
    ),
    legacyReservationRows: await rows(
      client,
      `SELECT id, property_id
         FROM public.tg_guest_reservations
        WHERE id = $1 OR booking_id = $1 OR reservation_ref = $1
        LIMIT 2`,
      [options.reservationId],
    ),
    bindingRows: await rows(
      client,
      `SELECT legacy_property_id, account_id, canonical_property_id
         FROM public.legacy_tg_property_bindings
        WHERE legacy_property_id = $1`,
      [options.legacyPropertyId],
    ),
  };
}

function exactly(rowsToCheck, predicate, conflict) {
  if (rowsToCheck.length > 1 || (rowsToCheck.length === 1 && !predicate(rowsToCheck[0]))) {
    throw new Error(conflict);
  }
}

export async function applyBootstrap(client, options) {
  await client.query('BEGIN');
  try {
    const userRows = await rows(client, 'SELECT id FROM public.users WHERE id = $1', [options.userId]);
    if (userRows.length !== 1) throw new Error('explicit user UUID does not identify exactly one canonical user');

    const before = await inspectBootstrapState(client, options);
    if (before.legacyPropertyRows.length !== 1) {
      throw new Error('legacy property must exist exactly once before bootstrap');
    }
    if (
      before.legacyReservationRows.length !== 1
      || before.legacyReservationRows[0]?.property_id !== options.legacyPropertyId
    ) {
      throw new Error('legacy reservation must resolve uniquely to the explicit legacy property');
    }
    if (before.accountRows.length !== 1) {
      const hasDifferentPersistedMembership = before.userMembershipRows.some(
        (row) => row.account_id !== options.accountId,
      );
      throw new Error(hasDifferentPersistedMembership
        ? 'owner-supplied account UUID conflicts with the persisted operator membership'
        : 'canonical account must already exist through the normal authentication flow');
    }
    exactly(
      before.accountRows,
      (row) => !options.accountName || row.name === options.accountName,
      'conflicting canonical account',
    );
    if (before.membershipRows.length !== 1) {
      const hasDifferentPersistedMembership = before.userMembershipRows.some(
        (row) => row.account_id !== options.accountId,
      );
      throw new Error(hasDifferentPersistedMembership
        ? 'owner-supplied account UUID conflicts with the persisted operator membership'
        : 'canonical account membership must already exist through the normal authentication flow');
    }
    exactly(
      before.membershipRows,
      (row) => row.role === options.role,
      'conflicting canonical account membership',
    );
    exactly(
      before.propertyRows,
      (row) => row.account_id === options.accountId
        && row.name === options.propertyName
        && row.status === options.propertyStatus,
      'conflicting canonical property',
    );
    exactly(
      before.bindingRows,
      (row) => row.account_id === options.accountId
        && row.canonical_property_id === options.propertyId,
      'conflicting legacy property binding',
    );

    await client.query(
      `INSERT INTO public.properties (id, account_id, name, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [options.propertyId, options.accountId, options.propertyName, options.propertyStatus],
    );
    await client.query(
      `INSERT INTO public.legacy_tg_property_bindings (
         legacy_property_id, account_id, canonical_property_id
       ) VALUES ($1, $2, $3)
       ON CONFLICT (legacy_property_id) DO NOTHING`,
      [options.legacyPropertyId, options.accountId, options.propertyId],
    );

    const readiness = evaluateBootstrapReadiness(await inspectBootstrapState(client, options));
    if (readiness.deployment_readiness !== 'READY') {
      throw new Error('bootstrap transaction did not reach READY');
    }
    await client.query('COMMIT');
    return readiness;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function main() {
  const options = parseBootstrapOptions(process.argv.slice(2));
  const connectionString = normalized(process.env.LEGACY_TG_BOOTSTRAP_DATABASE_URL);
  if (!connectionString) throw new Error('LEGACY_TG_BOOTSTRAP_DATABASE_URL is required');
  const pg = await import('pg');
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const readiness = options.apply
      ? await applyBootstrap(client, options)
      : evaluateBootstrapReadiness(await inspectBootstrapState(client, options));
    process.stdout.write(`${JSON.stringify({
      mode: options.apply ? 'apply' : 'read-only-preflight',
      ...readiness,
    }, null, 2)}\n`);
    if (readiness.deployment_readiness !== 'READY') process.exitCode = 2;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      mode: process.argv.includes('--apply') ? 'apply' : 'read-only-preflight',
      deployment_readiness: 'BLOCKED',
      error: error instanceof Error ? error.message : String(error),
    })}\n`);
    process.exitCode = 1;
  });
}
