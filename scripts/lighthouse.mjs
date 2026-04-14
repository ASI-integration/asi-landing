#!/usr/bin/env node
/**
 * Lighthouse audit runner for asi-global.ru public pages.
 *
 * Usage:
 *   node scripts/lighthouse.mjs
 *   BASE_URL=http://localhost:3000 node scripts/lighthouse.mjs
 *   node scripts/lighthouse.mjs --page /ru/otchet-po-dohodnosti-obektov
 *
 * Outputs:
 *   Console: score table per page
 *   Files: lighthouse-reports/<slug>.html and <slug>.json
 */

import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { default: lighthouse } = require('lighthouse');
const chromeLauncher = require('chrome-launcher');

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const REPORTS_DIR = join(ROOT, 'lighthouse-reports');

// ── Config ──────────────────────────────────────────────────
const BASE_URL = process.env.BASE_URL ?? 'https://asi-global.ru';

const DEFAULT_PAGES = [
  '/',
  '/ru',
  '/ru/otchet-po-dohodnosti-obektov',
  '/ru/kak-my-ocenivaem-dohodnost-obektov',
];

// Parse --page flag (pass the path value as a quoted string on Windows)
const pageFlag = process.argv.indexOf('--page');
const PAGES =
  pageFlag !== -1 && process.argv[pageFlag + 1]
    ? [process.argv[pageFlag + 1]]
    : DEFAULT_PAGES;

const LIGHTHOUSE_FLAGS = {
  output: ['html', 'json'],
  logLevel: 'error',
  onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
  // Mobile preset for realistic scores; change to 'desktop' for desktop scores
  formFactor: 'desktop',
  screenEmulation: {
    mobile: false,
    width: 1350,
    height: 940,
    deviceScaleFactor: 1,
    disabled: false,
  },
  throttlingMethod: 'simulate',
};

// Score thresholds — tests will warn (not fail) if below these
const WARN_THRESHOLDS = {
  performance: 50,
  accessibility: 80,
  'best-practices': 80,
  seo: 80,
};

// ── Helpers ─────────────────────────────────────────────────
function slugify(path) {
  return path.replace(/\//g, '-').replace(/^-/, '') || 'home';
}

function scoreLabel(score) {
  if (score === null) return '  N/A';
  const pct = Math.round(score * 100);
  const icon = pct >= 90 ? '✓' : pct >= 50 ? '~' : '✗';
  return `${icon} ${String(pct).padStart(3)}`;
}

function printTable(results) {
  const cols = ['performance', 'accessibility', 'best-practices', 'seo'];
  const header = ['Page'.padEnd(52), ...cols.map((c) => c.slice(0, 12).padEnd(14))].join(' ');
  console.log('\n' + '─'.repeat(header.length));
  console.log(header);
  console.log('─'.repeat(header.length));
  for (const { page, scores } of results) {
    const row = [
      page.padEnd(52),
      ...cols.map((c) => scoreLabel(scores[c]).padEnd(14)),
    ].join(' ');
    console.log(row);
  }
  console.log('─'.repeat(header.length) + '\n');
}

// ── Main ─────────────────────────────────────────────────────
async function runAudit(url) {
  // On Windows, chrome-launcher sometimes fails to clean up the temp profile
  // directory due to EPERM. Providing an explicit userDataDir in the project's
  // own tmp folder avoids that permission issue.
  const tmpDir = join(ROOT, '.lighthouse-tmp');
  mkdirSync(tmpDir, { recursive: true });

  const chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless', '--no-sandbox', '--disable-gpu'],
    userDataDir: tmpDir,
  });

  try {
    const runnerResult = await lighthouse(url, {
      ...LIGHTHOUSE_FLAGS,
      port: chrome.port,
    });
    return runnerResult;
  } finally {
    await chrome.kill();
  }
}

async function main() {
  mkdirSync(REPORTS_DIR, { recursive: true });

  console.log(`\nLighthouse audit — ${BASE_URL}`);
  console.log(`Pages: ${PAGES.join(', ')}\n`);

  const summary = [];
  const warnings = [];

  for (const pagePath of PAGES) {
    const url = `${BASE_URL}${pagePath}`;
    const slug = slugify(pagePath);
    process.stdout.write(`  Auditing ${url} … `);

    try {
      const result = await runAudit(url);
      const { lhr } = result;

      // Save reports
      const [htmlReport, jsonReport] = result.report;
      writeFileSync(join(REPORTS_DIR, `${slug}.html`), htmlReport);
      writeFileSync(join(REPORTS_DIR, `${slug}.json`), jsonReport);

      const scores = {};
      for (const [key, cat] of Object.entries(lhr.categories)) {
        scores[key] = cat.score;
      }

      summary.push({ page: pagePath, scores });

      // Collect warnings
      for (const [cat, threshold] of Object.entries(WARN_THRESHOLDS)) {
        const score = scores[cat];
        if (score !== null && score * 100 < threshold) {
          warnings.push(
            `  WARN  ${pagePath}  ${cat}: ${Math.round(score * 100)} < ${threshold}`,
          );
        }
      }

      console.log('done');
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      summary.push({ page: pagePath, scores: {}, error: err.message });
    }
  }

  printTable(summary);

  if (warnings.length > 0) {
    console.log('Score warnings (below threshold):');
    warnings.forEach((w) => console.log(w));
    console.log();
  }

  console.log(`Reports saved to: ${REPORTS_DIR}`);
  console.log('Open an HTML report: npx serve lighthouse-reports\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
