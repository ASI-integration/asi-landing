import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  // Public, non-secret runtime config that the client may need.
  const googleClientId = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '').trim();

  return NextResponse.json({
    googleClientId,
  });
}

