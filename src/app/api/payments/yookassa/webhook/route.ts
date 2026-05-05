import { handleYookassaWebhook } from '@/lib/payments/handle-yookassa-webhook';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handleYookassaWebhook(req);
}
