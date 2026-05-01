import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  processUpdate: vi.fn(),
  replyToTelegram: vi.fn().mockResolvedValue(true),
  postTelegramUpdateToBackendPipeline: vi.fn(),
}));

vi.mock('@/lib/communication/orchestrator', () => ({
  processUpdate: mocks.processUpdate,
}));

vi.mock('@/lib/telegram', () => ({
  replyToTelegram: mocks.replyToTelegram,
}));

vi.mock('@/lib/telegram/backend-pipeline-bridge', () => ({
  postTelegramUpdateToBackendPipeline: mocks.postTelegramUpdateToBackendPipeline,
}));

const ORIGINAL_ENV = { ...process.env };

async function postRoute(body: object) {
  vi.resetModules();
  const mod = await import('../route');
  const req = new Request('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return mod.POST(req);
}

describe('POST /api/telegram/webhook — backend pipeline bridge', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.clearAllMocks();
    mocks.processUpdate.mockResolvedValue({ outcome: 'processed', update_id: 1 });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('uses the backend when TELEGRAM_BACKEND_PIPELINE_URL is set and skips the local orchestrator on a valid decision', async () => {
    process.env.TELEGRAM_BACKEND_PIPELINE_URL = 'https://api.example/api/communication/telegram/inbound';
    mocks.postTelegramUpdateToBackendPipeline.mockResolvedValue({
      ok: true,
      decision: {
        ok: true,
        action_type: 'send_reply',
        outbound_payload: { text: 'policy-first from backend' },
        outbound_send_allowed: true,
        owner_notification_allowed: false,
      },
    });

    const update = {
      update_id: 99,
      message: {
        message_id: 1,
        date: 1,
        text: 'Позовите оператора',
        chat: { id: 12345 },
        from: { id: 1 },
      },
    };

    const res = await postRoute(update);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; path?: string };
    expect(body).toMatchObject({ ok: true, path: 'backend_pipeline' });

    expect(mocks.postTelegramUpdateToBackendPipeline).toHaveBeenCalledOnce();
    expect(mocks.processUpdate).not.toHaveBeenCalled();
    expect(mocks.replyToTelegram).toHaveBeenCalledWith(
      12345,
      'policy-first from backend',
      expect.objectContaining({ handler: 'backend_pipeline' }),
    );
  });

  it('falls back to the local orchestrator only when the backend call does not yield a valid decision', async () => {
    process.env.TELEGRAM_BACKEND_PIPELINE_URL = 'https://api.example/api/communication/telegram/inbound';
    mocks.postTelegramUpdateToBackendPipeline.mockResolvedValue({ ok: false, error: 'http_500' });

    const update = {
      update_id: 100,
      message: {
        message_id: 1,
        date: 1,
        text: 'x',
        chat: { id: 1 },
        from: { id: 1 },
      },
    };

    await postRoute(update);
    expect(mocks.processUpdate).toHaveBeenCalled();
  });

  it('does not invoke the backend bridge when TELEGRAM_BACKEND_PIPELINE_URL is unset', async () => {
    delete process.env.TELEGRAM_BACKEND_PIPELINE_URL;

    const update = {
      update_id: 101,
      message: {
        message_id: 1,
        date: 1,
        text: 'x',
        chat: { id: 1 },
        from: { id: 1 },
      },
    };

    await postRoute(update);
    expect(mocks.postTelegramUpdateToBackendPipeline).not.toHaveBeenCalled();
    expect(mocks.processUpdate).toHaveBeenCalled();
  });

  it('does not run the legacy orchestrator when the backend succeeds without TS duplicate-handoff copy paths', async () => {
    process.env.TELEGRAM_BACKEND_PIPELINE_URL = 'https://api.example/api/communication/telegram/inbound';
    mocks.postTelegramUpdateToBackendPipeline.mockResolvedValue({
      ok: true,
      decision: {
        ok: true,
        action_type: 'send_reply',
        outbound_payload: { text: 'Здравствуйте, уточните детали.' },
        outbound_send_allowed: true,
        owner_notification_allowed: false,
      },
    });

    const update = {
      update_id: 102,
      message: {
        message_id: 2,
        date: 1,
        text: 'Повторный вопрос',
        chat: { id: 77 },
        from: { id: 2 },
      },
    };

    await postRoute(update);
    expect(mocks.processUpdate).not.toHaveBeenCalled();
    expect(mocks.replyToTelegram).toHaveBeenCalledWith(77, 'Здравствуйте, уточните детали.', expect.any(Object));
  });
});
