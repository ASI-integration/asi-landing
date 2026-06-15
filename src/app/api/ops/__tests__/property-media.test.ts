import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequire = vi.fn();
const mockListMedia = vi.fn();
const mockAddMedia = vi.fn();
const mockGetBucket = vi.fn();
const mockCreateBucket = vi.fn();
const mockStorageFrom = vi.fn();
const mockUpload = vi.fn();
const mockGetPublicUrl = vi.fn();

vi.mock('@/lib/ops-foundation/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ops-foundation/api')>();
  return {
    ...actual,
    requireOpsFoundationContext: () => mockRequire(),
  };
});

vi.mock('@/lib/ops-foundation/repository', () => ({
  listPropertyMedia: (...args: unknown[]) => mockListMedia(...args),
  addPropertyMedia: (...args: unknown[]) => mockAddMedia(...args),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      getBucket: (...args: unknown[]) => mockGetBucket(...args),
      createBucket: (...args: unknown[]) => mockCreateBucket(...args),
      from: (...args: unknown[]) => mockStorageFrom(...args),
    },
  },
}));

import { POST } from '@/app/api/ops/properties/[id]/media/route';

const ctx = { accountId: 'acc-1', userId: 'user-1' };
const params = { params: { id: 'prop-1' } };

beforeEach(() => {
  mockRequire.mockReset();
  mockListMedia.mockReset();
  mockAddMedia.mockReset();
  mockGetBucket.mockReset();
  mockCreateBucket.mockReset();
  mockStorageFrom.mockReset();
  mockUpload.mockReset();
  mockGetPublicUrl.mockReset();

  mockRequire.mockReturnValue({ ok: true, ctx });
  mockAddMedia.mockResolvedValue({
    id: 'media-1',
    propertyId: 'prop-1',
    url: 'https://cdn.test/photo.jpg',
    storagePath: null,
    title: null,
    description: null,
    sortOrder: 0,
    isCover: true,
    status: 'active',
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z',
  });
  mockGetBucket.mockResolvedValue({ data: { id: 'property-media' }, error: null });
  mockCreateBucket.mockResolvedValue({ data: null, error: null });
  mockUpload.mockResolvedValue({ data: { path: 'properties/prop-1/photo.jpg' }, error: null });
  mockGetPublicUrl.mockReturnValue({ data: { publicUrl: 'https://cdn.test/photo.jpg' } });
  mockStorageFrom.mockReturnValue({ upload: mockUpload, getPublicUrl: mockGetPublicUrl });
});

describe('POST /api/ops/properties/[id]/media', () => {
  it('keeps JSON URL media creation supported', async () => {
    const res = await POST(
      new Request('http://localhost/api/ops/properties/prop-1/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.test/photo.jpg', title: 'Living room', isCover: true }),
      }),
      params,
    );

    expect(res.status).toBe(201);
    expect(mockAddMedia).toHaveBeenCalledWith(ctx, 'prop-1', {
      url: 'https://example.test/photo.jpg',
      storagePath: undefined,
      title: 'Living room',
      description: undefined,
      sortOrder: undefined,
      isCover: true,
      status: undefined,
    });
  });

  it('uploads image files to storage before creating media', async () => {
    const form = new FormData();
    form.append('file', new File(['image-bytes'], 'room.jpg', { type: 'image/jpeg' }));
    form.append('title', 'Room');

    const res = await POST(
      new Request('http://localhost/api/ops/properties/prop-1/media', {
        method: 'POST',
        body: form,
      }),
      params,
    );

    expect(res.status).toBe(201);
    expect(mockGetBucket).toHaveBeenCalledWith('property-media');
    expect(mockUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^properties\/prop-1\/\d+-[a-f0-9-]+\.jpg$/),
      expect.any(ArrayBuffer),
      { contentType: 'image/jpeg', upsert: false },
    );
    expect(mockAddMedia).toHaveBeenCalledWith(
      ctx,
      'prop-1',
      expect.objectContaining({
        url: 'https://cdn.test/photo.jpg',
        storagePath: expect.stringMatching(/^property-media\/properties\/prop-1\/\d+-[a-f0-9-]+\.jpg$/),
        title: 'Room',
      }),
    );
  });

  it('rejects non-image multipart uploads', async () => {
    const form = new FormData();
    form.append('file', new File(['not-image'], 'notes.txt', { type: 'text/plain' }));

    const res = await POST(
      new Request('http://localhost/api/ops/properties/prop-1/media', {
        method: 'POST',
        body: form,
      }),
      params,
    );

    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe('image_file_required');
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockAddMedia).not.toHaveBeenCalled();
  });
});
