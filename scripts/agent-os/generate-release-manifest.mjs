#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeTrackedMigrations } from './migration-count.mjs';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const RELEASE_GATES_PATH = 'docs/agent-os/release-gates.json';
export const GENERATED_MANIFEST_PATH = 'docs/agent-os/generated/release-manifest.json';

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function resolveBaselineSha(repoRoot = DEFAULT_REPO_ROOT) {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim().toLowerCase();
  invariant(/^[0-9a-f]{40}$/.test(sha), 'git rev-parse HEAD did not return a valid SHA');
  return sha;
}

export function loadReleaseGates(repoRoot = DEFAULT_REPO_ROOT) {
  const gatesDoc = readJson(path.join(repoRoot, RELEASE_GATES_PATH));
  invariant(gatesDoc.schemaVersion === 'asi.agent-os.release-gates.v1', 'Unexpected release-gates schema version');
  invariant(Array.isArray(gatesDoc.gates) && gatesDoc.gates.length > 0, 'release-gates.json has no gates');
  return gatesDoc;
}

export function resolveActiveGates(repoRoot = DEFAULT_REPO_ROOT) {
  const gatesDoc = loadReleaseGates(repoRoot);
  const activeGates = gatesDoc.gates.map(({ id, workflow }) => {
    const workflowPath = path.join(repoRoot, workflow);
    invariant(fs.existsSync(workflowPath), `Active gate workflow missing: ${workflow}`);
    return { id, workflow };
  });
  return activeGates;
}

export function generateReleaseManifest(repoRoot = DEFAULT_REPO_ROOT, options = {}) {
  const resolvedRoot = path.resolve(repoRoot);
  const gatesDoc = loadReleaseGates(resolvedRoot);
  const packageJson = readJson(path.join(resolvedRoot, 'package.json'));
  const migrationSummary = summarizeTrackedMigrations(resolvedRoot);
  const generatedAt = options.generatedAt ?? new Date().toISOString();

  return {
    schemaVersion: 'asi.agent-os.release-manifest.v1',
    repository: gatesDoc.repository,
    sourceBranch: gatesDoc.sourceBranch,
    baselineSha: resolveBaselineSha(resolvedRoot),
    generatedAt,
    package: {
      name: packageJson.name,
      version: packageJson.version,
    },
    migrations: {
      directory: migrationSummary.directory,
      count: migrationSummary.count,
    },
    activeGates: resolveActiveGates(resolvedRoot),
  };
}

export function stableManifestForComparison(manifest) {
  const { generatedAt, baselineSha, ...rest } = manifest;
  return rest;
}

export function writeReleaseManifest(repoRoot = DEFAULT_REPO_ROOT, options = {}) {
  const manifest = generateReleaseManifest(repoRoot, options);
  const outputPath = path.join(repoRoot, options.outputPath ?? GENERATED_MANIFEST_PATH);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const manifest = args.has('--write')
    ? writeReleaseManifest(DEFAULT_REPO_ROOT)
    : generateReleaseManifest(DEFAULT_REPO_ROOT);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
