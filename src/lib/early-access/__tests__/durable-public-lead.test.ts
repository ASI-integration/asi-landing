import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PUBLIC_LEAD_POLICY_SOURCE_PATHS,
  PUBLIC_LEAD_POLICY_SOURCE_SHA256,
  publicLeadConsentPolicy,
} from '../public-lead-consent';

const migration = '20261009151935_public_lead_admission_v1.sql';
const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8').replace(/\r\n/g, '\n');
const sql = read('supabase/migrations/' + migration);

describe('public lead SQL and consent source contracts (STATIC ONLY)', () => {
  it('pins the offered privacy source and resolved controller artifact, with the existing UI link', () => {
    const bundle = JSON.stringify(PUBLIC_LEAD_POLICY_SOURCE_PATHS.map((file) => [file, read(file)]));
    expect(createHash('sha256').update(bundle).digest('hex')).toBe(PUBLIC_LEAD_POLICY_SOURCE_SHA256);
    expect(sql).toContain(PUBLIC_LEAD_POLICY_SOURCE_SHA256);
    expect(read('src/components/early-access/EarlyAccessObjectForm.tsx')).toContain('href="/ru/privacy"');
    expect(publicLeadConsentPolicy()).toMatchObject({
      policyId: '/ru/privacy', policyVersion: 'ru-privacy-20261009-v1',
      sourceSha256: PUBLIC_LEAD_POLICY_SOURCE_SHA256,
      contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('uses a unique append-only migration after its CRM dependency', () => {
    const files = readdirSync(resolve(process.cwd(), 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
    const prefixes = files.map((f) => f.split('_')[0]);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(files.indexOf(migration)).toBeGreaterThan(files.indexOf('20260619000001_crm_early_access_v1.sql'));
    expect(sql).toContain('REFERENCES public.crm_contacts(id) ON DELETE CASCADE');
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE FROM)\b/i);
    expect(sql.trim()).toMatch(/^--[\s\S]*BEGIN;[\s\S]*COMMIT;$/);
  });

  it('keeps invoker rights, hardened search path, RLS and explicit anonymous denial', () => {
    expect(sql).toContain("LANGUAGE plpgsql VOLATILE SECURITY INVOKER\nSET search_path = ''");
    expect(sql).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toContain('REVOKE ALL ON SCHEMA public_lead_private FROM PUBLIC, anon, authenticated');
    for (const table of ['admission_state', 'consent_receipts']) {
      expect(sql).toContain(`ALTER TABLE public_lead_private.${table} FORCE ROW LEVEL SECURITY`);
    }
    expect(sql).toContain('FROM PUBLIC, anon, authenticated, service_role');
    expect(sql).toContain('GRANT SELECT, INSERT ON public_lead_private.consent_receipts TO service_role');
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public.admit_public_pilot_lead_v1\(text, text, text, jsonb\)\s+FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public.admit_public_pilot_lead_v1\(text, text, text, jsonb\)\s+TO service_role/);
  });

  it('holds one lock across time, issuer, rolling quota, CRM and receipt work without swallowed errors', () => {
    const lock = sql.indexOf('WHERE singleton = true FOR UPDATE');
    const clock = sql.indexOf('v_now := GREATEST(pg_catalog.clock_timestamp()');
    const insert = sql.indexOf('INSERT INTO public.crm_contacts(');
    const receipt = sql.indexOf('INSERT INTO public_lead_private.consent_receipts(');
    expect(lock).toBeGreaterThan(0);
    expect(clock).toBeGreaterThan(lock);
    expect(insert).toBeGreaterThan(clock);
    expect(receipt).toBeGreaterThan(insert);
    expect(sql).toContain('JOIN public.crm_contacts c ON c.id = r.crm_id');
    expect(sql).toContain('FOR KEY SHARE OF c');
    expect(sql).toContain("interval '10 minutes'");
    expect(sql).toContain("interval '60 seconds'");
    expect(sql).toContain("interval '60 minutes'");
    expect(sql).toContain('v_global >= 150 OR v_contact >= 3');
    expect(sql).toContain('v_state.total_created >= 100000');
    expect(sql).toContain('v_state.key_commitment <> p_key_commitment');
    expect(sql).toContain("p_payload->'consent' = 'true'::jsonb");
    expect(sql).not.toMatch(/EXCEPTION\s+WHEN|ON\s+CONFLICT\s+DO\s+NOTHING/i);
  });

  it('routes persistence only through the RPC and retains bounded request parsing', () => {
    const route = read('src/app/api/early-access/leads/route.ts');
    const adapter = read('src/lib/early-access/public-lead-rate-limit.ts');
    expect(route).toContain('readBoundedRequestJson(req, MAX_PUBLIC_LEAD_BODY_BYTES)');
    expect(route).toContain('MAX_PUBLIC_LEAD_BODY_BYTES = 4096');
    expect(route).not.toContain('createCrmContact');
    expect(adapter).toContain("import 'server-only'");
    expect(adapter).toContain("supabase.rpc('admit_public_pilot_lead_v1'");
    expect(adapter).not.toMatch(/new Map|randomBytes|supabase\.from\(|console\.|x-forwarded-for|x-real-ip/);
  });
});
