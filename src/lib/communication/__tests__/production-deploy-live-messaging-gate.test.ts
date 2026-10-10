import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/deploy.yml'),
  'utf8',
);

describe('production deploy live messaging owner gate', () => {
  it('requires a second explicit confirmation before live Telegram is enabled', () => {
    expect(workflow).toContain('confirm_live_guest_messaging:');
    expect(workflow).toContain('required: true');
    expect(workflow).toContain('ENABLE_LIVE_GUEST_MESSAGING');
    expect(workflow).toContain('PRESERVE_EXISTING_MESSAGING');
    expect(workflow).toContain('case "${OWNER_LIVE_MESSAGING_CONFIRMATION}" in');
    expect(workflow).toContain('ENABLE_LIVE_GUEST_MESSAGING|PRESERVE_EXISTING_MESSAGING');
    expect(workflow).toContain("if: inputs.confirm_live_guest_messaging == 'ENABLE_LIVE_GUEST_MESSAGING'");
    expect(workflow).toContain("if: inputs.confirm_live_guest_messaging == 'PRESERVE_EXISTING_MESSAGING'");
  });

  it('passes user-controlled inputs as environment values, never inline shell code', () => {
    expect(workflow).toContain('OWNER_DEPLOY_CONFIRMATION: ${{ inputs.confirm_production_deploy }}');
    expect(workflow).toContain('OWNER_LIVE_MESSAGING_CONFIRMATION: ${{ inputs.confirm_live_guest_messaging }}');
    expect(workflow).toContain('REQUESTED_RELEASE_REF: ${{ inputs.sha }}');
    expect(workflow).toContain('REF_INPUT="${REQUESTED_RELEASE_REF}"');
    expect(workflow).not.toContain('if [ "${{ inputs.confirm_production_deploy }}"');
    expect(workflow).not.toContain('if [ "${{ inputs.confirm_live_guest_messaging }}"');
    expect(workflow).not.toContain('REF_INPUT="${{ inputs.sha }}"');
  });

  it('keeps the risky production flags behind the confirmation job', () => {
    const confirmationIndex = workflow.indexOf('confirm_live_guest_messaging');
    const liveOutboundIndex = workflow.indexOf("printf 'DRY_RUN_TELEGRAM_OUTBOUND=0\\n'");
    const telegramDryRunIndex = workflow.indexOf("printf 'TELEGRAM_DRY_RUN=0\\n'");
    const killSwitchIndex = workflow.indexOf("printf 'COMMUNICATION_KILL_SWITCH=0\\n'");

    expect(confirmationIndex).toBeGreaterThanOrEqual(0);
    expect(liveOutboundIndex).toBeGreaterThan(confirmationIndex);
    expect(telegramDryRunIndex).toBeGreaterThan(confirmationIndex);
    expect(killSwitchIndex).toBeGreaterThan(confirmationIndex);
  });
});

describe('preserve existing messaging deployment mode', () => {
  it('preserves stored Telegram settings and never updates the live webhook', () => {
    const safeMode = workflow.slice(
      workflow.indexOf('      - name: Prepare production environment (preserve existing messaging)'),
      workflow.indexOf('      - name: Deploy systemd release over SSH'),
    );
    expect(safeMode).toContain("printf 'NODE_ENV=production\\nPORT=3000\\n' > production.env");
    expect(safeMode).not.toMatch(/TELEGRAM|COMMUNICATION_|WEBHOOK|AUTO_SEND_RUNNER_SECRET/);
    expect(workflow).toContain('test -s /var/www/asi/shared/.env.production.local');
    expect(workflow).toContain("if: inputs.confirm_live_guest_messaging == 'ENABLE_LIVE_GUEST_MESSAGING'");
    expect(workflow).toContain("OWNER_LIVE_MESSAGING_CONFIRMATION: ${{ inputs.confirm_live_guest_messaging }}");
    const webhookSection = workflow.slice(workflow.indexOf('      - name: Ensure Telegram production webhook'));
    expect(webhookSection).toMatch(/if: inputs\.confirm_live_guest_messaging == 'ENABLE_LIVE_GUEST_MESSAGING'/);
  });
});
