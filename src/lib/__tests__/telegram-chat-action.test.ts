import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Telegram chat actions', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'token-test');
    vi.stubEnv('TELEGRAM_OUTBOUND_DRY_RUN', '0');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('sends typing chat action and throttles repeats for the same chat', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { sendTelegramChatAction } = await import('../telegram');

    vi.setSystemTime(1_000);
    await expect(sendTelegramChatAction(123, 'typing', { handler: 'test', throttleMs: 4_000 })).resolves.toBe(true);
    vi.setSystemTime(2_000);
    await expect(sendTelegramChatAction(123, 'typing', { handler: 'test', throttleMs: 4_000 })).resolves.toBe(true);
    vi.setSystemTime(6_000);
    await expect(sendTelegramChatAction(123, 'typing', { handler: 'test', throttleMs: 4_000 })).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstInit = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(firstInit?.body))).toMatchObject({
      chat_id: 123,
      action: 'typing',
    });
  });
});
