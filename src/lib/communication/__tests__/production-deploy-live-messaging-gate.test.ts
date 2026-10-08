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
    expect(workflow).toContain(
      'if [ "${{ inputs.confirm_live_guest_messaging }}" != "ENABLE_LIVE_GUEST_MESSAGING" ]; then',
    );
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
