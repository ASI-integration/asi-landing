import { spawnSync } from 'node:child_process';
import {
  GUEST_LIFECYCLE_SYNTHETIC_CONFIRM,
  assertGuestLifecycleSyntheticManifest,
  cleanupGuestLifecycleSyntheticRows,
  createGuestLifecycleSyntheticFixtures,
  createGuestLifecycleSyntheticManifest,
  previewGuestLifecycleSyntheticCleanup,
  runGuestLifecycleSyntheticDatabasePass,
  sameGuestLifecycleSyntheticCounts,
  type GuestLifecycleSyntheticManifest,
  type GuestLifecycleSyntheticPassReport,
} from '../src/lib/communication/guest-lifecycle-synthetic-db';

function argument(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function decodeManifest(value: string): GuestLifecycleSyntheticManifest {
  const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  assertGuestLifecycleSyntheticManifest(parsed);
  return parsed;
}

function requireExecutionGate(): { targetId: string } {
  if (process.env.GUEST_LIFECYCLE_ACCEPTANCE_ENABLED !== 'true') throw new Error('acceptance_not_enabled');
  if (process.env.GUEST_LIFECYCLE_ACCEPTANCE_CONFIRM !== GUEST_LIFECYCLE_SYNTHETIC_CONFIRM) throw new Error('acceptance_confirmation_mismatch');
  if (process.env.GUEST_LIFECYCLE_ACCEPTANCE_NO_EXTERNAL_ACTIONS !== 'true') throw new Error('no_external_actions_gate_required');
  const targetId = String(process.env.GUEST_LIFECYCLE_ACCEPTANCE_TARGET_ID ?? '').trim();
  const expectedTargetId = String(process.env.GUEST_LIFECYCLE_ACCEPTANCE_EXPECTED_TARGET_ID ?? '').trim();
  if (!targetId || targetId !== expectedTargetId) throw new Error('acceptance_target_identity_mismatch');
  return { targetId };
}

function restartReplay(manifest: GuestLifecycleSyntheticManifest): GuestLifecycleSyntheticPassReport {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const encoded = Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64url');
  const child = spawnSync(command, [
    'tsx', process.argv[1]!, '--phase', 'restart-replay', '--manifest', encoded,
  ], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (child.status !== 0) throw new Error(`restart_replay_failed:${child.stderr.trim() || child.stdout.trim()}`);
  const marker = child.stdout.split(/\r?\n/u).find((line) => line.startsWith('GUEST_LIFECYCLE_RESTART_REPLAY_RESULT='));
  if (!marker) throw new Error('restart_replay_result_missing');
  const parsed = JSON.parse(marker.slice('GUEST_LIFECYCLE_RESTART_REPLAY_RESULT='.length)) as GuestLifecycleSyntheticPassReport;
  if (parsed.ok !== true || parsed.runId !== manifest.runId || parsed.noExternalActions !== true) {
    throw new Error('restart_replay_result_invalid');
  }
  return parsed;
}

async function main(): Promise<void> {
  const gate = requireExecutionGate();
  const phase = argument('phase') ?? 'full';
  const encodedManifest = argument('manifest');
  if (phase === 'restart-replay') {
    if (!encodedManifest) throw new Error('restart_replay_manifest_missing');
    const manifest = decodeManifest(encodedManifest);
    const report = await runGuestLifecycleSyntheticDatabasePass(manifest);
    process.stdout.write(`GUEST_LIFECYCLE_RESTART_REPLAY_RESULT=${JSON.stringify(report)}\n`);
    return;
  }

  const manifest = createGuestLifecycleSyntheticManifest();
  let failure: unknown = null;
  let cleanup: Record<string, unknown> | null = null;
  const report: Record<string, unknown> = {
    schemaVersion: 'asi.guest-lifecycle.synthetic-result.v1',
    targetId: gate.targetId,
    runId: manifest.runId,
    manifest,
    noExternalActions: true,
  };
  try {
    report.cleanupPreview = await previewGuestLifecycleSyntheticCleanup(manifest);
    await createGuestLifecycleSyntheticFixtures(manifest);
    const initialPass = await runGuestLifecycleSyntheticDatabasePass(manifest);
    const sameProcessReplay = await runGuestLifecycleSyntheticDatabasePass(manifest);
    report.initialPass = initialPass;
    report.sameProcessReplay = sameProcessReplay;
    if (!sameGuestLifecycleSyntheticCounts(initialPass.counts, sameProcessReplay.counts)) {
      throw new Error('same_process_replay_created_rows');
    }
    if (sameProcessReplay.duplicateCount !== 9) throw new Error('same_process_replay_not_fully_duplicate');
    const restarted = restartReplay(manifest);
    report.restartReplay = restarted;
    if (!sameGuestLifecycleSyntheticCounts(initialPass.counts, restarted.counts)) {
      throw new Error('restart_replay_created_rows');
    }
    if (restarted.duplicateCount !== 9) throw new Error('restart_replay_not_fully_duplicate');
  } catch (error) {
    failure = error;
  } finally {
    try {
      cleanup = await cleanupGuestLifecycleSyntheticRows(manifest);
      report.cleanup = cleanup;
    } catch (cleanupError) {
      if (!failure) failure = cleanupError;
      else report.cleanupError = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    }
  }
  report.ok = !failure && cleanup?.zeroResidue === true;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (failure) throw failure;
  process.stdout.write('GUEST_LIFECYCLE_DB_SYNTHETIC_ACCEPTANCE_OK\n');
  process.stdout.write('GUEST_LIFECYCLE_SYNTHETIC_ZERO_RESIDUE_OK\n');
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
