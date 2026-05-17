import fs from 'node:fs';
import { chromium } from 'playwright-core';

export type LocationReportPdfErrorCode =
  | 'chromium_missing'
  | 'chromium_launch_failed'
  | 'print_page_failed'
  | 'pdf_render_empty_or_invalid';

export class LocationReportPdfError extends Error {
  readonly code: LocationReportPdfErrorCode;

  constructor(code: LocationReportPdfErrorCode, message: string) {
    super(message);
    this.name = 'LocationReportPdfError';
    this.code = code;
  }
}

const LINUX_CHROMIUM_CANDIDATES = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
] as const;

const CHROMIUM_LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox'] as const;

export function resolveChromiumExecutablePath(): string | undefined {
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (fromEnv) {
    return fs.existsSync(fromEnv) ? fromEnv : undefined;
  }
  for (const candidate of LINUX_CHROMIUM_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function chromiumPathConfiguredButMissing(): string | undefined {
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (fromEnv && !fs.existsSync(fromEnv)) return fromEnv;
  return undefined;
}

export function resolveLocationReportAppBaseUrl(): string {
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

export function buildLocationReportPrintPageUrl(reportId: string, baseUrl = resolveLocationReportAppBaseUrl()): string {
  return `${baseUrl}/ru/location-report/${encodeURIComponent(reportId)}/print`;
}

export function locationReportPdfFilename(reportId: string): string {
  const safeReportId = reportId.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120) || 'report';
  return `location-report-${safeReportId}.pdf`;
}

function warnIfPdfBaseUrlLooksLocal(baseUrl: string): void {
  if (process.env.NODE_ENV === 'production' && /127\.0\.0\.1|localhost/i.test(baseUrl)) {
    console.warn(
      '[location-report-pdf] LOCATION_REPORT_PDF_BASE_URL is unset; using loopback. Set it to the public site URL on VPS.',
    );
  }
}

function assertChromiumExecutable(): string {
  const missingConfigured = chromiumPathConfiguredButMissing();
  if (missingConfigured) {
    throw new LocationReportPdfError(
      'chromium_missing',
      `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH points to a missing file: ${missingConfigured}`,
    );
  }
  const executablePath = resolveChromiumExecutablePath();
  if (!executablePath) {
    throw new LocationReportPdfError(
      'chromium_missing',
      'Chromium executable not found. Install chromium on the server or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.',
    );
  }
  return executablePath;
}

export type LocationReportPdfChromiumCheck = {
  ok: boolean;
  executablePath?: string;
  reason?: string;
};

/** Lightweight preflight for deploy scripts — launches and closes Chromium once. */
export async function checkLocationReportPdfChromium(): Promise<LocationReportPdfChromiumCheck> {
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

export async function renderLocationReportPdfFromPrintRoute(reportId: string): Promise<Buffer> {
  const baseUrl = resolveLocationReportAppBaseUrl();
  warnIfPdfBaseUrlLooksLocal(baseUrl);
  const printUrl = buildLocationReportPrintPageUrl(reportId, baseUrl);
  const executablePath = assertChromiumExecutable();

  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: [...CHROMIUM_LAUNCH_ARGS],
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new LocationReportPdfError(
      'chromium_launch_failed',
      `Chromium launch failed (${executablePath}): ${detail}`,
    );
  }

  try {
    const page = await browser.newPage();
    try {
      await page.goto(printUrl, { waitUntil: 'networkidle', timeout: 60_000 });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new LocationReportPdfError(
        'print_page_failed',
        `Print page load failed (${printUrl}): ${detail}`,
      );
    }
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '12mm', bottom: '14mm', left: '12mm' },
    });
    const buffer = Buffer.from(pdf);
    if (buffer.length < 128 || buffer.subarray(0, 4).toString('utf8') !== '%PDF') {
      throw new LocationReportPdfError(
        'pdf_render_empty_or_invalid',
        'Chromium returned empty or non-PDF bytes',
      );
    }
    return buffer;
  } finally {
    await browser.close();
  }
}

export const LOCATION_REPORT_PDF_CLIENT_MESSAGES_RU: Record<LocationReportPdfErrorCode | 'unknown', string> = {
  chromium_missing: 'Сервис PDF временно недоступен. Попробуйте позже.',
  chromium_launch_failed: 'Сервис PDF временно недоступен. Попробуйте позже.',
  print_page_failed: 'Не удалось сформировать PDF. Откройте отчёт в браузере.',
  pdf_render_empty_or_invalid: 'Не удалось сформировать PDF. Откройте отчёт в браузере.',
  unknown: 'Не удалось сформировать PDF. Попробуйте позже.',
};

export function clientMessageForLocationReportPdfError(err: unknown): string {
  if (err instanceof LocationReportPdfError) {
    return LOCATION_REPORT_PDF_CLIENT_MESSAGES_RU[err.code];
  }
  return LOCATION_REPORT_PDF_CLIENT_MESSAGES_RU.unknown;
}

export function logLocationReportPdfFailure(reportId: string, err: unknown): void {
  if (err instanceof LocationReportPdfError) {
    console.error('[location-report-pdf]', {
      reportId,
      code: err.code,
      message: err.message,
      baseUrl: resolveLocationReportAppBaseUrl(),
      chromiumPath: resolveChromiumExecutablePath() ?? chromiumPathConfiguredButMissing() ?? null,
    });
    return;
  }
  console.error('[location-report-pdf]', {
    reportId,
    code: 'unknown',
    message: err instanceof Error ? err.message : String(err),
  });
}
