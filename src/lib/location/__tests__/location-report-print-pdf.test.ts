import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import {
  chromiumPathConfiguredButMissing,
  clientMessageForLocationReportPdfError,
  LocationReportPdfError,
  resolveChromiumExecutablePath,
  resolveLocationReportAppBaseUrl,
} from '../location-report-print-pdf';

vi.mock('playwright-core', () => ({
  chromium: { launch: vi.fn() },
}));

const existsSyncMock = vi.spyOn(fs, 'existsSync');

afterEach(() => {
  vi.unstubAllEnvs();
  existsSyncMock.mockReset();
});

describe('resolveChromiumExecutablePath', () => {
  it('uses PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH when the file exists', () => {
    vi.stubEnv('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH', '/opt/chromium/chrome');
    existsSyncMock.mockImplementation((p) => p === '/opt/chromium/chrome');
    expect(resolveChromiumExecutablePath()).toBe('/opt/chromium/chrome');
  });

  it('returns undefined when env path is set but missing on disk', () => {
    vi.stubEnv('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH', '/missing/chromium');
    existsSyncMock.mockReturnValue(false);
    expect(resolveChromiumExecutablePath()).toBeUndefined();
    expect(chromiumPathConfiguredButMissing()).toBe('/missing/chromium');
  });
});

describe('resolveLocationReportAppBaseUrl', () => {
  it('prefers LOCATION_REPORT_PDF_BASE_URL over public URL envs', () => {
    vi.stubEnv('LOCATION_REPORT_PDF_BASE_URL', 'https://pdf.example/');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example');
    expect(resolveLocationReportAppBaseUrl()).toBe('https://pdf.example');
  });
});

describe('clientMessageForLocationReportPdfError', () => {
  it('maps chromium_missing to a short Russian client message', () => {
    const err = new LocationReportPdfError('chromium_missing', 'internal');
    expect(clientMessageForLocationReportPdfError(err)).toMatch(/PDF/);
    expect(clientMessageForLocationReportPdfError(err)).not.toContain('Chromium');
  });
});
