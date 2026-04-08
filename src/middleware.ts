import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? '';
  const { pathname } = request.nextUrl;

  const isRuDomain = host.endsWith('.ru');
  const isComDomain = !isRuDomain; // localhost, .com, vercel previews → EN

  // .ru domain → keep RU landing at /ru, but don't force-prefix every route.
  // Otherwise routes like /connect and /dashboard would become /ru/connect and 404.
  if (isRuDomain && pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/ru';
    return NextResponse.redirect(url, { status: 301 });
  }

  // .com domain → must NOT be on /ru path
  if (isComDomain && pathname.startsWith('/ru')) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice(3) || '/';
    return NextResponse.redirect(url, { status: 301 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|api/).*)'],
};
