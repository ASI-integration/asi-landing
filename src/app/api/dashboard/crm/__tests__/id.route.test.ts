import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  isSessionSecretConfigured: vi.fn(() => true),
  getSession: vi.fn(async () => ({ userId: 'user-1', email: 'owner@example.com' })),
}));

const deleteCrmContact = vi.fn();
const updateCrmContact = vi.fn();

vi.mock('@/lib/crm/repository', () => ({
  deleteCrmContact,
  updateCrmContact,
}));

beforeEach(() => {
  vi.resetModules();
  deleteCrmContact.mockReset();
  updateCrmContact.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('/api/dashboard/crm/[id]', () => {
  it('deletes a contact when session is valid', async () => {
    deleteCrmContact.mockResolvedValueOnce(undefined);
    const mod = await import('../[id]/route');
    const res = await mod.DELETE(new Request('http://localhost/api/dashboard/crm/lead-1'), { params: { id: 'lead-1' } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteCrmContact).toHaveBeenCalledWith('lead-1');
  });

  it('rejects delete without id', async () => {
    const mod = await import('../[id]/route');
    const res = await mod.DELETE(new Request('http://localhost/api/dashboard/crm/'), { params: { id: '' } });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, message: 'Заявка не найдена.' });
    expect(deleteCrmContact).not.toHaveBeenCalled();
  });

  it('returns error when delete fails', async () => {
    deleteCrmContact.mockRejectedValueOnce(new Error('db error'));
    const mod = await import('../[id]/route');
    const res = await mod.DELETE(new Request('http://localhost/api/dashboard/crm/lead-1'), { params: { id: 'lead-1' } });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, message: 'Не удалось удалить заявку.' });
  });
});
