/**
 * RETIRED — this route has been removed.
 *
 * Canonical YooKassa webhook endpoint: POST /api/webhooks/yookassa
 *
 * Update your YooKassa dashboard webhook URL to:
 *   https://<your-domain>/api/webhooks/yookassa
 */
import { NextResponse } from 'next/server';

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'This endpoint is retired. Use /api/webhooks/yookassa' },
    { status: 410 }
  );
}
