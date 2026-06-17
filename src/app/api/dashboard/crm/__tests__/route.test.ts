import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockApplyPilotCrmDecision = vi.fn();
const mockCreateCrmContact = vi.fn();
const mockListCrmContacts = vi.fn();
const mockListCrmPropertyOptions = vi.fn();
const mockUpdateCrmContact = vi.fn();

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn().mockResolvedValue({ userId: 'user-1', email: 'ops@asi.test' }),
  isSessionSecretConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/dashboard/internal-access', () => ({
  isDashboardInternalUser: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/crm/repository', () => ({
  applyPilotCrmDecision: (...args: unknown[]) => mockApplyPilotCrmDecision(...args),
  createCrmContact: (...args: unknown[]) => mockCreateCrmContact(...args),
  listCrmContacts: (...args: unknown[]) => mockListCrmContacts(...args),
  listCrmPropertyOptions: (...args: unknown[]) => mockListCrmPropertyOptions(...args),
  updateCrmContact: (...args: unknown[]) => mockUpdateCrmContact(...args),
}));

import { PATCH } from '../route';

describe('PATCH /api/dashboard/crm pilot selection', () => {
  beforeEach(() => {
    mockApplyPilotCrmDecision.mockReset();
    mockCreateCrmContact.mockReset();
    mockListCrmContacts.mockReset();
    mockListCrmPropertyOptions.mockReset();
    mockUpdateCrmContact.mockReset();
  });

  it('selects a pilot candidate through the dedicated decision action', async () => {
    mockApplyPilotCrmDecision.mockResolvedValue({
      id: 'crm-1',
      status: 'pilot_selected',
      nextAction: 'Предложить создать объект',
      recentEvents: [{ eventType: 'pilot_selected' }],
    });

    const res = await PATCH(new NextRequest('http://localhost/api/dashboard/crm', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'crm-1', pilotDecision: 'select' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.contact.status).toBe('pilot_selected');
    expect(json.contact.nextAction).toBe('Предложить создать объект');
    expect(mockApplyPilotCrmDecision).toHaveBeenCalledWith('crm-1', 'select');
    expect(mockUpdateCrmContact).not.toHaveBeenCalled();
  });
});
