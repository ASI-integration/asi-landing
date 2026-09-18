/**
 * Read-only Playwright crawler for Website Auditor v1.
 * GET/navigate only — never fills or submits forms.
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { isHtmlContentType, mediaType } from './content-type.mjs';
import { browserExtractSource, toCorpusRecord } from './page-extractor.mjs';
import { normalizeUrl, shouldCrawlHref } from './url-policy.mjs';

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

function playwrightChromiumCandidates() {
  const localAppData = process.env.LOCALAPPDATA ?? '';
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const roots = [
    localAppData ? `${localAppData}\\ms-playwright` : null,
    home ? `${home}/.cache/ms-playwright` : null,
    home ? `${home}/Library/Caches/ms-playwright` : null,
  ].filter(Boolean);

  /** @type {string[]} */
  const found = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.startsWith('chromium')) continue;
        const win = path.join(root, entry.name, 'chrome-win64', 'chrome.exe');
        const mac = path.join(root, entry.name, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
        const linux = path.join(root, entry.name, 'chrome-linux', 'chrome');
        for (const candidate of [win, mac, linux]) {
          if (fs.existsSync(candidate)) found.push(candidate);
        }
      }
    } catch {
      // ignore
    }
  }
  return found;
}

export function resolveChromiumExecutablePath() {
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (fromEnv) return fs.existsSync(fromEnv) ? fromEnv : undefined;
  for (const candidate of [
    ...playwrightChromiumCandidates(),
    ...LINUX_CHROMIUM_CANDIDATES,
    ...windowsChromiumCandidates(),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Record that sourcePage links to targetUrl (normalized keys preferred).
 * @param {Record<string, Set<string>>} referrerSets
 * @param {string} targetUrl
 * @param {string} sourcePage
 */
function addReferrer(referrerSets, targetUrl, sourcePage) {
  if (!targetUrl || !sourcePage) return;
  if (!referrerSets[targetUrl]) referrerSets[targetUrl] = new Set();
  referrerSets[targetUrl].add(sourcePage);
}

/**
 * @param {{ baseUrl: string, maxPages?: number }} options
 */
export async function crawlPublicSite(options) {
  const baseUrl = options.baseUrl;
  const maxPages = options.maxPages ?? 100;
  const executablePath = resolveChromiumExecutablePath();
  if (!executablePath) {
    const err = new Error(
      'Chromium/Chrome executable not found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH or install Chrome/Edge.',
    );
    err.code = 'CHROMIUM_UNAVAILABLE';
    throw err;
  }

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent: 'ASI-Website-Auditor/1.0 (+read-only; no form submit)',
    javaScriptEnabled: true,
  });

  /** @type {object[]} */
  const pages = [];
  /** @type {Record<string, number|null>} */
  const linkStatusMap = {};
  /** @type {Record<string, Set<string>>} */
  const referrerSets = {};
  const queue = [];
  const seen = new Set();

  const startNorm = normalizeUrl(baseUrl, baseUrl);
  if (!startNorm) {
    await browser.close();
    throw new Error(`Invalid base URL: ${baseUrl}`);
  }
  queue.push(startNorm);
  seen.add(startNorm);

  const extract = browserExtractSource();

  try {
    while (queue.length > 0 && pages.length < maxPages) {
      const requestedUrl = queue.shift();
      const page = await context.newPage();
      const consoleErrors = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      page.on('pageerror', (err) => {
        consoleErrors.push(String(err?.message || err));
      });

      let status = null;
      let finalUrl = requestedUrl;
      let navigationError = null;
      let extracted = null;
      let contentType = '';
      let isHtmlDocument = false;

      try {
        const response = await page.goto(requestedUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 45000,
        });
        status = response?.status() ?? null;
        finalUrl = page.url();
        contentType = response?.headers()?.['content-type'] || '';
        isHtmlDocument = isHtmlContentType(contentType);
        // Fallback: if header missing but navigation succeeded, treat as HTML for extract.
        if (!contentType && status && status < 400) {
          isHtmlDocument = true;
        }
        if (isHtmlDocument) {
          // Read-only extract — never click/type/submit
          extracted = await page.evaluate(extract);
        }
      } catch (err) {
        navigationError = String(err?.message || err);
      } finally {
        await page.close().catch(() => {});
      }

      linkStatusMap[requestedUrl] = status;

      const record = {
        requestedUrl,
        finalUrl,
        status,
        navigationError,
        contentType: mediaType(contentType) || contentType || '',
        isHtmlDocument,
        consoleErrors: consoleErrors.slice(0, 20),
        title: extracted?.title || '',
        metaDescription: extracted?.metaDescription || '',
        canonicalUrl: extracted?.canonicalUrl || '',
        h1Count: extracted?.h1Count ?? 0,
        h1Texts: extracted?.h1Texts || [],
        h2Texts: extracted?.h2Texts || [],
        visibleText: extracted?.visibleText || '',
        ctaLabels: extracted?.ctaLabels || [],
        internalLinks: extracted?.internalLinks || [],
        hashRefs: extracted?.hashRefs || [],
        externalLinks: extracted?.externalLinks || [],
        forms: extracted?.forms || [],
        elementIds: extracted?.elementIds || [],
      };
      pages.push(record);

      if (!extracted || (status && status >= 400)) continue;

      const sourceKey = normalizeUrl(finalUrl || requestedUrl, baseUrl) || requestedUrl;
      for (const href of extracted.internalLinks || []) {
        const decision = shouldCrawlHref(href, baseUrl);
        if (!decision.crawl || !decision.normalized) continue;
        addReferrer(referrerSets, decision.normalized, sourceKey);
        if (seen.has(decision.normalized)) continue;
        if (pages.length + queue.length >= maxPages) break;
        seen.add(decision.normalized);
        queue.push(decision.normalized);
      }
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  pages.sort((a, b) => String(a.finalUrl).localeCompare(String(b.finalUrl)));

  /** @type {Record<string, string[]>} */
  const linkReferrers = {};
  for (const [target, sources] of Object.entries(referrerSets)) {
    linkReferrers[target] = [...sources].sort((a, b) => a.localeCompare(b));
  }

  return {
    pages,
    linkStatusMap,
    linkReferrers,
    corpus: pages.map(toCorpusRecord),
    crawledCount: pages.length,
  };
}
