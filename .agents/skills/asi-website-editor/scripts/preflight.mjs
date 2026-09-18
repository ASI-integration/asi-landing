#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateOwnerGate } from '../../../../scripts/agent-os/contracts.mjs';

const APPLY_ACTION = 'approved_ux_or_public_copy_change';

// Keep in sync with references/ru-public-site-map.md.
export const SUPPORTED_MARKETS = ['ru'];
export const ROUTE_MAP = {
  ru: {
    '/ru': {
      source: 'src/app/ru/page.tsx',
      focusedTest: 'src/app/ru/__tests__/homepage-design.test.ts',
    },
  },
};

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) return null;
  return process.argv[index + 1];
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function targetFor(route) {
  return `ru-public-site:${route}`;
}

export function buildWebsiteEditorPreflight({ market, mode, route, gate = null, expected = null, repoRoot }) {
  const blockers = [];

  if (!SUPPORTED_MARKETS.includes(market)) {
    blockers.push(`Unsupported market: ${market}`);
    return { status: 'BLOCKED', market, mode, route, applyAllowed: false, blockers };
  }

  if (mode !== 'review' && mode !== 'apply') {
    blockers.push(`Unsupported mode: ${mode}`);
    return { status: 'BLOCKED', market, mode, route, applyAllowed: false, blockers };
  }

  const routeEntry = ROUTE_MAP[market]?.[route];
  if (!routeEntry) {
    blockers.push(`No source mapping for route: ${route}`);
    return { status: 'BLOCKED', market, mode, route, applyAllowed: false, blockers };
  }

  const sourceAbsolute = path.join(repoRoot, routeEntry.source);
  if (!fs.existsSync(sourceAbsolute)) {
    blockers.push(`Mapped source does not exist: ${routeEntry.source}`);
    return { status: 'BLOCKED', market, mode, route, source: routeEntry.source, applyAllowed: false, blockers };
  }

  const base = {
    market,
    mode,
    route,
    source: routeEntry.source,
    focusedTest: routeEntry.focusedTest,
  };

  if (mode === 'review') {
    return { ...base, status: 'READY', applyAllowed: false, blockers: [] };
  }

  // mode === 'apply'
  if (!gate) {
    return {
      ...base,
      status: 'AWAITING_OWNER',
      applyAllowed: false,
      blockers: [],
      proposedScope: {
        action: APPLY_ACTION,
        target: targetFor(route),
        scope: `${market} public route ${route} copy only`,
      },
    };
  }

  if (!expected) {
    blockers.push('Missing --expected for gate validation');
    return { ...base, status: 'BLOCKED', applyAllowed: false, blockers };
  }

  if (expected.action !== APPLY_ACTION) {
    blockers.push(`Expected action must be ${APPLY_ACTION}`);
    return { ...base, status: 'BLOCKED', applyAllowed: false, blockers };
  }

  if (expected.target !== targetFor(route)) {
    blockers.push(`Expected target must be ${targetFor(route)}`);
    return { ...base, status: 'BLOCKED', applyAllowed: false, blockers };
  }

  try {
    validateOwnerGate(gate, expected, repoRoot);
    if (gate.action !== APPLY_ACTION) throw new Error('Owner gate action does not match public-copy apply action');
    if (gate.target !== targetFor(route)) throw new Error('Owner gate target does not match requested route');
    return { ...base, status: 'READY_TO_APPLY', applyAllowed: true, blockers: [] };
  } catch (error) {
    return { ...base, status: 'BLOCKED', applyAllowed: false, blockers: [error.message] };
  }
}

function main() {
  const repoRoot = execFileSync('git', ['-C', process.cwd(), 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  try {
    if (path.normalize(repoRoot) !== path.normalize(skillRoot)) throw new Error('Skill must run inside its repository checkout');

    const market = argument('--market');
    const mode = argument('--mode');
    const route = argument('--route');
    if (!market) throw new Error('Missing --market');
    if (!mode) throw new Error('Missing --mode');
    if (!route) throw new Error('Missing --route');

    const gatePath = argument('--gate');
    const expectedPath = argument('--expected');
    const gate = gatePath ? readJson(path.resolve(gatePath)) : null;
    const expected = expectedPath ? readJson(path.resolve(expectedPath)) : null;

    const result = buildWebsiteEditorPreflight({ market, mode, route, gate, expected, repoRoot });
    const ok = result.status !== 'BLOCKED';
    const payload = { ok, ...result };
    if (ok) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    else {
      process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
      process.exit(1);
    }
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
