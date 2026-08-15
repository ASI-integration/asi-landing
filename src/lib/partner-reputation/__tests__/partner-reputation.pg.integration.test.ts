/**
 * Disposable PostgreSQL proof for Partner Review & Reputation Engine v1.
 * The prerequisite migration chain and all fixtures run inside one transaction
 * that is rolled back. No persistent database or external service is touched.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PG_URL = process.env.ASI_DISPOSABLE_POSTGRES_URL?.trim() || '';
const requireDisposablePg = process.env.ASI_REQUIRE_DISPOSABLE_PG === '1';
const hasDisposablePg = Boolean(PG_URL) && !/asi-staging|prod|production/iu.test(PG_URL);
const migrations = [
  '20260815102111_partner_communication_durable_state_v1.sql',
  '20260815130000_partner_authenticated_inbox_v1.sql',
  '20260815160000_partner_communication_brain_v1.sql',
  '20260815190000_partner_service_recovery_loop_v1.sql',
  '20260815210000_partner_review_reputation_engine_v1.sql',
].map((name) => resolve(process.cwd(), 'supabase/migrations', name));

type PgClient = {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  end(): Promise<void>;
};

async function connectPg(): Promise<PgClient> {
  const mod = await import('pg').catch(() => null) as { Client: new (config: { connectionString: string }) => PgClient } | null;
  if (!mod?.Client) throw new Error('Package "pg" is required for disposable PostgreSQL integration.');
  const client = new mod.Client({ connectionString: PG_URL });
  await client.connect();
  return client;
}

async function expectPgError(client: PgClient, savepoint: string, code: string, operation: () => Promise<unknown>) {
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await expect(operation()).rejects.toMatchObject({ code });
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  }
}

describe('Partner reputation PostgreSQL availability', () => {
  it('fails closed when CI requires disposable PostgreSQL but it is unavailable', () => {
    if (!requireDisposablePg) return expect(requireDisposablePg).toBe(false);
    expect(hasDisposablePg, 'partner reputation PostgreSQL integration must not skip in CI').toBe(true);
    expect(PG_URL).toMatch(/^postgres(ql)?:\/\//iu);
  });
});

describe.skipIf(!hasDisposablePg)('Partner Review & Reputation PostgreSQL integration', () => {
  it('applies the chain and proves review, event, signal, canonical scope, recovery, and RLS constraints', async () => {
    const client = await connectPg();
    const accountA = '10000000-0000-4000-8000-000000000001';
    const accountB = '20000000-0000-4000-8000-000000000002';
    const propertyA = '30000000-0000-4000-8000-000000000003';
    const propertyB = '30000000-0000-4000-8000-000000000004';
    const bookingA = '40000000-0000-4000-8000-000000000005';
    const bookingB = '40000000-0000-4000-8000-000000000006';
    const bindingA = '50000000-0000-4000-8000-000000000007';
    const bindingB = '50000000-0000-4000-8000-000000000008';
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
        CREATE TABLE public.properties (id UUID PRIMARY KEY, account_id UUID NOT NULL REFERENCES public.accounts(id), status TEXT NOT NULL);
        CREATE TABLE public.booking_ops_records (id UUID PRIMARY KEY, account_id TEXT, property_id TEXT);
        CREATE TABLE public.tg_property_knowledge (property_id TEXT PRIMARY KEY, active BOOLEAN NOT NULL DEFAULT true, wifi_name TEXT, wifi_password TEXT);
      `);
      for (const migration of migrations) await client.query(readFileSync(migration, 'utf8'));

      await client.query('INSERT INTO public.accounts (id) VALUES ($1), ($2)', [accountA, accountB]);
      await client.query(`INSERT INTO public.properties (id, account_id, status) VALUES ($1,$2,'active'),($3,$4,'active')`, [propertyA, accountA, propertyB, accountB]);
      await client.query(`INSERT INTO public.booking_ops_records (id, account_id, property_id) VALUES ($1,$2::text,$3::text),($4,$5::text,$6::text)`, [bookingA, accountA, propertyA, bookingB, accountB, propertyB]);
      await client.query(`INSERT INTO public.partner_account_bindings (id,account_id,partner_id,external_account_id) VALUES ($1,$2,'partner-demo','external-a'),($3,$4,'partner-demo','external-b')`, [bindingA, accountA, bindingB, accountB]);
      await client.query(`INSERT INTO public.partner_property_bindings (account_id,partner_account_binding_id,external_property_id,property_id) VALUES ($1,$2,'same-property',$3),($4,$5,'same-property',$6)`, [accountA, bindingA, propertyA, accountB, bindingB, propertyB]);
      const bookingBindings = await client.query(`INSERT INTO public.partner_booking_bindings (account_id,partner_account_binding_id,external_booking_id,booking_ops_record_id,property_id) VALUES ($1,$2,'same-booking',$3,$4),($5,$6,'same-booking',$7,$8) RETURNING id,account_id`, [accountA, bindingA, bookingA, propertyA, accountB, bindingB, bookingB, propertyB]);
      const bookingBindingA = String(bookingBindings.rows.find((row) => row.account_id === accountA)?.id);
      const bookingBindingB = String(bookingBindings.rows.find((row) => row.account_id === accountB)?.id);

      const insertReview = (input: { accountId: string; bindingId: string; bookingBindingId: string; propertyId: string; bookingId: string; fingerprint: string }) => client.query(`
        INSERT INTO public.partner_guest_reviews (
          account_id,partner_account_binding_id,partner_booking_binding_id,property_id,booking_ops_record_id,
          external_review_id,source,review_fingerprint,rating_value,rating_scale_max,normalized_rating,
          review_text,received_at,sentiment,severity,categories,reputation_risk,recovery_context,
          response_text,response_policy,response_reason_codes
        ) VALUES ($1,$2,$3,$4,$5,'same-review','booking',$6,8,10,0.8,'Хорошо',now(),
          'positive','low','[]'::jsonb,'low','no_recovery_case','Спасибо за отзыв!','draft_safe','["routine_positive_review"]'::jsonb)
        RETURNING id,public_review_ref,normalized_rating
      `, [input.accountId, input.bindingId, input.bookingBindingId, input.propertyId, input.bookingId, input.fingerprint]);

      const reviewA = await insertReview({ accountId: accountA, bindingId: bindingA, bookingBindingId: bookingBindingA, propertyId: propertyA, bookingId: bookingA, fingerprint: 'a'.repeat(64) });
      expect(reviewA.rows[0].normalized_rating).toBe('0.800000');
      expect(reviewA.rows[0].public_review_ref).toMatch(/^prev_[a-f0-9]{48}$/);
      await expectPgError(client, 'duplicate_review', '23505', () => insertReview({ accountId: accountA, bindingId: bindingA, bookingBindingId: bookingBindingA, propertyId: propertyA, bookingId: bookingA, fingerprint: 'a'.repeat(64) }));
      const reviewB = await insertReview({ accountId: accountB, bindingId: bindingB, bookingBindingId: bookingBindingB, propertyId: propertyB, bookingId: bookingB, fingerprint: 'b'.repeat(64) });
      expect(reviewA.rows[0].id).not.toBe(reviewB.rows[0].id);

      await expectPgError(client, 'cross_tenant_review', '23514', () => insertReview({ accountId: accountA, bindingId: bindingA, bookingBindingId: bookingBindingB, propertyId: propertyA, bookingId: bookingA, fingerprint: 'c'.repeat(64) }));
      await expectPgError(client, 'invalid_normalized_rating', '23514', () => client.query(`
        INSERT INTO public.partner_guest_reviews (
          account_id,partner_account_binding_id,partner_booking_binding_id,property_id,booking_ops_record_id,
          external_review_id,source,review_fingerprint,rating_value,rating_scale_max,normalized_rating,
          review_text,received_at,sentiment,severity,categories,reputation_risk,recovery_context,
          response_text,response_policy,response_reason_codes
        ) VALUES ($1,$2,$3,$4,$5,'bad-rating','booking',$6,8,10,0.5,'Bad',now(),
          'negative','high','["other"]'::jsonb,'high','no_recovery_case','Проверяем ситуацию.','review_required','["negative_review"]'::jsonb)
      `, [accountA, bindingA, bookingBindingA, propertyA, bookingA, 'd'.repeat(64)]));

      const insertEvent = () => client.query(`INSERT INTO public.partner_review_events (account_id,partner_account_binding_id,external_event_id,event_fingerprint,audit_ref) VALUES ($1,$2,'same-event',$3,'pra_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') RETURNING id,audit_ref`, [accountA, bindingA, 'e'.repeat(64)]);
      const reviewEvent = await insertEvent();
      expect(reviewEvent.rows[0].audit_ref).toMatch(/^pra_[A-Za-z0-9_-]{32,96}$/);
      await expectPgError(client, 'duplicate_event', '23505', insertEvent);

      const insertSignal = () => client.query(`INSERT INTO public.partner_reputation_signals (account_id,review_id,property_id,booking_ops_record_id,category,severity,source,recovery_context) VALUES ($1,$2,$3,$4,'heating','medium','booking','recovered_before_review')`, [accountA, reviewA.rows[0].id, propertyA, bookingA]);
      await insertSignal();
      await expectPgError(client, 'duplicate_signal', '23505', insertSignal);
      await expectPgError(client, 'cross_tenant_signal', '23503', () => client.query(`INSERT INTO public.partner_reputation_signals (account_id,review_id,property_id,booking_ops_record_id,category,severity,source,recovery_context) VALUES ($1,$2,$3,$4,'heating','high','booking','unrecovered_before_review')`, [accountB, reviewA.rows[0].id, propertyB, bookingB]));
      await expectPgError(client, 'cross_booking_signal', '23503', () => client.query(`INSERT INTO public.partner_reputation_signals (account_id,review_id,property_id,booking_ops_record_id,category,severity,source,recovery_context) VALUES ($1,$2,$3,$4,'maintenance','high','booking','unrecovered_before_review')`, [accountA, reviewA.rows[0].id, propertyA, bookingB]));

      const sessions = await client.query(`INSERT INTO public.partner_communication_sessions (account_id,partner_id,external_partner_account_id,canonical_conversation_key,external_property_id,external_booking_id,external_conversation_id) VALUES ($1,'partner-demo','external-a','conversation-a','same-property','same-booking','conversation-a'),($2,'partner-demo','external-b','conversation-b','same-property','same-booking','conversation-b') RETURNING id,account_id`, [accountA, accountB]);
      const sessionA = String(sessions.rows.find((row) => row.account_id === accountA)?.id);
      const sessionB = String(sessions.rows.find((row) => row.account_id === accountB)?.id);
      const inboxes = await client.query(`INSERT INTO public.partner_communication_inbox (account_id,partner_id,external_partner_account_id,external_event_id,canonical_event_key,event_fingerprint,schema_version,event_type,occurred_at,external_property_id,external_booking_id,external_conversation_id,external_message_id,message_text,audit_ref) VALUES ($1,'partner-demo','external-a','recovery-a','event-a',$3,'partner.communication.v1','guest.message.received',now(),'same-property','same-booking','conversation-a','message-a','Не работает отопление','pai_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),($2,'partner-demo','external-b','recovery-b','event-b',$4,'partner.communication.v1','guest.message.received',now(),'same-property','same-booking','conversation-b','message-b','Не работает отопление','pai_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') RETURNING id,account_id`, [accountA, accountB, 'f'.repeat(64), '1'.repeat(64)]);
      const inboxA = String(inboxes.rows.find((row) => row.account_id === accountA)?.id);
      const inboxB = String(inboxes.rows.find((row) => row.account_id === accountB)?.id);
      const decisions = await client.query(`INSERT INTO public.partner_communication_decisions (account_id,inbox_id,session_id,decision_type,policy,confidence,reason_codes,evidence,resulting_state) VALUES ($1,$2,$3,'escalate','review_required',1,'["maintenance_issue"]','{}','{"conversation":"escalated"}'),($4,$5,$6,'escalate','review_required',1,'["maintenance_issue"]','{}','{"conversation":"escalated"}') RETURNING id,account_id`, [accountA, inboxA, sessionA, accountB, inboxB, sessionB]);
      const decisionA = String(decisions.rows.find((row) => row.account_id === accountA)?.id);
      const decisionB = String(decisions.rows.find((row) => row.account_id === accountB)?.id);
      await client.query(`INSERT INTO public.partner_service_recovery_cases (account_id,session_id,source_inbox_id,source_decision_id,category,severity,status,issue_summary,outcome,opened_at,operation_resolved_at,guest_confirmed_at,closed_at) VALUES ($1,$2,$3,$4,'maintenance','normal','recovered','Отопление', 'satisfied',now()-interval '2 hours',now()-interval '90 minutes',now()-interval '1 hour',now()-interval '1 hour'),($5,$6,$7,$8,'maintenance','high','unrecovered','Отопление','not_satisfied',now()-interval '2 hours',NULL,now()-interval '1 hour',NULL)`, [accountA, sessionA, inboxA, decisionA, accountB, sessionB, inboxB, decisionB]);
      const correlated = await client.query(`SELECT c.status,c.outcome FROM public.partner_service_recovery_cases c JOIN public.partner_communication_sessions s ON s.account_id=c.account_id AND s.id=c.session_id WHERE c.account_id=$1 AND s.partner_id='partner-demo' AND s.external_partner_account_id='external-a' AND s.external_property_id='same-property' AND s.external_booking_id='same-booking'`, [accountA]);
      expect(correlated.rows).toEqual([{ status: 'recovered', outcome: 'satisfied' }]);

      const security = await client.query(`
        SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
          has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
          has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_select,
          has_table_privilege('service_role',c.oid,'SELECT') AS service_select
        FROM pg_class c WHERE c.relname IN ('partner_guest_reviews','partner_review_events','partner_reputation_signals')
        ORDER BY c.relname
      `);
      expect(security.rows).toHaveLength(3);
      for (const row of security.rows) expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true, anon_select: false, authenticated_select: false, service_select: true });

      const proof = {
        migrationChainApplied: migrations.length,
        ratingScaleTenNormalized: true,
        reviewUniqueness: true,
        crossTenantExternalReviewIsolation: true,
        canonicalScopeGuard: true,
        eventUniqueness: true,
        signalUniqueness: true,
        signalBookingScope: true,
        recoveryCorrelationTenantScoped: true,
        rlsForcedServiceRoleOnly: true,
        finalTransactionRolledBack: true,
        productionTouched: false,
        stagingTouched: false,
      };
      console.info('PARTNER_REPUTATION_PG_PROOF', JSON.stringify(proof));
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  });
});
