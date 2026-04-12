import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Legacy alias — redirects to the canonical callback handler.
// The registered Google Cloud Console redirect URI is /api/auth/google/callback.
export async function GET(req: Request) {
  const url = new URL(req.url);
  url.pathname = '/api/auth/google/callback';
  return NextResponse.redirect(url);
}
