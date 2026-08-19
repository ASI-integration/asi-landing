import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const workflow = readFileSync(
  resolve(root, '.github/workflows/commercial-mvp-production-completion-v1.yml'),
  'utf8',
);
const databaseAudit = readFileSync(
  resolve(root, 'scripts/commercial-mvp-production-readonly.sql'),
  'utf8',
);

describe('Commercial MVP production completion read-only acceptance', () => {
  it('is manual-only, exact-SHA-gated, and production-environment-gated', () => {
    expect(workflow).toMatch(/\bon:\s*\n\s+workflow_dispatch:/u);
    expect(workflow).not.toMatch(/^\s+(?:push|pull_request|schedule):/mu);
    expect(workflow).toContain('expected_production_sha:');
    expect(workflow).toContain('RUN_COMMERCIAL_MVP_PRODUCTION_READONLY_ACCEPTANCE');
    expect(workflow).toContain('environment: production');
    expect(workflow).toContain('ref: ${{ inputs.expected_production_sha }}');
    expect(workflow).toContain('git merge-base --is-ancestor');
  });

  it('probes webhook authentication only through rejected requests', () => {
    expect(workflow).toContain("probe '/api/telegram/webhook' missing");
    expect(workflow).toContain("probe '/api/telegram/webhook' wrong");
    expect(workflow).toContain("probe '/api/telegram/support-webhook' missing");
    expect(workflow).toContain("probe '/api/telegram/support-webhook' wrong");
    expect(workflow).toContain("if [[ \"$status\" != '403' ]]");
    expect(workflow).toContain('commercial-mvp-invalid-secret');
    expect(workflow).not.toContain('${{ secrets.TELEGRAM_WEBHOOK_SECRET }}');
    expect(workflow).not.toContain('${{ secrets.TELEGRAM_SUPPORT_WEBHOOK_SECRET }}');
  });

  it('keeps the database audit explicitly read-only and fail-closed', () => {
    expect(databaseAudit).toMatch(/^\\pset[\s\S]*BEGIN TRANSACTION READ ONLY;/u);
    expect(databaseAudit).toContain("current_setting('transaction_read_only') <> 'on'");
    expect(databaseAudit).toContain("version = '20260817090000'");
    expect(databaseAudit).toContain("to_regclass('public.telegram_inbound_receipts')");
    expect(databaseAudit).toContain("to_regprocedure('public.claim_telegram_inbound_receipt");
    expect(databaseAudit).toContain('relforcerowsecurity');
    expect(databaseAudit).toContain("table_name = 'tg_property_knowledge'");
    expect(databaseAudit).toContain("'checkin_instructions'");
    expect(databaseAudit).toContain("'checkout_notes'");
    expect(databaseAudit).toContain("WHERE status = 'processed'");
    expect(databaseAudit).toContain('commercial_mvp_durable_inbound_not_exercised');
    expect(databaseAudit).toMatch(/ROLLBACK;\s*$/u);
    expect(databaseAudit).not.toMatch(
      /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE|CALL)\b/mu,
    );
  });

  it('requires persistent operator state and the deployed Commercial MVP source contracts', () => {
    expect(workflow).toContain('commercial_mvp_persistent_comm_state_dir_not_configured');
    expect(workflow).toContain('commercial_mvp_comm_state_dir_inside_release');
    expect(workflow).toContain('PERSISTENT_COMM_STATE_DIR=PASS');
    expect(workflow).toContain(".from('tg_property_knowledge')");
    expect(workflow).toContain("grep -Fq 'prop_A'");
    expect(workflow).toContain('claimTelegramInboundReceipt');
    expect(workflow).toContain('completeTelegramInboundReceipt');
    expect(workflow).toContain('failTelegramInboundReceipt');
    expect(workflow).toContain("const DEFAULT_VOICE = 'Aoede'");
    expect(workflow).toContain('finish the final phrase with a clear natural falling cadence');
  });

  it('does not perform deploy, migration apply, app restart, or live provider acceptance', () => {
    expect(workflow).not.toContain('pm2 restart');
    expect(workflow).not.toContain('supabase db push');
    expect(workflow).not.toContain('supabase migration repair');
    expect(workflow).not.toContain('communication-voice-live-probe-v1.mjs');
    expect(workflow).not.toContain('telegram-autopilot-live-acceptance.mjs');
    expect(workflow).not.toContain('api.telegram.org');
    expect(workflow).not.toContain('--probe-network');
    expect(workflow).not.toContain('set -x');
    expect(workflow).toContain('COMMERCIAL_MVP_PRODUCTION_READONLY_VERDICT=GO');
  });
});
