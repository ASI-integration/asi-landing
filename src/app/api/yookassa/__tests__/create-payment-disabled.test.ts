import { describe, expect, it } from 'vitest';

describe('disabled YooKassa checkout routes', () => {
  it('does not create a real YooKassa payment while provider is disabled', async () => {
    const { POST } = await import('../create-payment/route');

    const res = await POST(new Request('https://example.test/api/yookassa/create-payment', { method: 'POST' }));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe('disabled');
    expect(body.service).toBe('Ранний доступ: AI-коммуникации для посуточной аренды');
    expect(body.amountRub).toBe(1000);
    expect(body.message).toContain('AI-коммуникации для посуточной аренды');
  });
});
