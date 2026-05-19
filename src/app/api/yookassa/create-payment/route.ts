import { NextResponse } from 'next/server';
import { YOOKASSA_PENDING_REVIEW_MESSAGE } from '@/lib/payments/yookassa-env';

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    {
      status: 'disabled',
      message: YOOKASSA_PENDING_REVIEW_MESSAGE,
    },
    { status: 503 }
  );
}
