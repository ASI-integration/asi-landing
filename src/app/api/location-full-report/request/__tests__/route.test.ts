import { afterEach, describe, expect, it, vi } from 'vitest';

const mockCreateLocationReportRequest = vi.fn();
const mockGetSession = vi.fn();
const mockIsSessionSecretConfigured = vi.fn();

vi.mock('@/lib/location/report-request-store', () => ({
  createLocationReportRequest: (...args: unknown[]) => mockCreateLocationReportRequest(...args),
}));

vi.mock('@/lib/auth', () => ({
  getSession: () => mockGetSession(),
  isSessionSecretConfigured: () => mockIsSessionSecretConfigured(),
}));

function req(body: unknown) {
  return new Request('http://localhost/api/location-full-report/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('POST /api/location-full-report/request', () => {
  it('requires auth for paid report requests', async () => {
    mockIsSessionSecretConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue({});
    const { POST } = await import('../route');

    const res = await POST(req({
      address: 'Санкт-Петербург, Невский проспект, 88',
      locale: 'ru',
      mode: 'residential',
      access_tier: 'paid_required',
    }) as any);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('auth_required');
    expect(json.loginUrl).toContain('/connect?redirect=');
    expect(mockCreateLocationReportRequest).not.toHaveBeenCalled();
  });

  it('creates a pending paid request for authenticated users', async () => {
    mockIsSessionSecretConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue({ userId: 'user-1' });
    mockCreateLocationReportRequest.mockResolvedValue({ requestId: 'request-1' });
    const { POST } = await import('../route');

    const res = await POST(req({
      address: 'Санкт-Петербург, Невский проспект, 88',
      locale: 'ru',
      mode: 'residential',
      delivery: { channel: 'dashboard', target: 'dashboard' },
      access_tier: 'paid_required',
    }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ requestId: 'request-1', status: 'queued' });
    expect(mockCreateLocationReportRequest).toHaveBeenCalledWith(expect.objectContaining({
      locale: 'ru',
      mode: 'residential',
      accessTier: 'paid_required',
    }));
  });
});
