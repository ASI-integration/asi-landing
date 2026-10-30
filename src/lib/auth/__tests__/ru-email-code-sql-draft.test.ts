import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// This guards against source-edit corruption only. It is NOT a PostgreSQL parse,
// concurrency test, migration acceptance, privilege test, or deployed schema.
const sql = readFileSync(
  resolve(process.cwd(), 'docs/operations/ru-email-code-auth-sql-draft.sql'),
  'utf8',
);
const count = (pattern: RegExp): number => [...sql.matchAll(pattern)].length;

describe('RU auth SQL draft structural integrity (no database access)', () => {
  it('keeps each RPC declaration exactly once with complete dollar quoting', () => {
    for (const name of [
      'ru_auth_issue_email_code', 'ru_auth_activate_email_code',
      'ru_auth_consume_email_code', 'ru_auth_revoke_email_code',
    ]) {
      expect(count(new RegExp('CREATE OR REPLACE FUNCTION public\\.' + name + '\\(', 'g'))).toBe(1);
    }
    expect(count(/^AS \$\$$/gm)).toBe(4);
    expect(count(/^\$\$;$/gm)).toBe(4);
    expect(count(/^RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''$/gm)).toBe(3);
    expect(count(/^RETURNS VOID LANGUAGE sql SECURITY INVOKER SET search_path = ''$/gm)).toBe(1);
    expect(sql).not.toMatch(/^AS \$$/m);
    expect(sql).not.toMatch(/^\$$/m);
  });

  it('keeps one challenge, one IP counter and one subject-link table', () => {
    for (const name of [
      'ru_auth_email_challenges', 'ru_auth_ip_limits', 'ru_auth_yandex_links',
    ]) {
      expect(count(new RegExp('CREATE TABLE IF NOT EXISTS public\\.' + name + '\\s*\\(', 'g'))).toBe(1);
      expect(sql).toContain('ALTER TABLE public.' + name + ' ENABLE ROW LEVEL SECURITY');
    }
    // The two OTP tables share one SQL REVOKE; do not invent separate grants.
    expect(sql).toMatch(/REVOKE ALL ON public\.ru_auth_email_challenges,\s*public\.ru_auth_ip_limits FROM PUBLIC,\s*anon,\s*authenticated;/);
    expect(sql).toMatch(/REVOKE ALL ON public\.ru_auth_yandex_links FROM PUBLIC,\s*anon,\s*authenticated;/);
  });

  it('denies SQL NULL digests before an issue or OTP consume operation', () => {
    // PostgreSQL IF treats NULL as not TRUE. Without explicit IS NULL,
    // "code_hash <> NULL" also evaluates to NULL and could reach success.
    // Source integrity only: a real isolated PG execution is still mandatory.
    const issue = sql.split('CREATE OR REPLACE FUNCTION public.ru_auth_issue_email_code')[1]
      ?.split('CREATE OR REPLACE FUNCTION public.ru_auth_activate_email_code')[0] ?? '';
    const consume = sql.split('CREATE OR REPLACE FUNCTION public.ru_auth_consume_email_code')[1]
      ?.split('CREATE OR REPLACE FUNCTION public.ru_auth_revoke_email_code')[0] ?? '';
    expect(issue).toMatch(/p_email IS NULL[\s\S]*p_hash IS NULL OR p_ip_hash IS NULL/);
    expect(consume).toContain('p_email IS NULL OR length(p_email) > 254');
    expect(consume).toContain('p_hash IS NULL OR p_ip_hash IS NULL');
    expect(consume).toContain('p_hash !~');
    expect(consume).toContain('p_ip_hash !~');
    expect(issue).toContain('p_hash !~');
    expect(issue).toContain('p_ip_hash !~');
  });

  it('requires delivery activation of the exact pending HMAC, not just reservation', () => {
    const activation = sql.split('CREATE OR REPLACE FUNCTION public.ru_auth_activate_email_code')[1]
      ?.split('CREATE OR REPLACE FUNCTION public.ru_auth_consume_email_code')[0] ?? '';
    expect(activation).toContain('p_hash IS NULL');
    expect(activation).toContain('code_hash = p_hash AND delivered_at IS NULL');
    expect(activation).toContain('failed_attempts = 0 AND expires_at > clock_timestamp()');
    const consume = sql.split('CREATE OR REPLACE FUNCTION public.ru_auth_consume_email_code')[1]
      ?.split('CREATE OR REPLACE FUNCTION public.ru_auth_revoke_email_code')[0] ?? '';
    expect(consume).toContain('row_value.delivered_at IS NULL');
    expect(consume).toContain('FOR UPDATE');
    expect(consume).toContain('SET expires_at=clock_timestamp(), failed_attempts=5');
    for (const name of [
      'ru_auth_issue_email_code(TEXT,TEXT,TEXT)',
      'ru_auth_activate_email_code(TEXT,TEXT)',
      'ru_auth_consume_email_code(TEXT,TEXT,TEXT)',
      'ru_auth_revoke_email_code(TEXT,TEXT)',
    ]) {
      expect(sql).toContain('REVOKE ALL ON FUNCTION public.' + name + ' FROM PUBLIC,anon,authenticated');
      expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.' + name + ' TO service_role');
    }
  });
  it('charges rejected issuance requests and limits all valid-format verification IP attempts',()=>{
    const issue=sql.split('CREATE OR REPLACE FUNCTION public.ru_auth_issue_email_code')[1]
      ?.split('CREATE OR REPLACE FUNCTION public.ru_auth_activate_email_code')[0] ?? '';
    expect(issue.indexOf('INSERT INTO public.ru_auth_ip_limits')).toBeLessThan(
      issue.indexOf("'ru-otp-email:' || p_email"));
    const consume=sql.split('CREATE OR REPLACE FUNCTION public.ru_auth_consume_email_code')[1]
      ?.split('CREATE OR REPLACE FUNCTION public.ru_auth_revoke_email_code')[0] ?? '';
    expect(consume).toContain('ip_row.verify_count >= 50');
    expect(consume).toContain('verify_count=CASE');
    expect(consume.indexOf('INSERT INTO public.ru_auth_ip_limits')).toBeLessThan(
      consume.indexOf('SELECT * INTO row_value'));
  });

  it('starts each IP budget at its first charged request, not the other kind of request',()=>{
    const limits = sql.split('CREATE TABLE IF NOT EXISTS public.ru_auth_ip_limits')[1]
      ?.split('ALTER TABLE public.ru_auth_email_challenges')[0] ?? '';
    expect(limits).toContain('window_start TIMESTAMPTZ,');
    expect(limits).toContain('verify_window_start TIMESTAMPTZ,');
    const issue = sql.split('CREATE OR REPLACE FUNCTION public.ru_auth_issue_email_code')[1]
      ?.split('CREATE OR REPLACE FUNCTION public.ru_auth_activate_email_code')[0] ?? '';
    expect(issue).toContain('ru_auth_ip_limits.count = 0 OR ru_auth_ip_limits.window_start IS NULL');
    const consume = sql.split('CREATE OR REPLACE FUNCTION public.ru_auth_consume_email_code')[1]
      ?.split('CREATE OR REPLACE FUNCTION public.ru_auth_revoke_email_code')[0] ?? '';
    expect(consume).toContain('VALUES(p_ip_hash,NULL,0,now_at,1)');
    expect(consume).toContain('ru_auth_ip_limits.verify_count = 0 OR ru_auth_ip_limits.verify_window_start IS NULL');
  });

});
