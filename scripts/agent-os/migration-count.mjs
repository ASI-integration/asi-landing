import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS_DIR = 'supabase/migrations';

export function migrationsDirectory(repoRoot = DEFAULT_REPO_ROOT) {
  return path.join(path.resolve(repoRoot), MIGRATIONS_DIR);
}

export function listTrackedMigrationFiles(repoRoot = DEFAULT_REPO_ROOT) {
  const directory = migrationsDirectory(repoRoot);
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));
}

export function migrationVersionPrefix(filename) {
  const match = filename.match(/^(\d+)_/);
  if (!match) {
    throw new Error(`${filename} must start with a numeric prefix`);
  }
  return match[1];
}

export function migrationVersionPrefixes(repoRoot = DEFAULT_REPO_ROOT) {
  return listTrackedMigrationFiles(repoRoot).map((filename) => migrationVersionPrefix(filename));
}

export function countTrackedMigrations(repoRoot = DEFAULT_REPO_ROOT) {
  return listTrackedMigrationFiles(repoRoot).length;
}

export function assertUniqueMigrationPrefixes(repoRoot = DEFAULT_REPO_ROOT) {
  const prefixes = migrationVersionPrefixes(repoRoot);
  const unique = new Set(prefixes);
  if (unique.size !== prefixes.length) {
    const duplicates = prefixes.filter((prefix, index) => prefixes.indexOf(prefix) !== index);
    throw new Error(`Duplicate migration prefixes: ${[...new Set(duplicates)].join(', ')}`);
  }
  return prefixes;
}

export function summarizeTrackedMigrations(repoRoot = DEFAULT_REPO_ROOT) {
  const files = listTrackedMigrationFiles(repoRoot);
  const prefixes = files.map((filename) => migrationVersionPrefix(filename));
  assertUniqueMigrationPrefixes(repoRoot);
  return {
    directory: MIGRATIONS_DIR,
    count: files.length,
    uniquePrefixCount: new Set(prefixes).size,
    files,
  };
}
