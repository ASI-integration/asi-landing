/**
 * Temporary debug endpoint — proves what Host/X-Forwarded-* headers the app sees.
 * Protected by DEBUG_SECRET env var. Remove after verifying host detection.
 *
 * Usage:
 *   curl -sS "https://asi-global.ru/api/debug-headers?s=<DEBUG_SECRET>"
 */
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const secret = process.env.DEBUG_SECRET?.trim();
  if (!secret || request.nextUrl.searchParams.get('s') !== secret) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  const h = (name: string) => request.headers.get(name) ?? '(absent)';

  const rawHost =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ??
    request.headers.get('host') ??
    '';
  let resolvedHostname = rawHost;
  try {
    resolvedHostname = new URL(`http://${rawHost}`).hostname;
  } catch {
    // keep rawHost
  }
  const checkoutGuardWouldBlock =
    process.env.HOST_VARIANT === 'ru' || resolvedHostname.endsWith('.ru');

  return Response.json({
    host: h('host'),
    x_forwarded_host: h('x-forwarded-host'),
    x_forwarded_proto: h('x-forwarded-proto'),
    x_real_ip: h('x-real-ip'),
    HOST_VARIANT: process.env.HOST_VARIANT ?? '(not set)',
    resolvedHostname,
    checkoutGuardWouldBlock,
    request_url: request.url,
  });
}
