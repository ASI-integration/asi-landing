import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const taskId = 'dashboard-20260902084317-a08719';
const proofPath = path.join(repoRoot, 'docs/operations/runtime-task-test', `${taskId}.md`);

test('runtime owner task test proof documents the owner request', () => {
  const content = readFileSync(proofPath, 'utf8');
  assert.match(content, /^# test/m);
  assert.match(content, new RegExp(taskId));
});
