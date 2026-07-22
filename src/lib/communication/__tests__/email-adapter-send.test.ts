import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EmailAdapter,
  __setEmailSmtpSendForTests,
  readEmailAdapterDeliveryStatus,
} from '../channels/email';

describe('EmailAdapter.sendMessage delivery semantics', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    __setEmailSmtpSendForTests(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    __setEmailSmtpSendForTests(null);
  });

  it('stamps suppressed_draft_only and returns false (not SMTP-delivered)', async () => {
    const adapter = new EmailAdapter();
    const metadata: Record<string, unknown> = { subject: 'Re: Wi-Fi' };
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const sent = await adapter.sendMessage('guest@example.com', 'Draft reply body', metadata);

    expect(sent).toBe(false);
    expect(readEmailAdapterDeliveryStatus(metadata)).toBe('suppressed_draft_only');
    expect(infoSpy).toHaveBeenCalledWith(
      '[EmailAdapter] outbound suppressed (draft_only)',
      expect.objectContaining({ emailAdapterDeliveryStatus: 'suppressed_draft_only' }),
    );
    infoSpy.mockRestore();
  });

  it('stamps send_failed when auto-send is on but SMTP is not configured', async () => {
    vi.stubEnv('EMAIL_AUTO_SEND', 'true');
    vi.stubEnv('EMAIL_DRAFT_ONLY', 'false');
    delete process.env.EMAIL_SMTP_HOST;
    delete process.env.EMAIL_FROM_ADDRESS;
    delete process.env.NEXT_PUBLIC_CONTACT_EMAIL;

    const adapter = new EmailAdapter();
    const metadata: Record<string, unknown> = { subject: 'Re: check-in' };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const sent = await adapter.sendMessage('guest@example.com', 'Would send', metadata);

    expect(sent).toBe(false);
    expect(readEmailAdapterDeliveryStatus(metadata)).toBe('send_failed');
    errSpy.mockRestore();
  });

  it('stamps delivered and returns true only after SMTP send succeeds', async () => {
    vi.stubEnv('EMAIL_AUTO_SEND', 'true');
    vi.stubEnv('EMAIL_DRAFT_ONLY', 'false');
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.test.local');
    vi.stubEnv('EMAIL_FROM_ADDRESS', 'support@asi-global.ru');

    const smtpSend = vi.fn().mockResolvedValue(undefined);
    __setEmailSmtpSendForTests(smtpSend);

    const adapter = new EmailAdapter();
    const metadata: Record<string, unknown> = { subject: 'Re: towels' };

    const sent = await adapter.sendMessage('guest@example.com', 'Live reply', metadata);

    expect(sent).toBe(true);
    expect(readEmailAdapterDeliveryStatus(metadata)).toBe('delivered');
    expect(smtpSend).toHaveBeenCalledTimes(1);
  });

  it('stamps send_failed when SMTP send throws', async () => {
    vi.stubEnv('EMAIL_AUTO_SEND', 'true');
    vi.stubEnv('EMAIL_DRAFT_ONLY', 'false');
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.test.local');
    vi.stubEnv('EMAIL_FROM_ADDRESS', 'support@asi-global.ru');

    __setEmailSmtpSendForTests(async () => {
      throw new Error('smtp_rejected');
    });

    const adapter = new EmailAdapter();
    const metadata: Record<string, unknown> = { subject: 'Re: towels' };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const sent = await adapter.sendMessage('guest@example.com', 'Live reply', metadata);

    expect(sent).toBe(false);
    expect(readEmailAdapterDeliveryStatus(metadata)).toBe('send_failed');
    errSpy.mockRestore();
  });
});
