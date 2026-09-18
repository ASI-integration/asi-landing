/**
 * URL normalization and crawl allow/deny policy for Website Auditor v1.
 * Read-only: never invent write/mutation endpoints as crawl targets.
 */

const SKIP_PATH_PREFIXES = [
  '/api/',
  '/api',
  '/logout',
  '/signout',
  '/sign-out',
  '/auth/',
  '/dashboard/',
  '/admin/',
  '/login/callback',
];

const SKIP_PROTOCOLS = new Set(['mailto:', 'tel:', 'javascript:', 'data:', 'blob:']);

/**
 * @param {string} href
 * @param {string} baseUrl
 * @returns {URL | null}
 */
export function parseAbsoluteUrl(href, baseUrl) {
  const raw = String(href ?? '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  for (const proto of SKIP_PROTOCOLS) {
    if (lower.startsWith(proto)) return null;
  }
  try {
    return new URL(raw, baseUrl);
  } catch {
    return null;
  }
}

/**
 * Normalize a URL for crawl dedupe.
 * - strips hash
 * - strips trailing slash (except root)
 * - drops default query params unless allowlisted
 * - lowercases host
 */
export function normalizeUrl(href, baseUrl, { keepQuery = false } = {}) {
  const url = typeof href === 'string' ? parseAbsoluteUrl(href, baseUrl) : href;
  if (!url) return null;

  url.hash = '';
  url.hostname = url.hostname.toLowerCase();

  if (!keepQuery) {
    url.search = '';
  }

  let path = url.pathname || '/';
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  url.pathname = path || '/';

  return url.href;
}

export function isSameOrigin(candidateHref, baseUrl) {
  const base = new URL(baseUrl);
  const url = parseAbsoluteUrl(candidateHref, baseUrl);
  if (!url) return false;
  return url.origin === base.origin;
}

export function isExternalSocialOrTelegram(href, baseUrl) {
  const url = parseAbsoluteUrl(href, baseUrl);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  return (
    host === 't.me' ||
    host.endsWith('.t.me') ||
    host.includes('telegram') ||
    host.includes('facebook.com') ||
    host.includes('instagram.com') ||
    host.includes('vk.com') ||
    host.includes('twitter.com') ||
    host.includes('x.com') ||
    host.includes('linkedin.com') ||
    host.includes('youtube.com') ||
    host.includes('wa.me')
  );
}

export function isGoogleSearchOrRedirect(href, baseUrl) {
  const url = parseAbsoluteUrl(href, baseUrl);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  if (host.includes('google.') && (url.pathname.includes('/search') || url.pathname.includes('/url'))) {
    return true;
  }
  return host === 'google.com' || host.endsWith('.google.com') || host.endsWith('.google.ru');
}

export function isSkippedPath(pathname) {
  const path = pathname || '/';
  if (SKIP_PATH_PREFIXES.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`) || path.startsWith(p))) {
    // Special-case exact /api vs /api/
    if (path === '/api' || path.startsWith('/api/')) return true;
    if (path.startsWith('/logout') || path.startsWith('/signout') || path.startsWith('/sign-out')) return true;
    if (path.startsWith('/auth/')) return true;
    if (path.startsWith('/dashboard/') || path === '/dashboard') return true;
    if (path.startsWith('/admin/') || path === '/admin') return true;
  }
  if (path === '/api' || path.startsWith('/api/')) return true;
  if (/^\/(logout|signout|sign-out)(\/|$)/i.test(path)) return true;
  if (/^\/(dashboard|admin)(\/|$)/i.test(path)) return true;
  if (/^\/auth(\/|$)/i.test(path)) return true;
  // Likely download / file mutation
  if (/\.(zip|exe|dmg|pkg|msi|csv|xlsx?|docx?|pdf)(\?|$)/i.test(path) && /\/(download|export|mutate)\//i.test(path)) {
    return true;
  }
  return false;
}

/**
 * Decide whether a discovered href should be enqueued for GET crawl.
 */
export function shouldCrawlHref(href, baseUrl, { keepQuery = false } = {}) {
  const raw = String(href ?? '').trim();
  if (!raw || raw.startsWith('#')) {
    return { crawl: false, reason: 'hash-only' };
  }
  const url = parseAbsoluteUrl(raw, baseUrl);
  if (!url) {
    return { crawl: false, reason: 'unparseable-or-protocol' };
  }
  if (!isSameOrigin(url.href, baseUrl)) {
    return { crawl: false, reason: 'external' };
  }
  if (isExternalSocialOrTelegram(url.href, baseUrl)) {
    return { crawl: false, reason: 'social' };
  }
  if (isGoogleSearchOrRedirect(url.href, baseUrl)) {
    return { crawl: false, reason: 'google' };
  }
  if (isSkippedPath(url.pathname)) {
    return { crawl: false, reason: 'skipped-path' };
  }
  if (url.search && !keepQuery) {
    // Discover path without query as crawl target only
    const normalized = normalizeUrl(url.href, baseUrl, { keepQuery: false });
    return { crawl: true, reason: 'strip-query', normalized };
  }
  const normalized = normalizeUrl(url.href, baseUrl, { keepQuery });
  return { crawl: true, reason: 'ok', normalized };
}

/**
 * Resolve hash target existence against a set of element ids.
 */
export function hashTargetExists(hash, elementIds) {
  const id = String(hash || '').replace(/^#/, '');
  if (!id) return true;
  const set = elementIds instanceof Set ? elementIds : new Set(elementIds || []);
  return set.has(id);
}

export function classifyLinkFailure(status) {
  if (status == null) return { severity: 'critical', title: 'Navigation failure' };
  if (status >= 500) return { severity: 'critical', title: 'Internal link returned 5xx' };
  if (status >= 400) return { severity: 'critical', title: 'Internal link returned 4xx' };
  return null;
}
