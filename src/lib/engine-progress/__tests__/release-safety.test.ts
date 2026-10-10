import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const workflow = readFileSync(path.resolve('.github/workflows/deploy-owner-engine-progress.yml'), 'utf8');
const canonical = readFileSync(path.resolve('scripts/deploy-production-systemd-artifact.sh'), 'utf8');

describe('owner dashboard-only deploy safety', () => {
  it('requires exact current main SHA, dedicated confirmation and production environment', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('DEPLOY_OWNER_UI_ONLY');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("^[0-9a-f]{40}$");
    expect(workflow).toContain('gh api');
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
