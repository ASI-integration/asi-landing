import { NextResponse } from 'next/server';
import { getPaymentById, updatePaymentStatusById } from '@/lib/payments/db';
import { sendPaymentConfirmation } from '@/lib/communication/notifications';

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const payment = await getPaymentById(params.id);

  if (!payment) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  if (payment.status === 'paid') {
    return NextResponse.json({ message: 'Already paid' });
  }

  const updated = await updatePaymentStatusById(payment.id, 'paid');

  if (updated && payment.chatId) {
    await sendPaymentConfirmation({
      paymentId: payment.id,
      chatId: parseInt(payment.chatId, 10),
      amount: payment.amount,
      currency: payment.currency,
      serviceType: payment.serviceType,
    });
  }

  return updated
    ? NextResponse.json({ ok: true, message: 'Payment confirmed' })
    : NextResponse.json({ error: 'Failed to confirm' }, { status: 500 });
}
