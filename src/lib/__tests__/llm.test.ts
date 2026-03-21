import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// callLLM reads env at call time (inside buildConfig), so we can set env before each test.

const OPTIONS = { systemPrompt: 'You are a helpful assistant.', userMessage: 'Hello' };

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      json: async () => body,
    }),
  );
}

function mockFetchNetworkError(name = 'TypeError'): void {
  const err = new Error('Network failure');
  err.name = name;
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
}

function mockFetchAbort(): void {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
}

describe('callLLM — provider abstraction', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = env;
  });

  it('returns LLM text on primary provider success', async () => {
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_BASE_URL = 'https://api.openai.com/v1';
    mockFetch(200, { choices: [{ message: { content: '  Hello there!  ' } }] });

    const { callLLM } = await import('../openai');
    const result = await callLLM(OPTIONS);
    expect(result).toBe('Hello there!');
  });

  it('returns null and logs geo-restriction on 403 + unsupported_country_region_territory', async () => {
    process.env.LLM_API_KEY = 'test-key';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch(403, 'unsupported_country_region_territory');

    const { callLLM } = await import('../openai');
    const result = await callLLM(OPTIONS);

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('geo-restriction'),
    );
  });

  it('returns null and logs auth error on 401', async () => {
    process.env.LLM_API_KEY = 'bad-key';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch(401, 'Unauthorized');

    const { callLLM } = await import('../openai');
    const result = await callLLM(OPTIONS);

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Auth failed'));
  });

  it('returns null and logs rate limit on 429', async () => {
    process.env.LLM_API_KEY = 'test-key';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch(429, 'Too Many Requests');

    const { callLLM } = await import('../openai');
    const result = await callLLM(OPTIONS);

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Rate limited'));
  });

  it('returns null and logs server error on 500', async () => {
    process.env.LLM_API_KEY = 'test-key';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch(500, 'Internal Server Error');

    const { callLLM } = await import('../openai');
    const result = await callLLM(OPTIONS);

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('server error'));
  });

  it('returns null and logs timeout on AbortError', async () => {
    process.env.LLM_API_KEY = 'test-key';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetchAbort();

    const { callLLM } = await import('../openai');
    const result = await callLLM(OPTIONS);

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('timed out'));
  });

  it('returns null when API key is not set', async () => {
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { callLLM } = await import('../openai');
    const result = await callLLM(OPTIONS);

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('API key not configured'));
  });

  it('tries fallback provider when primary fails', async () => {
    process.env.LLM_API_KEY = 'primary-key';
    process.env.LLM_FALLBACK_BASE_URL = 'https://fallback.example.com/v1';
    process.env.LLM_FALLBACK_API_KEY = 'fallback-key';
    process.env.LLM_FALLBACK_MODEL = 'fallback-model';

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Primary fails with 403, fallback succeeds
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'unsupported_country_region_territory',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'fallback reply' } }] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { callLLM } = await import('../openai');
    const result = await callLLM(OPTIONS);

    expect(result).toBe('fallback reply');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('fallback'));
  });

  it('returns null when both primary and fallback fail', async () => {
    process.env.LLM_API_KEY = 'primary-key';
    process.env.LLM_FALLBACK_BASE_URL = 'https://fallback.example.com/v1';
    process.env.LLM_FALLBACK_API_KEY = 'fallback-key';

    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'error',
    });
    vi.stubGlobal('fetch', fetchMock);

    const { callLLM } = await import('../openai');
    const result = await callLLM(OPTIONS);

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
