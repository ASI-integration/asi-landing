import { handleYookassaWebhook } from '@/lib/payments/handle-yookassa-webhook';

export async function POST(req: Request) {
  return handleYookassaWebhook(req);
}
