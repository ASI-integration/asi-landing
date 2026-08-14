import { NextResponse } from 'next/server';

export function requireAdminSecret(request: Request): Response | null {
  const configuredSecret = process.env.ADMIN_SECRET;

  if (!configuredSecret || configuredSecret.trim().length === 0) {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }

  const suppliedSecret = request.headers.get('x-admin-secret');
  if (!suppliedSecret || suppliedSecret !== configuredSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
