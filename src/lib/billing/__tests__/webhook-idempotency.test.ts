import { describe, it, expect, beforeEach } from 'vitest';
import { claimWebhookEvent, releaseWebhookEvent, _resetEventLogs } from '@/lib/payments/events';

const PROVIDER = 'stripe_onboarding';

describe('scenario H: duplicate Stripe webhook delivery', () => {
  beforeEach(() => {
    _resetEventLogs();
  });

  it('the same event id can only be claimed once', async () => {
    const first = await claimWebhookEvent(PROVIDER, 'evt_123');
    expect(first).toBe(true);

    const second = await claimWebhookEvent(PROVIDER, 'evt_123');
    expect(second).toBe(false);
  });

  it('releasing a claim (on processing error) allows a legitimate retry', async () => {
    const first = await claimWebhookEvent(PROVIDER, 'evt_456');
    expect(first).toBe(true);

    await releaseWebhookEvent(PROVIDER, 'evt_456');

    const retry = await claimWebhookEvent(PROVIDER, 'evt_456');
    expect(retry).toBe(true);
  });

  it('different event ids are independent', async () => {
    expect(await claimWebhookEvent(PROVIDER, 'evt_a')).toBe(true);
    expect(await claimWebhookEvent(PROVIDER, 'evt_b')).toBe(true);
    expect(await claimWebhookEvent(PROVIDER, 'evt_a')).toBe(false);
  });

  it('is scoped by provider — the same event id under a different provider is independent', async () => {
    expect(await claimWebhookEvent('stripe_onboarding', 'evt_shared')).toBe(true);
    expect(await claimWebhookEvent('stripe', 'evt_shared')).toBe(true);
  });
});
