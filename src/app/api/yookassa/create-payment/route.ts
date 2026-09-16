import { NextResponse } from 'next/server';
import { createPaymentForProduct } from '@/lib/payments/factory';
import {
  COMMUNICATION_PILOT_PAYMENT_DESCRIPTION,
  COMMUNICATION_PILOT_PAYMENT_PENDING_MESSAGE,
  COMMUNICATION_PILOT_PRICE_RUB,
  COMMUNICATION_PILOT_SERVICE_TITLE,
  COMMUNICATION_PILOT_SERVICE_TYPE,
  getYooKassaConfig,
  isYooKassaEnabled,
} from '@/lib/payments/yookassa-env';

/**
 * Create YooKassa checkout for the ASI MVP catalog product.
 * Client may send objectId/contact/ownerId/idempotencyKey — never a trusted amount.
 */
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

  try {
    getYooKassaConfig();
  } catch (error) {
    return NextResponse.json(
      {
        status: 'misconfigured',
        message: error instanceof Error ? error.message : 'YooKassa configuration invalid',
      },
      { status: 503 },
    );
  }

  let body: {
    objectId?: string;
    contact?: string;
    ownerId?: string;
    idempotencyKey?: string;
    amount?: number;
    amountRub?: number;
    productId?: string;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  // Explicitly ignore any client-supplied amount fields.
  if (body.amount !== undefined || body.amountRub !== undefined) {
    return NextResponse.json(
      { error: 'Client-supplied amount is not accepted' },
      { status: 400 },
    );
  }

  const productId = body.productId?.trim() || COMMUNICATION_PILOT_SERVICE_TYPE;

  try {
    const payment = await createPaymentForProduct({
      productId,
      propertyId: body.objectId?.trim() || undefined,
      guestId: body.contact?.trim() || undefined,
      ownerId: body.ownerId?.trim() || undefined,
      idempotencyKey: body.idempotencyKey?.trim() || undefined,
    });

    return NextResponse.json({
      status: payment.status,
      service: COMMUNICATION_PILOT_SERVICE_TITLE,
      description: COMMUNICATION_PILOT_PAYMENT_DESCRIPTION,
      amountRub: COMMUNICATION_PILOT_PRICE_RUB,
      paymentUrl: payment.paymentUrl ?? null,
      paymentId: payment.id,
      providerPaymentId: payment.providerTransactionId,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Payment create failed' },
      { status: 400 },
    );
  }
}
