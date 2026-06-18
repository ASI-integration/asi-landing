import { RU_PUBLIC_ORIGIN } from '@/config/publicOrigins';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);
const BOGUS_SERVICE_HOSTNAMES = new Set(['dashboard']);

export function isValidPublicHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;
  if (LOCAL_HOSTNAMES.has(host)) return true;
  if (BOGUS_SERVICE_HOSTNAMES.has(host)) return false;
  return host.includes('.');
}

export function normalizeAppPath(pathOrUrl: string): string {
  const value = String(pathOrUrl ?? '').trim();
  if (!value) return '/';
  if (!/^https?:\/\//i.test(value)) {
    return value.startsWith('/') ? value : `/${value}`;
  }
  try {
    const parsed = new URL(value);
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
  } catch {
    return value.startsWith('/') ? value : `/${value}`;
  }
}

export function resolvePublicAppOrigin(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_URL,
    RU_PUBLIC_ORIGIN,
  ];
  for (const raw of candidates) {
    const trimmed = String(raw ?? '').trim().replace(/\/$/, '');
    if (!trimmed) continue;
    try {
      const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      const parsed = new URL(withProtocol);
      if (isValidPublicHostname(parsed.hostname)) {
        return `${parsed.protocol}//${parsed.host}`;
      }
    } catch {
      // skip invalid env value
    }
  }
  return RU_PUBLIC_ORIGIN;
}

/** Root-relative path for in-app navigation. */
export function toAppPath(pathOrUrl: string): string {
  return normalizeAppPath(pathOrUrl);
}

/** Absolute URL for outbound contexts (Telegram, email). Never emits http://dashboard/... */
export function toAppAbsoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    try {
      const parsed = new URL(pathOrUrl);
      if (isValidPublicHostname(parsed.hostname)) {
        return pathOrUrl;
      }
    } catch {
      // rewrite below
    }
    return `${resolvePublicAppOrigin()}${normalizeAppPath(pathOrUrl)}`;
  }
  return `${resolvePublicAppOrigin()}${normalizeAppPath(pathOrUrl)}`;
}

/** Origin for server-side redirects from proxy/request headers. */
export function resolveRedirectOrigin(input: {
  forwardedHost?: string | null;
  host?: string | null;
  forwardedProto?: string | null;
  fallbackOrigin?: string;
}): string {
  const host = (input.forwardedHost ?? input.host ?? '').split(',')[0]?.trim();
  if (host) {
    let proto = input.forwardedProto?.split(',')[0]?.trim();
    if (proto !== 'http' && proto !== 'https') {
      proto = 'https';
    }
    try {
      const hostname = new URL(`http://${host}`).hostname;
      if (isValidPublicHostname(hostname)) {
        return `${proto}://${host}`;
      }
    } catch {
      // fall through to canonical origin
    }
  }
  return input.fallbackOrigin ?? resolvePublicAppOrigin();
}

export function containsBogusDashboardOrigin(value: string): boolean {
  return /https?:\/\/dashboard(?:\/|$)/i.test(value);
}
