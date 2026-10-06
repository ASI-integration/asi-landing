import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRunTelegramDryRun = vi.fn();

vi.mock('@/lib/communication/telegram-dry-run', () => ({
  runTelegramDryRun: (...args: unknown[]) => mockRunTelegramDryRun(...args),
}));

import { POST } from '../route';

describe('POST /api/internal/telegram-dry-run', () => {
  beforeEach(() => {
    process.env.INTERNAL_TEST_SECRET = 'secret';
    mockRunTelegramDryRun.mockReset();
    mockRunTelegramDryRun.mockResolvedValue({
      detectedIntents: ['check_in_standard'],
      replyText: 'ok',
      actions: ['reply'],
      escalated: false,
      slowAckSent: false,
      finalReplied: true,
    });
  });

  it('rejects when secret header is missing', async () => {
    const req = new Request('https://example.test/api/internal/telegram-dry-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello', chatId: 'c1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('accepts valid request with secret header', async () => {
    const req = new Request('https://example.test/api/internal/telegram-dry-run', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-test-secret': 'secret',
      },
      body: JSON.stringify({
        text: 'hello',
        chatId: 'test-chat',
        objectName: 'Тверской',
        bookingId: 'test-booking',
      }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockRunTelegramDryRun).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({
      detectedIntents: ['check_in_standard'],
      actions: ['reply'],
      replyText: 'ok',
    });
  });

  it('returns a sanitized structured 500 when the dry-run throws', async () => {
    mockRunTelegramDryRun.mockRejectedValueOnce(
      new Error('db failed postgresql://user:password@example.test/db token=abc123'),
    );
    const req = new Request('https://example.test/api/internal/telegram-dry-run', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-test-secret': 'secret',
      },
      body: JSON.stringify({ text: 'hello', chatId: 'test-chat' }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toMatchObject({
      ok: false,
      error: 'telegram_dry_run_failed',
    });
    expect(body.detail).toContain('postgresql://[REDACTED]');
    expect(body.detail).toContain('token=[REDACTED]');
    expect(body.detail).not.toContain('password');
    expect(body.detail).not.toContain('abc123');
  });
});
