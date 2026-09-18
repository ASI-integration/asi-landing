/**
 * Report writers for Website Auditor v1.
 */

import fs from 'node:fs';
import path from 'node:path';
import { countBySeverity } from './rule-engine.mjs';
import { RU_PUBLIC_SITE_CONTRACT } from './contracts/ru-public-site.mjs';

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeAuditOutputs({
  outputDir,
  baseUrl,
  pages,
  corpus,
  findings,
  durationMs,
  meta = {},
}) {
  ensureDir(outputDir);
  const counts = countBySeverity(findings);
  const report = {
    meta: {
      tool: 'ASI Website Auditor',
      version: 1,
      baseUrl,
      auditBaseUrl: meta.auditBaseUrl || baseUrl,
      productionVersion: meta.productionVersion ?? 'unknown',
      deployedSha: meta.deployedSha ?? null,
      versionProbeUrl: meta.versionProbeUrl ?? null,
      versionProbeOk: meta.versionProbeOk ?? null,
      homepageContractMode: meta.homepageContractMode ?? 'auto',
      pagesCrawled: pages.length,
      durationMs,
      contractId: RU_PUBLIC_SITE_CONTRACT.id,
      generatedAt: meta.generatedAt || null,
      readOnly: true,
      formsSubmitted: false,
      note: 'productionVersion is from live /api/version — not inferred from repository HEAD',
    },
    summary: counts,
    findings,
  };

  const reportJsonPath = path.join(outputDir, 'report.json');
  const reportMdPath = path.join(outputDir, 'report.md');
  const pagesJsonPath = path.join(outputDir, 'pages.json');

  fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(pagesJsonPath, `${JSON.stringify(corpus, null, 2)}\n`, 'utf8');
  fs.writeFileSync(reportMdPath, renderMarkdown(report), 'utf8');

  return { reportJsonPath, reportMdPath, pagesJsonPath, counts, report };
}

export function renderMarkdown(report) {
  const lines = [];
  lines.push('# ASI Website Audit');
  lines.push('');
  lines.push(`- Audit base URL: ${report.meta.auditBaseUrl || report.meta.baseUrl}`);
  lines.push(`- Production / deployed SHA: ${report.meta.productionVersion ?? 'unknown'}`);
  lines.push(`- Pages crawled: ${report.meta.pagesCrawled}`);
  lines.push(`- Critical: ${report.summary.critical}`);
  lines.push(`- Major: ${report.summary.major}`);
  lines.push(`- Minor: ${report.summary.minor}`);
  lines.push(`- Info: ${report.summary.info}`);
  if (report.meta.durationMs != null) {
    lines.push(`- Duration ms: ${report.meta.durationMs}`);
  }
  lines.push(`- Homepage contract mode: ${report.meta.homepageContractMode ?? 'auto'}`);
  lines.push(`- Read-only: ${report.meta.readOnly}`);
  lines.push(`- Forms submitted: ${report.meta.formsSubmitted}`);
  lines.push('');
  lines.push('## Findings');
  lines.push('');
  if (!report.findings.length) {
    lines.push('_No findings._');
    lines.push('');
    return `${lines.join('\n')}`;
  }
  for (const f of report.findings) {
    lines.push(`### ${f.id}`);
    lines.push('');
    lines.push(`- SEVERITY: ${f.severity}`);
    lines.push(`- SOURCE: ${f.sourcePage || f.url}`);
    if (f.targetUrl) lines.push(`- TARGET: ${f.targetUrl}`);
    lines.push(`- URL: ${f.url}`);
    lines.push(`- CATEGORY: ${f.category}`);
    lines.push(`- TITLE: ${f.title}`);
    lines.push(`- FOUND: ${JSON.stringify(f.evidence)}`);
    lines.push(`- EXPLANATION: ${f.explanation}`);
    lines.push(`- ACTION: ${f.action}`);
    lines.push('');
  }
  return `${lines.join('\n')}`;
}

export function printConsoleSummary({ pagesCrawled, counts, durationMs, productionVersion }) {
  console.log('ASI WEBSITE AUDIT');
  if (productionVersion != null) console.log(`Production SHA: ${productionVersion}`);
  console.log(`Pages crawled: ${pagesCrawled}`);
  console.log(`Critical: ${counts.critical}`);
  console.log(`Major: ${counts.major}`);
  console.log(`Minor: ${counts.minor}`);
  console.log(`Info: ${counts.info}`);
  if (durationMs != null) console.log(`Duration: ${durationMs} ms`);
}

/**
 * Exit code from fail-on policy.
 * @param {'critical'|'major'|'none'} failOn
 */
export function resolveExitCode(counts, failOn = 'critical') {
  if (failOn === 'none') return 0;
  if (failOn === 'major') {
    if (counts.critical > 0 || counts.major > 0) return 2;
    return 0;
  }
  // critical (default)
  if (counts.critical > 0) return 2;
  return 0;
}
