import { NextResponse } from 'next/server';
import { createPaymentRequest } from '@/lib/payments/factory';
import {
  COMMUNICATION_PILOT_PAYMENT_DESCRIPTION,
  COMMUNICATION_PILOT_PAYMENT_PENDING_MESSAGE,
  COMMUNICATION_PILOT_PRICE_KOPEKS,
  COMMUNICATION_PILOT_PRICE_RUB,
  COMMUNICATION_PILOT_SERVICE_TITLE,
  COMMUNICATION_PILOT_SERVICE_TYPE,
  isYooKassaEnabled,
} from '@/lib/payments/yookassa-env';

export async function POST(req: Request): Promise<NextResponse> {
  if (!isYooKassaEnabled()) {
    return NextResponse.json(
      {
        status: 'disabled',
        service: COMMUNICATION_PILOT_SERVICE_TITLE,
        description: COMMUNICATION_PILOT_PAYMENT_DESCRIPTION,
        amountRub: COMMUNICATION_PILOT_PRICE_RUB,
        message: COMMUNICATION_PILOT_PAYMENT_PENDING_MESSAGE,
      },
      { status: 503 },
    );
  }

  let body: { objectId?: string; contact?: string } = {};
  try {
    body = (await req.json()) as { objectId?: string; contact?: string };
  } catch {
    body = {};
  }

  const payment = await createPaymentRequest({
    amount: COMMUNICATION_PILOT_PRICE_KOPEKS,
    currency: 'RUB',
    propertyId: body.objectId?.trim() || undefined,
    guestId: body.contact?.trim() || undefined,
    description: COMMUNICATION_PILOT_PAYMENT_DESCRIPTION,
    serviceType: COMMUNICATION_PILOT_SERVICE_TYPE,
    provider: 'yookassa',
  });

  return NextResponse.json({
    status: payment.status,
    service: COMMUNICATION_PILOT_SERVICE_TITLE,
    description: COMMUNICATION_PILOT_PAYMENT_DESCRIPTION,
    amountRub: COMMUNICATION_PILOT_PRICE_RUB,
    paymentUrl: payment.paymentUrl ?? null,
    paymentId: payment.id,
  });
}
