#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeTrackedMigrations } from './migration-count.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const WATCHED_DOCS = [
  'docs/BOOKING_OPS_STAGING_BOOTSTRAP.md',
];

const FORBIDDEN_PATTERNS = [
  {
    id: 'ordered-sql-file-count',
    source: /\b\d+\s+ordered\s+SQL\s+files?\b/giu,
  },
  {
    id: 'contains-n-migration-files',
    source: /\bcontains\s+\d+\s+(?:ordered\s+)?(?:SQL\s+)?files?\b/giu,
  },
  {
    id: 'n-tracked-sql-files',
    source: /\b\d+\s+tracked\s+SQL(?:-|\s)?files?\b/giu,
  },
];

function findForbiddenMatches(relativePath, content) {
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

function main() {
  const summary = summarizeTrackedMigrations(repoRoot);
  const violations = [];

  for (const relativePath of WATCHED_DOCS) {
    const absolutePath = path.join(repoRoot, relativePath);
    const content = fs.readFileSync(absolutePath, 'utf8');
    const matches = findForbiddenMatches(relativePath, content);
    if (matches.length > 0) {
      violations.push({ relativePath, matches });
    }
  }

  if (violations.length > 0) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: 'Hard-coded migration counts are forbidden in runbook documentation',
      violations,
      trackedMigrationCount: summary.count,
    })}\n`);
    process.exit(1);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: 'migration-count-docs',
    trackedMigrationCount: summary.count,
    uniquePrefixCount: summary.uniquePrefixCount,
    watchedDocs: WATCHED_DOCS,
  })}\n`);
}

main();
