#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArtifact } from './contracts.mjs';
import {
  GENERATED_MANIFEST_PATH,
  generateReleaseManifest,
  readJson,
  stableManifestForComparison,
} from './generate-release-manifest.mjs';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CURRENT_RELEASE_PATH = 'docs/agent-os/CURRENT_RELEASE.md';

const FORBIDDEN_PATTERNS = [
  {
    id: 'baseline-sha-literal',
    source: /`[0-9a-f]{40}`/giu,
  },
  {
    id: 'baseline-sha-table-row',
    source: /\|\s*Baseline SHA\s*\|/giu,
  },
  {
    id: 'tracked-sql-file-count-en',
    source: /\b\d+\s+tracked\s+SQL(?:-|\s)?files?\b/giu,
  },
  {
    id: 'tracked-sql-file-count-ru',
    source: /\b\d+\s+tracked\s+SQL(?:-|\s)?файл/giu,
  },
  {
    id: 'package-version-table-row',
    source: /\|\s*Package version\s*\|/giu,
  },
];

export function findCurrentReleaseViolations(content) {
  const matches = [];
  for (const pattern of FORBIDDEN_PATTERNS) {
    for (const match of content.matchAll(pattern.source)) {
      matches.push({
        patternId: pattern.id,
        match: match[0],
        index: match.index ?? 0,
      });
    }
  }
  return matches;
}

export function checkCurrentReleaseDoc(repoRoot = DEFAULT_REPO_ROOT) {
  const content = fs.readFileSync(path.join(repoRoot, CURRENT_RELEASE_PATH), 'utf8');
  const violations = findCurrentReleaseViolations(content);
  if (violations.length > 0) {
    throw new Error(`CURRENT_RELEASE.md contains manually maintained release fields: ${JSON.stringify(violations)}`);
  }
}

export function checkCommittedReleaseManifest(repoRoot = DEFAULT_REPO_ROOT) {
  const manifestPath = path.join(repoRoot, GENERATED_MANIFEST_PATH);
  invariant(fs.existsSync(manifestPath), `Missing generated manifest: ${GENERATED_MANIFEST_PATH}`);
  const committed = readJson(manifestPath);
  validateArtifact('release-manifest', committed, repoRoot);

  const expected = generateReleaseManifest(repoRoot, { generatedAt: committed.generatedAt });
  const committedStable = stableManifestForComparison(committed);
  const expectedStable = stableManifestForComparison(expected);

  if (JSON.stringify(committedStable) !== JSON.stringify(expectedStable)) {
    throw new Error(`Release manifest drift detected: committed manifest does not match repository state.\nCommitted: ${JSON.stringify(committedStable)}\nExpected: ${JSON.stringify(expectedStable)}`);
  }

  if (typeof committed.generatedAt !== 'string' || Number.isNaN(Date.parse(committed.generatedAt))) {
    throw new Error('Release manifest generatedAt must be a valid ISO-8601 timestamp');
  }

  return { committed, expected };
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function checkReleaseManifest(repoRoot = DEFAULT_REPO_ROOT) {
  checkCurrentReleaseDoc(repoRoot);
  const { committed, expected } = checkCommittedReleaseManifest(repoRoot);
  return {
    ok: true,
    check: 'release-manifest',
    manifestPath: GENERATED_MANIFEST_PATH,
    baselineSha: committed.baselineSha,
    migrationCount: committed.migrations.count,
    activeGateCount: committed.activeGates.length,
    generatedAt: committed.generatedAt,
    matchesRepositoryState: JSON.stringify(stableManifestForComparison(committed))
      === JSON.stringify(stableManifestForComparison(expected)),
  };
}

function main() {
  try {
    const result = checkReleaseManifest(DEFAULT_REPO_ROOT);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
