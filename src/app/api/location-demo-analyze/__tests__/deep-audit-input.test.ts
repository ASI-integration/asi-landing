import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const boundary = vi.hoisted(() => ({ cache: vi.fn(), provider: vi.fn() }));
vi.mock('@/lib/location/cache', () => ({ cacheGet: boundary.cache, cacheSet:vi.fn(), cacheEvictCoord:vi.fn() }));
vi.mock('@/lib/location', async () => ({ ...await vi.importActual('@/lib/location'), fetchOsmData:boundary.provider }));
import { POST } from '../route';
describe('HTTP invalid coordinate boundary', () => {
  it.each(['null','[]','42','broken JSON'])('rejects malformed body %s', async body => {
    const response=await POST(new NextRequest('http://fixture/api/location-demo-analyze',{method:'POST',body}));
    expect(response.status).toBe(400);
    expect(boundary.provider).not.toHaveBeenCalled();
  });
  it.each([[91,30],[-91,30],[59,181],[59,-181],[1e100,0]])('rejects %s/%s before cache and providers', async (lat,lon) => {
    const response = await POST(new NextRequest('http://fixture/api/location-demo-analyze', { method:'POST', body:JSON.stringify({lat,lon}) }));
    expect(response.status).toBe(400);
    expect(boundary.cache).not.toHaveBeenCalled();
    expect(boundary.provider).not.toHaveBeenCalled();
  });
});
