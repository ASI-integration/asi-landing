import { NextResponse } from 'next/server';
import {
  COMMUNICATION_PILOT_PAYMENT_DESCRIPTION,
  COMMUNICATION_PILOT_PAYMENT_PENDING_MESSAGE,
  COMMUNICATION_PILOT_PRICE_RUB,
  COMMUNICATION_PILOT_SERVICE_TITLE,
} from '@/lib/payments/yookassa-env';

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    {
      status: 'disabled',
      service: COMMUNICATION_PILOT_SERVICE_TITLE,
      description: COMMUNICATION_PILOT_PAYMENT_DESCRIPTION,
      amountRub: COMMUNICATION_PILOT_PRICE_RUB,
      message: COMMUNICATION_PILOT_PAYMENT_PENDING_MESSAGE,
    },
    { status: 503 }
  );
}
