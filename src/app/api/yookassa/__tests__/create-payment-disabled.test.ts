import { describe, expect, it } from 'vitest';

describe('disabled YooKassa checkout routes', () => {
  it('does not create a real YooKassa payment while provider is disabled', async () => {
    const { POST } = await import('../create-payment/route');

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe('disabled');
    expect(body.message).toContain('Оплата будет подключена после финальной проверки отчёта');
  });
});
