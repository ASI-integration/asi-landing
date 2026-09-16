import { beforeEach, describe, expect, it } from 'vitest';
import { POST } from '../create-payment/route';

describe('disabled YooKassa checkout routes', () => {
  beforeEach(() => {
    delete process.env.YOOKASSA_ENABLED;
    delete process.env.YOOKASSA_MODE;
    delete process.env.YOOKASSA_SHOP_ID;
    delete process.env.YOOKASSA_SECRET_KEY;
  });

  it('does not create a real YooKassa payment while provider is disabled', async () => {
    const res = await POST(new Request('https://example.test/api/yookassa/create-payment', { method: 'POST' }));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe('disabled');
    expect(body.service).toBe('Ранний доступ: AI-коммуникации для посуточной аренды');
    expect(body.amountRub).toBe(1000);
    expect(body.message).toContain('AI-коммуникации для посуточной аренды');
  });
});
