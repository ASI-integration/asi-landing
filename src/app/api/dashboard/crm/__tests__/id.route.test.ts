import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  isSessionSecretConfigured: vi.fn(() => true),
  getSession: vi.fn(async () => ({ userId: 'user-1', email: 'owner@example.com' })),
}));

const deleteCrmContact = vi.fn();
const updateCrmContact = vi.fn();
const listCrmContacts = vi.fn();
class CrmContactNotFoundError extends Error {}

vi.mock('@/lib/crm/repository', () => ({
  CrmContactNotFoundError,
  deleteCrmContact,
  listCrmContacts,
  updateCrmContact,
}));

const runPilotChainForContact = vi.fn();
vi.mock('@/lib/pilot-chain/orchestrator', () => ({
  runPilotChainForContact,
}));

vi.mock('@/lib/pilot-chain/next-actions', () => ({
  resolvePilotChainNextActions: vi.fn(() => []),
}));

beforeEach(() => {
  vi.resetModules();
  deleteCrmContact.mockReset();
  updateCrmContact.mockReset();
  listCrmContacts.mockReset();
  runPilotChainForContact.mockReset();
  runPilotChainForContact.mockResolvedValue({
    contactId: 'lead-1',
    objectId: null,
    steps: [],
    contact: null,
    opsTaskId: null,
  });
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

  it('updates setup status actions', async () => {
    const contact = {
      id: 'lead-1',
      status: 'access_requested',
      crmArchived: false,
    };
    listCrmContacts.mockResolvedValueOnce([]);
    updateCrmContact.mockResolvedValueOnce(contact);

    const mod = await import('../[id]/route');
    const res = await mod.PATCH(
      new Request('http://localhost/api/dashboard/crm/lead-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'access_requested' }),
      }),
      { params: { id: 'lead-1' } },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, contact });
    expect(updateCrmContact).toHaveBeenCalledWith('lead-1', { status: 'access_requested' });
  });

  it('rejects empty updates before touching the database', async () => {
    const mod = await import('../[id]/route');
    const res = await mod.PATCH(
      new Request('http://localhost/api/dashboard/crm/lead-1', {
        method: 'PATCH',
        body: JSON.stringify({}),
      }),
      { params: { id: 'lead-1' } },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, message: 'Нет изменений для сохранения.' });
    expect(updateCrmContact).not.toHaveBeenCalled();
  });

  it('reports an automation warning without hiding a successful database update', async () => {
    const contact = { id: 'lead-1', status: 'contact_sent', crmArchived: false };
    listCrmContacts.mockResolvedValueOnce([]);
    updateCrmContact.mockResolvedValueOnce(contact);
    runPilotChainForContact.mockRejectedValueOnce(new Error('automation unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const mod = await import('../[id]/route');
    const res = await mod.PATCH(
      new Request('http://localhost/api/dashboard/crm/lead-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'contact_sent' }),
      }),
      { params: { id: 'lead-1' } },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      contact,
      warning: 'Изменения сохранены, но следующий автоматический шаг не выполнен. Проверьте заявку вручную.',
    });
    consoleError.mockRestore();
  });
});
