import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('privileged recovery helper preserves logs, no-retry, gold, and work dir mode', () => {
  const proof = fileURLToPath(new URL('./prove-dispatcher-recovery.sh', import.meta.url));
  const source = fileURLToPath(new URL('./', import.meta.url));
  if (process.platform === 'win32') {
    const script = `mkdir -p /mnt/hostc\nmountpoint -q /mnt/hostc || mount -t drvfs C: /mnt/hostc\nexport ASI_NODE=/root/node20/bin/node\nexport SRC=/mnt/hostc/ASI/worktrees/landing/dispatcher-recovery/scripts/ci\nbash "$SRC/prove-dispatcher-recovery.sh"\n`;
    const wrapped = spawnSync('wsl.exe', ['-d', 'ASI-Strigunov4-Restore', '-u', 'root', '--', 'bash', '-s'], {
      input: script,
      encoding: 'utf8',
      timeout: 120000,
    });
    assert.equal(wrapped.status, 0, `${wrapped.stdout || ''}${wrapped.stderr || ''}`);
    assert.match(`${wrapped.stdout || ''}`, /RECOVERY_HELPER_PROVED/);
    return;
  }
  const result = spawnSync('bash', [proof], {
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, SRC: source },
  });
  assert.equal(result.status, 0, `${result.stdout || ''}${result.stderr || ''}`);
  assert.match(`${result.stdout || ''}`, /RECOVERY_HELPER_PROVED/);
});
