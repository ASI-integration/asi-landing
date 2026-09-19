#!/usr/bin/env node
/**
 * AO-003 coverage: discover production mutators and require shared owner-gate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INVENTORY = path.join(repoRoot, 'docs/agent-os/production-workflow-inventory.json');
const WORKFLOWS_DIR = path.join(repoRoot, '.github/workflows');
const SHARED_GATE = './.github/workflows/production-owner-gate.yml';
const ENFORCER = 'scripts/agent-os/enforce-production-owner-gate.mjs';

const MUTATION_HINTS = [
  /environment:\s*production\b/,
  /environment:\s*\n\s*name:\s*production\b/,
  /DEPLOY_PRODUCTION|APPLY_.*_TO_PRODUCTION|BACKUP_PRODUCTION/,
  /pm2\s+restart|setWebhook|sendMessage/,
  /psql\b.*production|SUPABASE_DB_URL/,
];

function readInventory() {
  return JSON.parse(fs.readFileSync(INVENTORY, 'utf8'));
}

function listWorkflowFiles() {
  return fs.readdirSync(WORKFLOWS_DIR)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => `.github/workflows/${name}`)
    .sort();
}

function usesSharedGate(yamlText) {
  return yamlText.includes(SHARED_GATE) || yamlText.includes(ENFORCER);
}

function looksLikeProductionMutator(yamlText, relativePath) {
  if (relativePath.endsWith('production-owner-gate.yml')) return false;
  if (/environment:\s*staging\b/.test(yamlText) && !/environment:\s*production\b/.test(yamlText)) {
    return false;
  }
  const productionEnv = /environment:\s*production\b/.test(yamlText)
    || /environment:\s*\n\s*name:\s*production\b/.test(yamlText);
  const mutatingHints = [
    /DEPLOY_PRODUCTION/,
    /APPLY_.*PRODUCTION/,
    /BACKUP_PRODUCTION/,
    /pm2\s+restart/,
    /setWebhook/,
    /sendMessage/,
    /npm run deploy/,
    /rsync /,
    /git archive/,
    /CREATE TABLE|ALTER TABLE|DELETE FROM|INSERT INTO/i,
    /operation.*apply|inputs\.operation/,
  ].some((re) => re.test(yamlText));
  // Heuristic: production environment + mutating/dispatch confirmation phrases,
  // or known mutation verbs even without environment key (e.g. booking-ops-auto-send).
  if (productionEnv && mutatingHints) return true;
  if (!productionEnv && /booking-ops-auto-send|auto-send/.test(relativePath) && /curl|fetch|POST/.test(yamlText)) {
    return true;
  }
  if (!productionEnv && /booking-lifecycle-orchestrator/.test(relativePath) && /acceptance/.test(yamlText)) {
    return true;
  }
  return false;
}

export function checkProductionOwnerGateCoverage(repoRootPath = repoRoot) {
  const inventoryPath = path.join(repoRootPath, 'docs/agent-os/production-workflow-inventory.json');
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const workflowsDir = path.join(repoRootPath, '.github/workflows');
  const files = fs.readdirSync(workflowsDir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => `.github/workflows/${name}`)
    .sort();

  const byPath = new Map(inventory.workflows.map((entry) => [entry.path, entry]));
  const errors = [];
  const classA = inventory.workflows.filter((entry) => entry.class === 'A');

  for (const entry of classA) {
    const absolute = path.join(repoRootPath, entry.path);
    if (!fs.existsSync(absolute)) {
      errors.push(`inventory A workflow missing on disk: ${entry.path}`);
      continue;
    }
    const text = fs.readFileSync(absolute, 'utf8');
    if (!usesSharedGate(text)) {
      errors.push(`uncovered production mutator (no shared gate): ${entry.path}`);
    }
    if (!text.includes('owner_gate_json') && !text.includes(ENFORCER)) {
      errors.push(`production mutator missing owner_gate_json input wiring: ${entry.path}`);
    }
  }

  for (const relative of files) {
    if (relative.endsWith('production-owner-gate.yml')) continue;
    const text = fs.readFileSync(path.join(repoRootPath, relative), 'utf8');
    const inventoried = byPath.get(relative);
    if (!inventoried) {
      if (looksLikeProductionMutator(text, relative)) {
        errors.push(`discovered production mutator missing from inventory: ${relative}`);
      }
      continue;
    }
    if (inventoried.class === 'B' || inventoried.class === 'C') {
      if (usesSharedGate(text) && inventoried.class === 'B') {
        // read-only may optionally call gate; not an error
      }
      if (inventoried.class === 'B' && looksLikeProductionMutator(text, relative) === false) {
        // ok
      }
    }
    if (inventoried.class !== 'A' && looksLikeProductionMutator(text, relative) && inventoried.class === 'C') {
      // non-production falsely flagged is ok if inventory says C and no production env
    }
    if (inventoried.class !== 'A' && /environment:\s*production\b/.test(text) && MUTATION_HINTS.some((re) => re.test(text))) {
      // If inventory says B but file gained mutation hints beyond read-only markers, flag drift
      const readOnlyMarkers = /READ_ONLY|readonly|read-only|SELECT 1|default_transaction_read_only/i.test(text);
      if (!readOnlyMarkers && inventoried.class === 'B' && /APPLY_|DEPLOY_|BACKUP_|pm2\s+restart/.test(text)) {
        errors.push(`inventory class B looks mutating; reclassify or cover: ${relative}`);
      }
    }
  }

  // Inventory must list every workflow file
  for (const relative of files) {
    if (!byPath.has(relative) && !relative.endsWith('production-owner-gate.yml')) {
      // production-owner-gate is in inventory as C; others must be listed
      if (!byPath.has(relative)) {
        errors.push(`workflow not listed in inventory: ${relative}`);
      }
    }
  }

  const uncovered = classA.filter((entry) => {
    const absolute = path.join(repoRootPath, entry.path);
    if (!fs.existsSync(absolute)) return true;
    return !usesSharedGate(fs.readFileSync(absolute, 'utf8'));
  });

  return {
    ok: errors.length === 0 && uncovered.length === 0,
    discoveredMutators: classA.length,
    covered: classA.length - uncovered.length,
    uncovered: uncovered.map((entry) => entry.path),
    uncoveredCount: uncovered.length,
    errors,
  };
}

function main() {
  const result = checkProductionOwnerGateCoverage();
  console.log(JSON.stringify({
    ok: result.ok,
    discoveredMutators: result.discoveredMutators,
    covered: result.covered,
    uncoveredCount: result.uncoveredCount,
    uncovered: result.uncovered,
    errors: result.errors,
  }, null, 2));
  if (!result.ok) process.exit(1);
}

const invokedAsCli = (() => {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(path.resolve(process.argv[1])).toLowerCase()
      === fs.realpathSync(fileURLToPath(import.meta.url)).toLowerCase();
  } catch {
    return false;
  }
})();
if (invokedAsCli) {
  main();
}
