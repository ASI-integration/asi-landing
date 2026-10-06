import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const readinessScript = resolve(root, 'scripts/communication-production-readiness-v1.mjs');
const workflow = readFileSync(
  resolve(root, '.github/workflows/communication-production-completion-v1.yml'),
  'utf8',
);
const textAcceptanceScript = readFileSync(
  resolve(root, 'scripts/telegram-autopilot-live-acceptance.mjs'),
  'utf8',
);

function runReadiness(extraEnv: Record<string, string>, args: string[] = []) {
  const env = {
    ...process.env,
    TELEGRAM_BOT_TOKEN: 'test-token',
    DEEPSEEK_API_KEY: 'test-deepseek-key',
    LLM_SAFE_DOMAIN_ENABLED: '1',
    LLM_ROUTER_PROVIDER: 'deepseek',
    GUEST_CONCIERGE_LLM_MODEL: 'deepseek-v4-flash',
    DRY_RUN_TELEGRAM_OUTBOUND: '0',
    TELEGRAM_DRY_RUN: '0',
    COMMUNICATION_KILL_SWITCH: '0',
    COMMUNICATION_AUTOPILOT_FORCE_DISABLED: '0',
    VOICE_TRANSCRIPTION_DISABLED: '1',
    VOICE_REPLY_ENABLED: '0',
    ...extraEnv,
  };
  const result = spawnSync(process.execPath, [readinessScript, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    report: JSON.parse(result.stdout),
    stderr: result.stderr,
  };
}

describe('production Telegram text readiness', () => {
  it('can be text-active without voice/STT/TTS activation', () => {
    const result = runReadiness({}, ['--require-text-active']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.report.textActivationPrerequisitesMet).toBe(true);
    expect(result.report.textActive).toBe(true);
    expect(result.report.activationPrerequisitesMet).toBe(false);
    expect(result.report.active).toBe(false);
  });

  it('fails closed when Telegram outbound is dry-run suppressed', () => {
    const result = runReadiness(
      { DRY_RUN_TELEGRAM_OUTBOUND: '1' },
      ['--require-text-active'],
    );
    expect(result.status).toBe(6);
    expect(result.report.textActive).toBe(false);
  });

  it('accepts the production-only SUPABASE_URL used by the VPS runtime', () => {
    expect(textAcceptanceScript).toContain(
      "optionalEnv('NEXT_PUBLIC_SUPABASE_URL') ?? optionalEnv('SUPABASE_URL')",
    );
    expect(textAcceptanceScript).toContain(
      'Missing required env NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL',
    );
  });

  it('passes linked reservation context into the production Telegram dry-run', () => {
    expect(textAcceptanceScript).toContain('objectName,');
    expect(textAcceptanceScript).toContain('bookingId,');
    expect(textAcceptanceScript).toContain('objectName: PROPERTY_ID');
  });

  it('provides a text-only production acceptance mode that does not require voice', () => {
    expect(workflow).toContain('- text_acceptance');
    expect(workflow).toContain('readiness|text_acceptance|activate|acceptance|pronunciation_probe');
    expect(workflow).toContain('--require-text-active --probe-network');
    expect(workflow).toContain('run_acceptance_stage text_autopilot');
    expect(workflow).toContain(
      'if [[ "$MODE" == "acceptance" || "$MODE" == "pronunciation_probe" || -n "${INPUT_TEST_CHAT_ID:-}" ]]',
    );
    expect(workflow).not.toContain(
      'if [[ "$MODE" == "text_acceptance" || "$MODE" == "acceptance"',
    );
    const textBlock = workflow.slice(
      workflow.indexOf('            text_acceptance)'),
      workflow.indexOf('            activate)'),
    );
    expect(textBlock).toContain('telegram-autopilot-live-acceptance.mjs');
    expect(textBlock).not.toContain('communication-voice-live-probe-v1.mjs');
    expect(textBlock).not.toContain('telegram-voice-stt-dry-run.mjs');
  });
});
