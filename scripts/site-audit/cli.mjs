#!/usr/bin/env node
/**
 * ASI Website Auditor v1 — READ-ONLY public site crawl + contract checks.
 *
 * Usage:
 *   npm run site:audit
 *   npm run site:audit -- --base-url https://asi-global.ru/ru --max-pages 100
 *
 * Never submits forms, never mutates DB, never changes production.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crawlPublicSite } from './crawler.mjs';
import { runRuleEngine } from './rule-engine.mjs';
import { printConsoleSummary, resolveExitCode, writeAuditOutputs } from './report.mjs';
import { probeProductionVersion } from './version-probe.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function parseArgs(argv) {
  const args = {
    baseUrl: 'https://asi-global.ru/ru',
    maxPages: 100,
    outputDir: path.join(ROOT, 'tmp', 'site-audit'),
    failOn: 'critical',
    homepageContract: 'auto',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--base-url') args.baseUrl = argv[++i];
    else if (a === '--max-pages') args.maxPages = Number(argv[++i]);
    else if (a === '--output-dir') args.outputDir = path.resolve(argv[++i]);
    else if (a === '--fail-on') args.failOn = String(argv[++i] || 'critical').toLowerCase();
    else if (a === '--homepage-contract') {
      args.homepageContract = String(argv[++i] || 'auto').toLowerCase();
    } else if (a === '--help' || a === '-h') args.help = true;
  }
  if (!Number.isFinite(args.maxPages) || args.maxPages < 1) {
    throw new Error(`Invalid --max-pages: ${args.maxPages}`);
  }
  if (!['critical', 'major', 'none'].includes(args.failOn)) {
    throw new Error(`Invalid --fail-on: ${args.failOn} (use critical|major|none)`);
  }
  if (!['auto', 'enabled', 'disabled'].includes(args.homepageContract)) {
    throw new Error(
      `Invalid --homepage-contract: ${args.homepageContract} (use enabled|disabled|auto)`,
    );
  }
  return args;
}

function printHelp() {
  console.log(`ASI Website Auditor v1 (read-only)

Usage:
  npm run site:audit -- [options]

Options:
  --base-url <url>                 Start URL (default: https://asi-global.ru/ru)
  --max-pages <n>                  Max pages to crawl (default: 100)
  --output-dir <path>              Output directory (default: tmp/site-audit)
  --fail-on <level>                critical|major|none (default: critical)
  --homepage-contract <mode>       enabled|disabled|auto (default: auto)
`);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(String(err?.message || err));
    process.exit(1);
  }
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const started = Date.now();
  console.log(`ASI Website Auditor v1 — read-only crawl of ${args.baseUrl}`);
  console.log('Policy: GET/navigate only; no form submit; no mutations.');

  const versionMeta = await probeProductionVersion(args.baseUrl);
  console.log(
    `Production version probe: ${versionMeta.productionVersion}${
      versionMeta.versionProbeOk ? '' : ` (${versionMeta.versionProbeError || 'unavailable'})`
    }`,
  );

  let crawl;
  try {
    crawl = await crawlPublicSite({
      baseUrl: args.baseUrl,
      maxPages: args.maxPages,
    });
  } catch (err) {
    if (err?.code === 'CHROMIUM_UNAVAILABLE') {
      console.error(`BLOCKER: ${err.message}`);
      process.exit(1);
    }
    console.error(`Crawler failure: ${err?.message || err}`);
    process.exit(1);
  }

  const findings = runRuleEngine({
    pages: crawl.pages,
    baseUrl: args.baseUrl,
    linkStatusMap: crawl.linkStatusMap,
    linkReferrers: crawl.linkReferrers,
    homepageContractMode: args.homepageContract,
    productionVersion: versionMeta.productionVersion,
  });

  const durationMs = Date.now() - started;
  const { counts, reportJsonPath, reportMdPath, pagesJsonPath } = writeAuditOutputs({
    outputDir: args.outputDir,
    baseUrl: args.baseUrl,
    pages: crawl.pages,
    corpus: crawl.corpus,
    findings,
    durationMs,
    meta: {
      generatedAt: new Date().toISOString(),
      auditBaseUrl: args.baseUrl,
      productionVersion: versionMeta.productionVersion,
      deployedSha: versionMeta.deployedSha,
      versionProbeUrl: versionMeta.versionProbeUrl,
      versionProbeOk: versionMeta.versionProbeOk,
      homepageContractMode: args.homepageContract,
    },
  });

  printConsoleSummary({
    pagesCrawled: crawl.crawledCount,
    counts,
    durationMs,
    productionVersion: versionMeta.productionVersion,
  });
  console.log(`Wrote ${reportJsonPath}`);
  console.log(`Wrote ${reportMdPath}`);
  console.log(`Wrote ${pagesJsonPath}`);

  const top = findings.filter((f) => f.severity === 'critical' || f.severity === 'major').slice(0, 12);
  if (top.length) {
    console.log('Top findings:');
    for (const f of top) {
      const target = f.targetUrl ? ` → ${f.targetUrl}` : '';
      console.log(`- [${f.severity}] ${f.id} @ ${f.sourcePage || f.url}${target}: ${f.title}`);
    }
  }

  process.exit(resolveExitCode(counts, args.failOn));
}

main();
