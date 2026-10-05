import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261004123000_channel_manager_live_scope_guard_v1.sql'),
  'utf8',
).replace(/\r\n/gu, '\n');

describe('Channel Manager live scope guard migration', () => {
  it('keeps acquire and run-update RPCs compatible with the existing readiness probe', () => {
    const acquireStart = migration.indexOf(
      'CREATE OR REPLACE FUNCTION public.channel_manager_acquire_live_sync_guard_scoped_v1(',
    );
    const updateStart = migration.indexOf(
      'CREATE OR REPLACE FUNCTION public.channel_manager_update_import_run_scoped_v1(',
    );
    const readinessStart = migration.lastIndexOf(
      'CREATE OR REPLACE FUNCTION public.channel_manager_live_scope_guard_state_v1()',
    );

    expect(acquireStart).toBeGreaterThan(-1);
    expect(updateStart).toBeGreaterThan(acquireStart);
    expect(readinessStart).toBeGreaterThan(updateStart);

    const acquireRpc = migration.slice(acquireStart, updateStart);
    const updateRpc = migration.slice(updateStart, readinessStart);
    const readiness = migration.slice(readinessStart);

    expect(acquireRpc).toContain('SECURITY DEFINER');
    expect(acquireRpc).toContain('SET search_path = public');
    expect(updateRpc).toContain('SECURITY DEFINER');
    expect(updateRpc).toContain('SET search_path = public');
    expect(updateRpc).not.toContain('SECURITY INVOKER');

    expect(readiness).toContain(
      "'public.channel_manager_acquire_live_sync_guard_scoped_v1(uuid,jsonb,uuid,text,text,timestamptz,jsonb)'",
    );
    expect(readiness).toContain(
      "'public.channel_manager_update_import_run_scoped_v1(uuid,jsonb,uuid,jsonb)'",
    );

    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.channel_manager_acquire_live_sync_guard_scoped_v1(\n  uuid, jsonb, uuid, text, text, timestamptz, jsonb\n) TO service_role;',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.channel_manager_update_import_run_scoped_v1(uuid, jsonb, uuid, jsonb) TO service_role;',
    );
  });
});
