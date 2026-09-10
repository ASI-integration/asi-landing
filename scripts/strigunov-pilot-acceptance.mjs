#!/usr/bin/env node
/**
 * SP-09 — Strigunov Pilot automated acceptance harness (mock / CI).
 * Runs named stages from STRIGUNOV_PILOT_ACCEPTANCE.md §6.
 *
 * Live Bridge/runner/Telegram delivery is SP-10 — this command is CI-safe mock mode.
 *
 * Usage:
 *   npm run acceptance:strigunov-pilot
 *   node scripts/strigunov-pilot-acceptance.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STAGE_IDS = [
  'pilot_identity',
  'pilot_template_policy',
  'pilot_create_bridge',
  'pilot_runner_execute',
  'pilot_result_card',
  'pilot_telegram_silent_success',
  'pilot_telegram_blocked',
  'pilot_authz_isolation',
  'pilot_readiness_failclosed',
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const landingRoot = path.resolve(__dirname, '..');
const acceptanceTest = path.join(
  landingRoot,
  'src/lib/pilot/__tests__/strigunov-pilot-acceptance.test.ts',
);

function printHeader() {
  process.stdout.write('STRIGUNOV PILOT ACCEPTANCE (SP-09 mock)\n');
  process.stdout.write(`Stages: ${STAGE_IDS.join(', ')}\n`);
  process.stdout.write('Live Bridge/runner/Telegram delivery: LIVE NOT PROVEN (SP-10)\n\n');
}

function runVitest() {
  const args = [
    'vitest',
    'run',
    acceptanceTest,
    '--reporter=verbose',
  ];
  const result = spawnSync('npx', args, {
    cwd: landingRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  return result.status ?? 1;
}

function runRuntimeTelegramUnit() {
  const runtimeRoot = process.env.ASI_OS_RUNTIME_ROOT
    || path.resolve(landingRoot, '../asi-os-runtime');
  const telegramTest = path.join(runtimeRoot, 'tests/strigunov-pilot-telegram-profile.test.mjs');
  if (!existsSync(telegramTest)) {
    process.stdout.write(
      '[optional] asi-os-runtime SP-01 telegram unit tests not found beside landing — skipped (landing harness already asserts matrix via events import).\n',
    );
    return 0;
  }
  process.stdout.write('\n[optional] Running asi-os-runtime SP-01 telegram profile unit tests…\n');
  const result = spawnSync(process.execPath, ['--test', telegramTest], {
    cwd: runtimeRoot,
    stdio: 'inherit',
    env: process.env,
  });
  return result.status ?? 1;
}

function main() {
  printHeader();
  if (!existsSync(acceptanceTest)) {
    process.stderr.write(`Missing acceptance test: ${acceptanceTest}\n`);
    process.exit(2);
  }

  const vitestStatus = runVitest();
  if (vitestStatus !== 0) {
    process.stderr.write('\nSP-09 FAIL — see failed stage:pilot_* above.\n');
    process.exit(vitestStatus);
  }

  const telegramStatus = runRuntimeTelegramUnit();
  if (telegramStatus !== 0) {
    process.stderr.write('\nSP-09 FAIL — runtime telegram unit stage failed.\n');
    process.exit(telegramStatus);
  }

  process.stdout.write('\n## SP-09 STAGE MATRIX\n');
  for (const stage of STAGE_IDS) {
    process.stdout.write(`- ${stage}: PASS (mock)\n`);
  }
  process.stdout.write('- pilot_runner_execute live Bridge claim: LIVE NOT PROVEN (SP-10)\n');
  process.stdout.write('- live Telegram delivery: LIVE NOT PROVEN (SP-10)\n');
  process.stdout.write('\nSP-09 PASS (automated mock harness)\n');
  process.exit(0);
}

main();
