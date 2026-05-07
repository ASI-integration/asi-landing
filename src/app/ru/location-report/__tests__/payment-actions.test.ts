import { describe, expect, it } from 'vitest';
import { getLocationReportPaymentAction } from '../payment-actions';

describe('location report payment actions', () => {
  it('does not expose public manual auto-unlock for pending manual payments', () => {
    const action = getLocationReportPaymentAction({
      access_status: 'pending_payment',
      payment_provider: 'manual',
      payment_url: null,
    });

    expect(action.kind).toBe('manual_contact');
    if (action.kind !== 'manual_contact') throw new Error('expected manual contact action');
    expect(action.label).toBe('Связаться для оплаты');
    expect(action).not.toMatchObject({ label: 'Я оплатил' });
  });

  it('keeps YooKassa payment_url as the public card/SBP path', () => {
    const action = getLocationReportPaymentAction({
      access_status: 'pending_payment',
      payment_provider: 'yookassa',
      payment_url: 'https://yoomoney.ru/checkout/payments/v2/contract?orderId=yk_pay_123',
    });

    expect(action).toEqual({
      kind: 'yookassa',
      label: 'Оплатить картой / СБП',
      url: 'https://yoomoney.ru/checkout/payments/v2/contract?orderId=yk_pay_123',
    });
  });
});
