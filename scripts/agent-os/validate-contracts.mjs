#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateContractBundle } from './contracts.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

try {
  const result = validateContractBundle(repoRoot);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exit(1);
}
