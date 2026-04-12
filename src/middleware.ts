import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** Hostname from Host / X-Forwarded-Host (handles ports, bracketed IPv6). */
function hostnameFromRequest(request: NextRequest): string {
  const raw =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ??
    request.headers.get('host') ??
    '';
  if (!raw) {
    try {
      return new URL(request.url).hostname;
    } catch {
      return '';
    }
  }
  try {
    return new URL(`http://${raw}`).hostname;
  } catch {
    return raw;
  }
}

/**
 * Public origin for redirects. Uses proxy headers + Host so Location never picks up
 * NextURL's localhost normalization of 127.0.0.1 (::1), which would leak
 * `http://localhost:3000/...` behind nginx or when testing with Host overrides.
 */
function publicOrigin(request: NextRequest): string {
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ??
    request.headers.get('host') ??
    '';
  if (!host) {
    try {
      return new URL(request.url).origin;
    } catch {
      return 'http://localhost';
    }
  }
  let proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (proto !== 'http' && proto !== 'https') {
    try {
      proto = new URL(request.url).protocol.replace(':', '');
    } catch {
      proto = 'http';
    }
  }
  return `${proto}://${host}`;
}

export function middleware(request: NextRequest) {
  const hostname = hostnameFromRequest(request);
  const { pathname, search } = request.nextUrl;

  const isRuDomain = hostname.endsWith('.ru');
  const isComDomain = !isRuDomain; // localhost, .com, vercel previews → EN

  const origin = publicOrigin(request);

  // RU deployment: Stripe/report flows are not offered — send users elsewhere.
  if (isRuDomain) {
    if (
      pathname === '/report' ||
      pathname.startsWith('/report/') ||
      pathname === '/compare' ||
      pathname.startsWith('/compare/')
    ) {
      const dest = new URL('/connect', origin);
      return NextResponse.redirect(dest, { status: 307 });
    }
  }

  // .ru domain → keep RU landing at /ru, but don't force-prefix every route.
  // Otherwise routes like /connect and /dashboard would become /ru/connect and 404.
  if (isRuDomain && pathname === '/') {
    const dest = new URL(`/ru${search}`, origin);
    return NextResponse.redirect(dest, { status: 301 });
  }

  // .com domain → must NOT be on /ru path
  if (isComDomain && pathname.startsWith('/ru')) {
    const path = pathname.slice(3) || '/';
    const dest = new URL(`${path === '/' ? '/' : path}${search}`, origin);
    return NextResponse.redirect(dest, { status: 301 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|api/).*)'],
};
