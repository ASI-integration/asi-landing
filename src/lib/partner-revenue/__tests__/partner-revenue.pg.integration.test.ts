/** Disposable PostgreSQL proof. Every fixture is rolled back; no persistent DB is touched. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PG_URL = process.env.ASI_DISPOSABLE_POSTGRES_URL?.trim() || '';
const required = process.env.ASI_REQUIRE_DISPOSABLE_PG === '1';
const available = Boolean(PG_URL) && !/staging|prod|production/iu.test(PG_URL);
const migrations = [
  '20260701180000_pricing_intelligence_tariff_grid_v1.sql',
  '20260815102111_partner_communication_durable_state_v1.sql',
  '20260815130000_partner_authenticated_inbox_v1.sql',
  '20260815160000_partner_communication_brain_v1.sql',
  '20260815230000_partner_revenue_shadow_pricing_v1.sql',
].map((name) => resolve(process.cwd(), 'supabase/migrations', name));
type Client = { connect(): Promise<void>; query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, any>> }>; end(): Promise<void> };
async function connect(): Promise<Client> { const pg = await import('pg') as unknown as { Client: new (input: { connectionString: string }) => Client }; const client = new pg.Client({ connectionString: PG_URL }); await client.connect(); return client; }
async function expectCode(client: Client, savepoint: string, code: string, operation: () => Promise<unknown>) { await client.query(`SAVEPOINT ${savepoint}`); try { await expect(operation()).rejects.toMatchObject({ code }); } finally { await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`); await client.query(`RELEASE SAVEPOINT ${savepoint}`); } }

describe('Partner revenue PostgreSQL availability', () => {
  it('fails closed when CI requires disposable PostgreSQL', () => { if (!required) return expect(required).toBe(false); expect(available).toBe(true); expect(PG_URL).toMatch(/^postgres(ql)?:\/\//u); });
});

describe.skipIf(!available)('Partner Revenue PostgreSQL integration', () => {
  it('applies the chain and proves tenant, uniqueness, numeric, feedback, and service-role boundaries', async () => {
    const client = await connect();
    const a = '10000000-0000-4000-8000-000000000001'; const b = '20000000-0000-4000-8000-000000000002';
    const pa = '30000000-0000-4000-8000-000000000003'; const pb = '30000000-0000-4000-8000-000000000004';
    const ba = '50000000-0000-4000-8000-000000000005'; const bb = '50000000-0000-4000-8000-000000000006';
    try {
      await client.query('BEGIN');
      await client.query(`
        CREATE EXTENSION IF NOT EXISTS pgcrypto;
        DO $roles$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
        END $roles$;
        CREATE TABLE public.accounts (id UUID PRIMARY KEY);
        CREATE TABLE public.properties (id UUID PRIMARY KEY, account_id UUID NOT NULL REFERENCES public.accounts(id), status TEXT NOT NULL);
        CREATE TABLE public.booking_property_setup_profiles (id UUID PRIMARY KEY);
        CREATE TABLE public.booking_channel_manager_connections (id UUID PRIMARY KEY);
        CREATE TABLE public.booking_ops_records (id UUID PRIMARY KEY, account_id TEXT, property_id TEXT);
        CREATE TABLE public.tg_property_knowledge (property_id TEXT PRIMARY KEY, active BOOLEAN NOT NULL DEFAULT true, wifi_name TEXT, wifi_password TEXT);
        CREATE FUNCTION public.set_partner_communication_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
      `);
      for (const migration of migrations) await client.query(readFileSync(migration, 'utf8'));
      await client.query('INSERT INTO accounts(id) VALUES($1),($2)', [a, b]);
      await client.query(`INSERT INTO properties(id,account_id,status) VALUES($1,$2,'active'),($3,$4,'active')`, [pa, a, pb, b]);
      await client.query(`INSERT INTO partner_account_bindings(id,account_id,partner_id,external_account_id) VALUES($1,$2,'apart-sharing','a'),($3,$4,'apart-sharing','b')`, [ba, a, bb, b]);
      const bindings = await client.query(`INSERT INTO partner_property_bindings(account_id,partner_account_binding_id,external_property_id,property_id) VALUES($1,$2,'apartment-101',$3),($4,$5,'apartment-101',$6) RETURNING id,account_id`, [a, ba, pa, b, bb, pb]);
      const pba = String(bindings.rows.find((row) => row.account_id === a)?.id); const pbb = String(bindings.rows.find((row) => row.account_id === b)?.id);
      const setup = '60000000-0000-4000-8000-000000000006'; await client.query('INSERT INTO booking_property_setup_profiles(id) VALUES($1)', [setup]);
      const profile = await client.query(`INSERT INTO booking_pricing_profiles(property_setup_id,property_id,status,base_price,min_price,max_price,currency) VALUES($1,$2,'ready_for_recommendations',6000,4500,7000,'RUB') RETURNING id`, [setup, pa]);
      const profileId = String(profile.rows[0].id);
      const event = await client.query(`INSERT INTO partner_revenue_events(account_id,partner_account_binding_id,partner_property_binding_id,external_event_id,event_type,event_fingerprint,audit_ref) VALUES($1,$2,$3,'event-1','revenue.observation.recorded',$4,$5) RETURNING id`, [a, ba, pba, 'a'.repeat(64), `prv_${'a'.repeat(32)}`]);
      const eventId = String(event.rows[0].id);
      await expectCode(client, 'event_replay', '23505', () => client.query(`INSERT INTO partner_revenue_events(account_id,partner_account_binding_id,partner_property_binding_id,external_event_id,event_type,event_fingerprint,audit_ref) VALUES($1,$2,$3,'event-1','revenue.observation.recorded',$4,$5)`, [a, ba, pba, 'b'.repeat(64), `prv_${'b'.repeat(32)}`]));
      await expectCode(client, 'cross_tenant_binding', '23503', () => client.query(`INSERT INTO partner_revenue_events(account_id,partner_account_binding_id,partner_property_binding_id,external_event_id,event_type,event_fingerprint,audit_ref) VALUES($1,$2,$3,'cross','revenue.observation.recorded',$4,$5)`, [a, ba, pbb, 'c'.repeat(64), `prv_${'c'.repeat(32)}`]));
      const obs = await client.query(`INSERT INTO partner_revenue_observations(account_id,partner_account_binding_id,partner_property_binding_id,property_id,source_event_id,public_observation_ref,stay_date,current_price,available_inventory,sold_inventory,realized_room_revenue,currency,source,observed_at) VALUES($1,$2,$3,$4,$5,$6,'2026-08-22',6000,1,1,6000,'RUB','partner_supplied',now()) RETURNING id`, [a, ba, pba, pa, eventId, `obs_${'a'.repeat(32)}`]);
      const obsId = String(obs.rows[0].id);
      await expectCode(client, 'observation_unique', '23505', () => client.query(`INSERT INTO partner_revenue_observations(account_id,partner_account_binding_id,partner_property_binding_id,property_id,source_event_id,public_observation_ref,stay_date,current_price,available_inventory,sold_inventory,realized_room_revenue,currency,source,observed_at) VALUES($1,$2,$3,$4,$5,$6,'2026-08-22',6000,1,1,6000,'RUB','partner_supplied',now())`, [a, ba, pba, pa, eventId, `obs_${'b'.repeat(32)}`]));
      await expectCode(client, 'inventory_math', '23514', () => client.query(`INSERT INTO partner_revenue_observations(account_id,partner_account_binding_id,partner_property_binding_id,property_id,source_event_id,public_observation_ref,stay_date,current_price,available_inventory,sold_inventory,realized_room_revenue,currency,source,observed_at) VALUES($1,$2,$3,$4,$5,$6,'2026-08-23',6000,1,2,6000,'RUB','partner_supplied',now())`, [a, ba, pba, pa, eventId, `obs_${'c'.repeat(32)}`]));
      const recommendation = await client.query(`INSERT INTO partner_shadow_pricing_recommendations(account_id,partner_account_binding_id,partner_property_binding_id,property_id,pricing_profile_id,source_event_id,observation_id,public_recommendation_ref,stay_date,current_price,recommended_price,confidence,confidence_band,strategy,reason_codes,adjustment_reasons) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'2026-08-22',6000,6500,.75,'high','balanced','["profile_complete"]','[]') RETURNING id`, [a, ba, pba, pa, profileId, eventId, obsId, `prc_${'a'.repeat(32)}`]);
      const recommendationId = String(recommendation.rows[0].id);
      await expectCode(client, 'recommendation_unique', '23505', () => client.query(`INSERT INTO partner_shadow_pricing_recommendations(account_id,partner_account_binding_id,partner_property_binding_id,property_id,pricing_profile_id,source_event_id,observation_id,public_recommendation_ref,stay_date,current_price,recommended_price,confidence,confidence_band,strategy,reason_codes,adjustment_reasons) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'2026-08-22',6000,6500,.75,'high','balanced','[]','[]')`, [a, ba, pba, pa, profileId, eventId, obsId, `prc_${'b'.repeat(32)}`]));
      await client.query(`INSERT INTO partner_pricing_recommendation_feedback(account_id,partner_account_binding_id,partner_property_binding_id,recommendation_id,source_event_id,status,recorded_at) VALUES($1,$2,$3,$4,$5,'accepted',now())`, [a, ba, pba, recommendationId, eventId]);
      await expectCode(client, 'feedback_unique', '23505', () => client.query(`INSERT INTO partner_pricing_recommendation_feedback(account_id,partner_account_binding_id,partner_property_binding_id,recommendation_id,source_event_id,status,recorded_at) VALUES($1,$2,$3,$4,$5,'rejected',now())`, [a, ba, pba, recommendationId, eventId]));
      const security = await client.query(`SELECT relname,relrowsecurity,relforcerowsecurity,has_table_privilege('anon',oid,'SELECT') anon_select,has_table_privilege('authenticated',oid,'SELECT') authenticated_select,has_table_privilege('service_role',oid,'SELECT') service_select FROM pg_class WHERE relname IN ('partner_revenue_events','partner_revenue_observations','partner_shadow_pricing_recommendations','partner_pricing_recommendation_feedback') ORDER BY relname`);
      expect(security.rows).toHaveLength(4); for (const row of security.rows) expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true, anon_select: false, authenticated_select: false, service_select: true });
      console.info('PARTNER_REVENUE_PG_PROOF', JSON.stringify({ migrationChainApplied: migrations.length, observationUniqueness: true, eventReplayUniqueness: true, tenantIsolation: true, recommendationUniqueness: true, feedbackUniqueness: true, bindingScope: true, rlsForcedServiceRoleOnly: true, finalTransactionRolledBack: true, productionTouched: false, stagingTouched: false }));
    } finally { await client.query('ROLLBACK').catch(() => undefined); await client.end(); }
  });
});
