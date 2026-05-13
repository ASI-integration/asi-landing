import { beforeEach, describe, expect, it, vi } from 'vitest';

function overpassResponse(elements: unknown[], status = 200): Response {
  return new Response(JSON.stringify({ elements }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function decodeOverpassBody(init: RequestInit | undefined): string {
  const body = String(init?.body ?? '');
  const encoded = body.startsWith('data=') ? body.slice(5) : body;
  return decodeURIComponent(encoded);
}

describe('fetchOsmData fast demo fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('tries the light fallback when the full query fails', async () => {
    const lightElement = {
      type: 'node',
      id: 42,
      lat: 56.3004,
      lon: 44.078,
      tags: { amenity: 'hospital', name: 'Test hospital' },
    };

    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const query = decodeOverpassBody(init);
      if (query.includes('"office"') || query.includes('"amenity"="restaurant"')) {
        return overpassResponse([lightElement]);
      }
      return overpassResponse([], 504);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchOsmData } = await import('../overpass');
    const result = await fetchOsmData(56.3004, 44.078, {
      fastDemo: true,
      requestTimeoutMs: 100,
      fastDemoPrimaryTimeoutMs: 500,
      fastDemoFallbackTimeoutMs: 500,
      disableRateLimit: true,
    });

    expect(result.usedFallbackQuery).toBe(true);
    expect(result.elements).toHaveLength(1);
    expect(result.overpassDiagnostics?.overpassFallbackAttempted).toBe(true);
    expect(result.overpassDiagnostics?.overpassFallbackSucceeded).toBe(true);
    expect(result.overpassDiagnostics?.overpassQueryMode).toBe('light_fallback');
    expect(result.overpassDiagnostics?.overpassAttempts.some(a => a.queryMode === 'full' && !a.ok)).toBe(true);
    expect(result.overpassDiagnostics?.overpassAttempts.some(a => a.queryMode === 'light_fallback' && a.ok)).toBe(true);
  });

  it('returns no elements with diagnostics when full and fallback both fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => overpassResponse([], 504)));

    const { fetchOsmData } = await import('../overpass');
    const result = await fetchOsmData(56.3004, 44.078, {
      fastDemo: true,
      requestTimeoutMs: 100,
      fastDemoPrimaryTimeoutMs: 500,
      fastDemoFallbackTimeoutMs: 500,
      disableRateLimit: true,
    });

    expect(result.elements).toHaveLength(0);
    expect(result.usedFallbackQuery).toBe(true);
    expect(result.hadProviderFailure).toBe(true);
    expect(result.overpassDiagnostics?.overpassFallbackAttempted).toBe(true);
    expect(result.overpassDiagnostics?.overpassFallbackSucceeded).toBe(false);
    expect(result.overpassDiagnostics?.overpassFailureReason).toBeDefined();
  });
});
