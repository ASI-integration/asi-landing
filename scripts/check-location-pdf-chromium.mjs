/**
 * VPS / deploy preflight: confirm Chromium can launch for location report PDFs.
 * Usage: node scripts/check-location-pdf-chromium.mjs
 * Exit 0 = OK, 1 = Chromium missing or launch failed.
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const LINUX_CHROMIUM_CANDIDATES = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
];

function windowsChromiumCandidates() {
  if (process.platform !== 'win32') return [];
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA ?? '';
  return [
    `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
    localAppData ? `${localAppData}\\Google\\Chrome\\Application\\chrome.exe` : null,
    `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    localAppData ? `${localAppData}\\Microsoft\\Edge\\Application\\msedge.exe` : null,
  ].filter(Boolean);
}

const CHROMIUM_LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox'];

function resolveChromiumExecutablePath() {
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (fromEnv) {
    return fs.existsSync(fromEnv) ? fromEnv : undefined;
  }
  for (const candidate of [...LINUX_CHROMIUM_CANDIDATES, ...windowsChromiumCandidates()]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function chromiumPathConfiguredButMissing() {
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (fromEnv && !fs.existsSync(fromEnv)) return fromEnv;
  return undefined;
}

function resolveLocationReportAppBaseUrl() {
  const candidates = [
    process.env.LOCATION_REPORT_PDF_BASE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  ];
  for (const raw of candidates) {
    const value = raw?.trim();
    if (value) return value.replace(/\/$/, '');
  }
  return 'http://127.0.0.1:3000';
}

async function checkLocationReportPdfChromium() {
  const missingConfigured = chromiumPathConfiguredButMissing();
  if (missingConfigured) {
    return {
      ok: false,
      reason: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH not found: ${missingConfigured}`,
    };
  }
  const executablePath = resolveChromiumExecutablePath();
  if (!executablePath) {
    return { ok: false, reason: 'chromium_executable_not_found' };
  }
  try {
    const browser = await chromium.launch({
      headless: true,
      executablePath,
      args: [...CHROMIUM_LAUNCH_ARGS],
    });
    await browser.close();
    return { ok: true, executablePath };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, executablePath, reason };
  }
}

async function main() {
  const baseUrl = resolveLocationReportAppBaseUrl();
  const result = await checkLocationReportPdfChromium();
  const summary = {
    ok: result.ok,
    executablePath: result.executablePath ?? null,
    pdfBaseUrl: baseUrl,
    reason: result.reason ?? null,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, reason: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
