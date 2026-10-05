import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const manifestPath = 'docs/operations/channel-manager-live-core-rollout-v1/manifest.json';
const gatePath = 'docs/operations/channel-manager-live-core-rollout-v1/migration-owner-gate.json';
const workflowPath = '.github/workflows/apply-channel-manager-live-core-production-v1.yml';

const expected = [
  'supabase/migrations/20260804120000_channel_manager_live_core_initial_sync_v1.sql',
  'supabase/migrations/20260805120000_channel_manager_live_core_synthetic_recovery_v1.sql',
  'supabase/migrations/20260806170000_channel_manager_live_incremental_sync_v1.sql',
  'supabase/migrations/20260807120000_channel_manager_reconciliation_recovery_v1.sql',
  'supabase/migrations/20260808041000_channel_manager_live_core_recovery_fk_expectation_fix_v1.sql',
  'supabase/migrations/20260808051000_channel_manager_live_core_acceptance_cleanup_v2.sql',
  'supabase/migrations/20261004123000_channel_manager_live_scope_guard_v1.sql',
];

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/u, ''));
const gate = JSON.parse(readFileSync(gatePath, 'utf8').replace(/^\uFEFF/u, ''));
const workflow = readFileSync(workflowPath, 'utf8');

if (manifest.schemaVersion !== 'asi.channel-manager-live-core-rollout.v1') throw new Error('manifest_schema_mismatch');
if (manifest.target?.supabaseProjectRef !== 'jwinifeienvzejofmbua') throw new Error('manifest_target_mismatch');
if (JSON.stringify(manifest.canonicalOrder) !== JSON.stringify(expected)) throw new Error('manifest_order_mismatch');
if (!Array.isArray(manifest.migrations) || manifest.migrations.length !== expected.length) throw new Error('manifest_count_mismatch');

for (const [index, item] of manifest.migrations.entries()) {
  if (item.path !== expected[index]) throw new Error('manifest_allowlist_mismatch');
  const bytes = readFileSync(item.path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== item.sha256) throw new Error(`sha256_mismatch:${item.path}`);
  const blob = spawnSync('git', ['hash-object', item.path], { encoding: 'utf8' });
  if (blob.status !== 0 || blob.stdout.trim() !== item.gitBlobSha) throw new Error(`git_blob_mismatch:${item.path}`);
}

if (gate.schemaVersion !== 'asi.agent-os.owner-gate.v1') throw new Error('gate_schema_mismatch');
if (gate.status !== 'missing') throw new Error('gate_must_start_missing');
if (gate.action !== 'production_migration') throw new Error('gate_action_mismatch');
if (gate.identity?.ref !== 'refs/heads/main') throw new Error('gate_ref_mismatch');
if (gate.identity?.migration !== manifestPath) throw new Error('gate_manifest_mismatch');
if (gate.authorization !== null) throw new Error('gate_authorization_must_start_null');

for (const path of expected) {
  if (!workflow.includes(`--file ${path}`)) throw new Error(`workflow_missing_migration:${path}`);
}
if (!workflow.includes('APPLY_CHANNEL_MANAGER_LIVE_CORE_')) throw new Error('workflow_confirmation_missing');
if (!workflow.includes('production-migration-approval')) throw new Error('workflow_owner_environment_missing');
if (!workflow.includes('scripts/channel-manager-live-core-production-precheck.sql')) throw new Error('workflow_precheck_missing');
if (!workflow.includes('scripts/channel-manager-live-core-production-verify.sql')) throw new Error('workflow_verify_missing');
if (!workflow.includes('--single-transaction')) throw new Error('workflow_atomic_apply_missing');

const guard = readFileSync(expected.at(-1), 'utf8');
for (const signature of [
  'channel_manager_assert_connection_scope_locked_v1',
  'channel_manager_update_live_connection_scoped_v1',
  'channel_manager_acquire_live_sync_guard_scoped_v1',
  'channel_manager_update_import_run_scoped_v1',
  'channel_manager_commit_incremental_sync_scoped_v1',
  'channel_manager_complete_incremental_replay_scoped_v1',
  'channel_manager_live_scope_guard_state_v1',
]) {
  if (!guard.includes(signature)) throw new Error(`scope_guard_signature_missing:${signature}`);
}

console.log(JSON.stringify({
  ok: true,
  migrationCount: expected.length,
  target: manifest.target.supabaseProjectRef,
  ownerGate: gate.status,
  atomic: true,
  productionMutationPerformed: false,
}));
