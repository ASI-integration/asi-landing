import { supabase } from '@/lib/supabase';

export const OPS_OPERATOR_TASKS_TABLE = 'ops_operator_tasks';

export function getSupabaseHostForLog(): string {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url?.trim()) return '(missing)';
  try {
    return new URL(url).host;
  } catch {
    return '(invalid url)';
  }
}

export function isOpsOperatorTasksSchemaCacheError(message: string): boolean {
  return /ops_operator_tasks|schema cache/i.test(message);
}

export function formatOpsOperatorTasksPreflightFailure(error: string): string {
  const lines = [
    `Required table public.${OPS_OPERATOR_TASKS_TABLE} is not available via Supabase Data API.`,
    `Supabase host: ${getSupabaseHostForLog()}`,
    `PostgREST error: ${error}`,
    '',
    'Diagnosis: migration not applied, or PostgREST schema cache is stale.',
    '/api/ops/tasks uses public.ops_operator_tasks (not legacy public.ops_tasks).',
    '',
    'Fix:',
    '1. Apply supabase/migrations/20260622000002_ops_operator_tasks.sql in the Supabase SQL editor',
    '   (or: supabase db push / supabase migration up against this project).',
    '2. Reload PostgREST schema cache in the same SQL session:',
    "   NOTIFY pgrst, 'reload schema';",
    '3. Re-run acceptance after the table probe succeeds.',
  ];
  return lines.join('\n');
}

export async function verifyOpsOperatorTasksTable(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from(OPS_OPERATOR_TASKS_TABLE).select('id').limit(1);
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

const SUPPORT_BOT_OPS_PROBE_DEDUP_KEY = 'auto:acceptance_preflight:support_bot_ops_probe:support_review';

export function formatSupportBotOpsPreflightFailure(error: string): string {
  const lines = [
    'Support bot OPS schema is not ready for support_review / telegram_support tasks.',
    `Supabase host: ${getSupabaseHostForLog()}`,
    `PostgREST error: ${error}`,
    '',
    'Diagnosis: migration supabase/migrations/20260623000001_support_bot_ops.sql is not applied.',
    '',
    'Fix:',
    '1. Apply supabase/migrations/20260623000001_support_bot_ops.sql in the Supabase SQL editor',
    '   (or: SUPABASE_DB_URL=... python scripts/apply-support-bot-ops-migration.py).',
    "2. Reload PostgREST schema cache: NOTIFY pgrst, 'reload schema';",
    '3. Re-run acceptance after the probe insert succeeds.',
  ];
  return lines.join('\n');
}

export async function verifySupportBotOpsSchema(): Promise<{ ok: true } | { ok: false; error: string }> {
  const tableCheck = await verifyOpsOperatorTasksTable();
  if (!tableCheck.ok) {
    return tableCheck;
  }

  const probeRow = {
    task_type: 'support_review',
    task_status: 'needs_operator',
    priority: 'normal',
    source: 'telegram_support',
    title: 'Support bot OPS schema probe',
    description: 'acceptance preflight probe',
    dedup_key: SUPPORT_BOT_OPS_PROBE_DEDUP_KEY,
    metadata: { created_by_system: true, acceptance_probe: true },
  };

  const { data, error } = await supabase
    .from(OPS_OPERATOR_TASKS_TABLE)
    .insert(probeRow)
    .select('id')
    .single();

  if (error) {
    if (/type_check|source_check|check constraint/i.test(error.message)) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: error.message };
  }

  if (data?.id) {
    await supabase.from(OPS_OPERATOR_TASKS_TABLE).delete().eq('id', data.id);
  }

  return { ok: true };
}
