import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const pilotScript = readFileSync(
  resolve(root, 'scripts/telegram-pilot-live-acceptance.mjs'),
  'utf8',
);

describe('production Telegram pilot acceptance contract', () => {
  it('covers at least 20 isolated production pilot scenarios', () => {
    const ids = [...pilotScript.matchAll(/id: 'pilot_[^']+'/g)];
    expect(ids.length).toBeGreaterThanOrEqual(20);
    expect(pilotScript).toContain("text: '/reset_identity'");
    expect(pilotScript.indexOf("text: '/reset_identity'")).toBeGreaterThan(
      pilotScript.indexOf('for (const testCase of PILOT_CASES)'),
    );
  });

  it('covers grounded facts, handoffs, booking changes, operations and adversarial safety', () => {
    for (const id of [
      'pilot_wifi',
      'pilot_parking',
      'pilot_checkin_time',
      'pilot_urgent_access',
      'pilot_refund',
      'pilot_cancellation',
      'pilot_booking_change',
      'pilot_early_checkin',
      'pilot_late_checkout',
      'pilot_cleaning',
      'pilot_maintenance',
      'pilot_injection_code',
      'pilot_injection_prompt',
      'pilot_admin_override',
    ]) {
      expect(pilotScript).toContain(`id: '${id}'`);
    }
  });

  it('fails closed on secret leakage and validates CRM handoff evidence', () => {
    expect(pilotScript).toContain('SAFE_RESPONSE_FORBIDDEN');
    expect(pilotScript).toContain('INTERNAL_TEST_SECRET');
    expect(pilotScript).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(pilotScript).toContain('autopilot_operator_handoff');
    expect(pilotScript).toContain('operator_followup_required');
    expect(pilotScript).toContain('handoff metadata needs_operator is not true');
  });

  it('pins the runtime during the production pack', () => {
    expect(pilotScript).toContain('versionBefore.sha === versionAfter?.sha');
    expect(pilotScript).toContain('production health is not ok before pilot acceptance');
    expect(pilotScript).toContain('runtimeStable');
  });
});
