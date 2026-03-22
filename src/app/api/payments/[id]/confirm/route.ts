import { NextResponse } from 'next/server';
import { confirmPayment, getPaymentRequest } from '@/lib/payments/stub';
import { replyToTelegram } from '@/lib/telegram';

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const id = params.id;
  const payment = getPaymentRequest(id);
  
  if (!payment) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  if (payment.status === 'paid') {
    return NextResponse.json({ message: 'Already paid' });
  }

  const success = confirmPayment(id);
  if (success) {
    await replyToTelegram(payment.chatId, "✅ Payment received, thank you. We are processing your request.");
    return NextResponse.json({ ok: true, message: 'Payment confirmed' });
  }

  return NextResponse.json({ error: 'Failed to confirm' }, { status: 500 });
}
