import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TEST_FILE = 'src/lib/communication/__tests__/comm-v1-automated-acceptance.test.ts';

function fail(message: string, code = 1): never {
  console.error(`[comm-v1-acceptance] FAIL: ${message}`);
  process.exit(code);
}

function extractResultLine(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('COMM_V1_ACCEPTANCE_RESULT=')) return line;
  }
  return null;
}

function main(): void {
  const result = spawnSync(
    'npx',
    [
      'vitest',
      'run',
      TEST_FILE,
      '--reporter=verbose',
      '--disable-console-intercept',
    ],
    {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: 'test' },
      encoding: 'utf8',
      shell: process.platform === 'win32',
    },
  );

  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (combined.trim()) process.stdout.write(combined.endsWith('\n') ? combined : `${combined}\n`);

  const code = result.status ?? 1;
  const resultLine = extractResultLine(combined);
  if (resultLine) {
    console.log(resultLine);
  } else if (code === 0) {
    // Vitest may swallow console.log depending on reporter; exit 0 means the contour passed.
    console.log(
      'COMM_V1_ACCEPTANCE_RESULT=' +
        JSON.stringify({
          ok: true,
          cycle: 'comm-v1-automated-acceptance-v1',
          checks: { vitest_contour: 'PASS' },
          failures: [],
          evidence: {
            exitCode: 0,
            note: 'result line missing from vitest capture; inferred PASS from exit 0',
          },
        }),
    );
  } else {
    console.log(
      'COMM_V1_ACCEPTANCE_RESULT=' +
        JSON.stringify({
          ok: false,
          cycle: 'comm-v1-automated-acceptance-v1',
          checks: { vitest_contour: 'FAIL' },
          failures: ['vitest failed and COMM_V1_ACCEPTANCE_RESULT line was missing'],
          evidence: { exitCode: code },
        }),
    );
  }

  if (code === 0) {
    console.log('[comm-v1-acceptance] PASS');
    process.exit(0);
  }

  fail(`vitest exited with code ${code}`, code);
}

main();
