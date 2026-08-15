/**
 * Disposable PostgreSQL integration for Partner Authenticated Inbox v1.
 * Applies the required migrations inside one transaction and rolls everything
 * back. No persistent environment or external service is used.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PG_URL = process.env.ASI_DISPOSABLE_POSTGRES_URL?.trim() || '';
const requireDisposablePg = process.env.ASI_REQUIRE_DISPOSABLE_PG === '1';
const hasDisposablePg = Boolean(PG_URL) && !/asi-staging|prod|production/iu.test(PG_URL);
const durableMigration = resolve(
  process.cwd(), 'supabase/migrations/20260815102111_partner_communication_durable_state_v1.sql',
);
const inboxMigration = resolve(
  process.cwd(), 'supabase/migrations/20260815130000_partner_authenticated_inbox_v1.sql',
);
const brainMigration = resolve(
  process.cwd(), 'supabase/migrations/20260815160000_partner_communication_brain_v1.sql',
);

type PgClient = {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{
    rows: Array<Record<string, unknown>>;
    rowCount: number | null;
  }>;
  end(): Promise<void>;
};

async function connectPg(): Promise<PgClient> {
  const mod = await import('pg').catch(() => null) as {
    Client: new (config: { connectionString: string }) => PgClient;
  } | null;
  if (!mod?.Client) throw new Error('Package "pg" is required for disposable PostgreSQL integration.');
  const client = new mod.Client({ connectionString: PG_URL });
  await client.connect();
  return client;
}

async function expectUniqueViolation(client: PgClient, operation: () => Promise<unknown>): Promise<void> {
  await client.query('SAVEPOINT expected_unique_violation');
  try {
    await expect(operation()).rejects.toMatchObject({ code: '23505' });
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_unique_violation');
    await client.query('RELEASE SAVEPOINT expected_unique_violation');
  }
}

describe('Partner Authenticated Inbox PostgreSQL availability', () => {
  it('fails closed when CI requires disposable PostgreSQL but it is unavailable', () => {
    if (!requireDisposablePg) return expect(requireDisposablePg).toBe(false);
    expect(hasDisposablePg, 'partner inbox PostgreSQL integration must not skip in CI').toBe(true);
    expect(PG_URL).toMatch(/^postgres(ql)?:\/\//iu);
  });
});

describe.skipIf(!hasDisposablePg)('Partner Authenticated Inbox PostgreSQL integration', () => {
  it('applies migrations and proves credential, inbox, turn, isolation, conflict, and handoff constraints', async () => {
    const client = await connectPg();
    const accountA = '10000000-0000-4000-8000-000000000001';
    const accountB = '20000000-0000-4000-8000-000000000002';
    const bindingA = '30000000-0000-4000-8000-000000000003';
    const bindingB = '30000000-0000-4000-8000-000000000004';
    const tokenHash = 'a'.repeat(64);
    try {
      await client.query('BEGIN');
      await client.query(`
        CREATE EXTENSION IF NOT EXISTS pgcrypto;
        DO $roles$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
        END
        $roles$;
        CREATE TABLE public.accounts (id UUID PRIMARY KEY);
        CREATE TABLE public.properties (
          id UUID PRIMARY KEY,
          account_id UUID NOT NULL REFERENCES public.accounts(id),
          status TEXT NOT NULL
        );
        CREATE TABLE public.booking_ops_records (
          id UUID PRIMARY KEY,
          account_id TEXT,
          property_id TEXT
        );
        CREATE TABLE public.tg_property_knowledge (
          property_id TEXT PRIMARY KEY,
          active BOOLEAN NOT NULL DEFAULT true,
          wifi_name TEXT,
          wifi_password TEXT
        );
      `);
      await client.query(readFileSync(durableMigration, 'utf8'));
      await client.query(readFileSync(inboxMigration, 'utf8'));
      await client.query(readFileSync(brainMigration, 'utf8'));
      await client.query('INSERT INTO public.accounts (id) VALUES ($1), ($2)', [accountA, accountB]);
      await client.query(`
        INSERT INTO public.partner_account_bindings
          (id, account_id, partner_id, external_account_id)
        VALUES ($1, $2, 'partner-demo', 'external-a'), ($3, $4, 'partner-demo', 'external-b')
      `, [bindingA, accountA, bindingB, accountB]);
      await client.query(`
        INSERT INTO public.partner_api_credentials
          (partner_account_binding_id, credential_id, token_hash)
        VALUES ($1, 'demo-credential-1', $2)
      `, [bindingA, tokenHash]);

      const credential = await client.query(`
        SELECT b.account_id, b.partner_id, b.external_account_id, c.token_hash
        FROM public.partner_api_credentials c
        JOIN public.partner_account_bindings b ON b.id = c.partner_account_binding_id
        WHERE c.credential_id = 'demo-credential-1' AND c.status = 'active' AND b.status = 'active'
      `);
      expect(credential.rows).toEqual([{
        account_id: accountA,
        partner_id: 'partner-demo',
        external_account_id: 'external-a',
        token_hash: tokenHash,
      }]);

      const insertInbox = (accountId: string, externalAccount: string, fingerprint: string) => client.query(`
        INSERT INTO public.partner_communication_inbox (
          account_id, partner_id, external_partner_account_id, external_event_id,
          canonical_event_key, event_fingerprint, schema_version, event_type, occurred_at,
          external_property_id, external_booking_id, external_conversation_id,
          external_message_id, message_text, audit_ref
        ) VALUES (
          $1, 'partner-demo', $2, 'same-event', $3, $4,
          'partner.communication.v1', 'guest.message.received', now(),
          'same-property', 'same-booking', 'same-conversation', 'same-message',
          'Какой пароль от Wi-Fi?', $5
        ) RETURNING id
      `, [
        accountId,
        externalAccount,
        `partner:v1|event|${externalAccount}|same-event`,
        fingerprint,
        `pai_${externalAccount}_00000000000000000000`,
      ]);
      const eventA = await insertInbox(accountA, 'external-a', 'b'.repeat(64));
      await expectUniqueViolation(client, () => insertInbox(accountA, 'external-a', 'b'.repeat(64)));
      await expectUniqueViolation(client, () => insertInbox(accountA, 'external-a', 'c'.repeat(64)));
      const eventB = await insertInbox(accountB, 'external-b', 'c'.repeat(64));
      expect(eventA.rows[0].id).not.toBe(eventB.rows[0].id);

      const sessionA = await client.query(`
        INSERT INTO public.partner_communication_sessions (
          account_id, partner_id, external_partner_account_id, canonical_conversation_key,
          external_property_id, external_booking_id, external_conversation_id
        ) VALUES ($1, 'partner-demo', 'external-a', 'conversation-key-a',
          'same-property', 'same-booking', 'same-conversation') RETURNING id
      `, [accountA]);
      const sessionB = await client.query(`
        INSERT INTO public.partner_communication_sessions (
          account_id, partner_id, external_partner_account_id, canonical_conversation_key,
          external_property_id, external_booking_id, external_conversation_id
        ) VALUES ($1, 'partner-demo', 'external-b', 'conversation-key-b',
          'same-property', 'same-booking', 'same-conversation') RETURNING id
      `, [accountB]);
      expect(sessionA.rows[0].id).not.toBe(sessionB.rows[0].id);

      const sessionAId = sessionA.rows[0].id;
      await client.query(`
        INSERT INTO public.partner_communication_turns (
          account_id, session_id, canonical_message_key, external_message_id, direction, text
        ) VALUES ($1, $2, 'message-key-a', 'same-message', 'inbound', 'test')
      `, [accountA, sessionAId]);
      await expectUniqueViolation(client, () => client.query(`
        INSERT INTO public.partner_communication_turns (
          account_id, session_id, canonical_message_key, external_message_id, direction, text
        ) VALUES ($1, $2, 'message-key-a', 'same-message', 'inbound', 'duplicate')
      `, [accountA, sessionAId]));

      const propertyA = '50000000-0000-4000-8000-000000000005';
      const propertyB = '50000000-0000-4000-8000-000000000006';
      const bookingA = '60000000-0000-4000-8000-000000000006';
      const bookingB = '60000000-0000-4000-8000-000000000007';
      await client.query(`
        INSERT INTO public.properties (id, account_id, status)
        VALUES ($1, $2, 'active'), ($3, $4, 'active')
      `, [propertyA, accountA, propertyB, accountB]);
      await client.query(`
        INSERT INTO public.booking_ops_records (id, account_id, property_id)
        VALUES ($1, $2::text, $3::text), ($4, $5::text, $6::text)
      `, [bookingA, accountA, propertyA, bookingB, accountB, propertyB]);
      await client.query(`
        INSERT INTO public.tg_property_knowledge (property_id, wifi_name, wifi_password)
        VALUES ($1::text, 'Tenant-A', 'tenant-a-password'), ($2::text, 'Tenant-B', 'tenant-b-password')
      `, [propertyA, propertyB]);
      await client.query(`
        INSERT INTO public.partner_property_bindings
          (account_id, partner_account_binding_id, external_property_id, property_id)
        VALUES ($1, $2, 'same-property', $3), ($4, $5, 'same-property', $6)
      `, [accountA, bindingA, propertyA, accountB, bindingB, propertyB]);
      await client.query(`
        INSERT INTO public.partner_booking_bindings
          (account_id, partner_account_binding_id, external_booking_id, booking_ops_record_id, property_id)
        VALUES ($1, $2, 'same-booking', $3, $4), ($5, $6, 'same-booking', $7, $8)
      `, [accountA, bindingA, bookingA, propertyA, accountB, bindingB, bookingB, propertyB]);

      await client.query('SAVEPOINT expected_scope_violation');
      try {
        await expect(client.query(`
          INSERT INTO public.partner_booking_bindings
            (account_id, partner_account_binding_id, external_booking_id, booking_ops_record_id, property_id)
          VALUES ($1, $2, 'cross-tenant-booking', $3, $4)
        `, [accountA, bindingA, bookingB, propertyA])).rejects.toMatchObject({ code: '23514' });
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT expected_scope_violation');
        await client.query('RELEASE SAVEPOINT expected_scope_violation');
      }

      const mappedKnowledge = await client.query(`
        SELECT k.wifi_name, k.wifi_password
        FROM public.partner_property_bindings binding
        JOIN public.tg_property_knowledge k ON k.property_id = binding.property_id::text AND k.active = true
        WHERE binding.account_id = $1 AND binding.partner_account_binding_id = $2
          AND binding.external_property_id = 'same-property' AND binding.status = 'active'
      `, [accountA, bindingA]);
      expect(mappedKnowledge.rows).toEqual([{ wifi_name: 'Tenant-A', wifi_password: 'tenant-a-password' }]);

      const decisionInsert = () => client.query(`
        INSERT INTO public.partner_communication_decisions (
          account_id, inbox_id, session_id, decision_type, policy, response_text,
          confidence, reason_codes, evidence, resulting_state
        ) VALUES (
          $1, $2, $3, 'reply', 'auto_allowed', 'synthetic grounded reply', 0.99,
          '["grounded_wifi"]'::jsonb,
          '{"knowledgeSource":"tg_property_knowledge","propertyBindingResolved":true,"bookingBindingResolved":true,"matchedIntent":"wifi"}'::jsonb,
          '{"conversation":"active","issue":"none","operatorRequired":false}'::jsonb
        ) RETURNING id
      `, [accountA, eventA.rows[0].id, sessionAId]);
      await decisionInsert();
      await expectUniqueViolation(client, decisionInsert);

      await client.query(`
        INSERT INTO public.partner_communication_actions (
          account_id, session_id, idempotency_key, action_type, reason_code
        ) VALUES ($1, $2, 'same-action', 'maintenance_issue', 'maintenance_issue')
      `, [accountA, sessionAId]);
      await expectUniqueViolation(client, () => client.query(`
        INSERT INTO public.partner_communication_actions (
          account_id, session_id, idempotency_key, action_type, reason_code
        ) VALUES ($1, $2, 'same-action', 'maintenance_issue', 'maintenance_issue')
      `, [accountA, sessionAId]));

      await client.query(`
        INSERT INTO public.partner_communication_handoffs
          (account_id, session_id, reason_code)
        VALUES ($1, $2, 'first')
      `, [accountA, sessionAId]);
      await expectUniqueViolation(client, () => client.query(`
        INSERT INTO public.partner_communication_handoffs
          (account_id, session_id, reason_code)
        VALUES ($1, $2, 'second')
      `, [accountA, sessionAId]));

      const privileges = await client.query(`
        SELECT
          has_table_privilege('service_role', 'public.partner_api_credentials', 'SELECT') AS service_select,
          has_table_privilege('anon', 'public.partner_api_credentials', 'SELECT') AS anon_select,
          has_table_privilege('authenticated', 'public.partner_communication_inbox', 'INSERT') AS authenticated_insert,
          has_table_privilege('anon', 'public.partner_communication_decisions', 'SELECT') AS anon_decision_select
      `);
      expect(privileges.rows[0]).toEqual({
        service_select: true, anon_select: false, authenticated_insert: false, anon_decision_select: false,
      });

      // eslint-disable-next-line no-console
      console.log(`PARTNER_INBOX_PG_PROOF ${JSON.stringify({
        migrationApplied: true,
        credentialBindingLookup: true,
        inboxUniqueness: true,
        messageTurnUniqueness: true,
        tenantIsolation: true,
        eventConflictConstraint: true,
        activeHandoffConstraint: true,
        actionIdempotency: true,
        propertyAndBookingMappingScope: true,
        groundedKnowledgeTenantIsolation: true,
        decisionUniqueness: true,
        transactionRolledBack: true,
        productionTouched: false,
        stagingTouched: false,
      })}`);
      await client.query('ROLLBACK');
    } finally {
      await client.end().catch(() => undefined);
    }
  }, 120_000);
});
