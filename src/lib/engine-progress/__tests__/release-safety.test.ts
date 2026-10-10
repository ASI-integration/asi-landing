import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { OWNER_RELEASE_FILES, verifyOwnerReleaseScope } from '../../../../scripts/owner-engine-release-scope.mjs';

const workflow = readFileSync(path.resolve('.github/workflows/deploy-owner-engine-progress.yml'), 'utf8');
const canonical = readFileSync(path.resolve('scripts/deploy-production-systemd-artifact.sh'), 'utf8');

describe('owner dashboard-only deploy safety', () => {
  it('requires exact current main SHA, dedicated confirmation and production environment', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('DEPLOY_OWNER_UI_ONLY');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("^[0-9a-f]{40}$");
    expect(workflow).toContain('gh api');
    expect(workflow).toContain('release/owner-progress-live-baseline-20261010');
    expect(workflow).toContain("ref: ${{ steps.identity.outputs.sha }}");
    expect(workflow).toContain("main_sha: ${{ steps.identity.outputs.main_sha }}");
    expect(workflow).toContain("EXPECTED_PREVIOUS_SHA: ${{ needs.build.outputs.live_sha }}");
    expect(workflow).toContain('Dashboard-only candidate branch changed after scope verification');
    expect(workflow).toContain('environment: production');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('permissions:\n  contents: read');
  });
  it('fails closed without owner session and current GitHub access on server', () => {
    expect(workflow).toContain('^ASI_DEVELOPMENT_OWNER_EMAILS=.+');
    expect(workflow).toContain('^GITHUB_TOKEN=.+');
    expect(workflow).toContain('^SESSION_SECRET=.+');
    expect(workflow).toContain("route.status !== 401");
    expect(workflow).toContain("version.sha !== expected");
  });
  it('preserves existing production env without writing messaging settings or calling providers', () => {
    expect(canonical).toContain('cp "$ENV_FILE" "$ENV_TMP"');
    expect(canonical).toContain('done < "$ENV_SOURCE"');
    expect(workflow).toContain('owner-progress-preserve.env');
    expect(workflow).toContain('scripts/deploy-production-systemd-artifact.sh');
    for (const forbidden of [
      'setWebhook', 'deleteWebhook', 'TELEGRAM_BOT_TOKEN=', 'TELEGRAM_WEBHOOK_SECRET=',
      'DRY_RUN_TELEGRAM_OUTBOUND=0', 'TELEGRAM_DRY_RUN=0', 'COMMUNICATION_KILL_SWITCH=0',
      'COMMUNICATION_AUTOPILOT_FORCE_DISABLED=0', 'ENABLE_LIVE_GUEST_MESSAGING',
    ]) expect(workflow).not.toContain(forbidden);
  });
});

describe('exact production release scope', () => {
  const valid = {
    status: 'ahead', ahead_by: 2, behind_by: 0,
    files: [
      { filename: 'src/app/dashboard/engine-progress/page.tsx', status: 'added' },
      { filename: 'src/app/api/dashboard/engine-progress/route.ts', status: 'added' },
    ],
  };
  it('allows an explicit two-path owner-only delta', () => {
    expect(verifyOwnerReleaseScope(valid)).toEqual({ ok: true, count: 2 });
    expect(OWNER_RELEASE_FILES).toContain('src/app/dashboard/layout.tsx');
  });
  it('rejects unrelated Booking Ops, Telegram and public site changes', () => {
    for (const filename of [
      'src/app/api/early-access/leads/route.ts',
      'src/lib/booking-ops/lead-store.ts',
      '.github/workflows/deploy.yml',
      'src/lib/communication/telegram.ts',
    ]) {
      expect(verifyOwnerReleaseScope({
        ...valid, files: [...valid.files, { filename, status: 'modified' }],
      }).ok).toBe(false);
    }
  });
  it('rejects missing code, renames, duplicates, deleted or divergent diff', () => {
    expect(verifyOwnerReleaseScope({ ...valid, status: 'diverged' }).ok).toBe(false);
    expect(verifyOwnerReleaseScope({ ...valid, behind_by: 1 }).ok).toBe(false);
    expect(verifyOwnerReleaseScope({ ...valid, ahead_by: 26 }).ok).toBe(false);
    expect(verifyOwnerReleaseScope({ ...valid, files: valid.files.slice(0, 1) }).ok).toBe(false);
    expect(verifyOwnerReleaseScope({ ...valid, files: [...valid.files, valid.files[0]] }).ok).toBe(false);
    expect(verifyOwnerReleaseScope({ ...valid, files: [{ ...valid.files[0], status: 'removed' }, valid.files[1]] }).ok).toBe(false);
    expect(verifyOwnerReleaseScope({ ...valid, files: [{ ...valid.files[0], previous_filename: 'foo' }, valid.files[1]] }).ok).toBe(false);
  });
});
