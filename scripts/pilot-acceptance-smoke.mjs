import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const result = spawnSync('npx vitest run src/lib/__tests__/app-url.test.ts src/lib/pilot/__tests__/pilot-acceptance-smoke.test.ts --reporter=verbose', {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

process.exit(result.status === null ? 1 : result.status);
