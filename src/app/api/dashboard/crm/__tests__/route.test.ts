import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  isSessionSecretConfigured: vi.fn(() => true),
  getSession: vi.fn(async () => ({ userId: 'user-1', email: 'owner@example.com' })),
}));

const listCrmContacts = vi.fn();
const createCrmContact = vi.fn();

vi.mock('@/lib/crm/repository', () => ({
  listCrmContacts,
  createCrmContact,
}));

beforeEach(() => {
  vi.resetModules();
  listCrmContacts.mockReset();
  createCrmContact.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('/api/dashboard/crm', () => {
  it('lists contacts with filters', async () => {
    listCrmContacts.mockResolvedValueOnce([]);
    const mod = await import('../route');
    const res = await mod.GET(new Request('http://localhost/api/dashboard/crm?status=pilot&source=telegram&search=anna'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, contacts: [] });
    expect(listCrmContacts).toHaveBeenCalledWith({
      status: 'pilot',
      source: 'telegram',
      search: 'anna',
      excludeArchived: true,
      includeTest: false,
    });
  });

  it('rejects contacts without contact channel', async () => {
    const mod = await import('../route');
    const res = await mod.POST(
      new Request('http://localhost/api/dashboard/crm', {
        method: 'POST',
        body: JSON.stringify({ name: 'Анна' }),
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, message: 'Укажите хотя бы один способ связи.' });
    expect(createCrmContact).not.toHaveBeenCalled();
  });

  it('rejects invalid values instead of reporting a successful write', async () => {
    const mod = await import('../route');
    const res = await mod.POST(
      new Request('http://localhost/api/dashboard/crm', {
        method: 'POST',
        body: JSON.stringify({ name: 'Анна', email: 'не-email', status: 'broken' }),
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, message: 'Проверьте данные заявки.' });
    expect(createCrmContact).not.toHaveBeenCalled();
  });
});
