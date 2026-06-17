import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.fn();
const mockRequire = vi.fn();
const mockLinkPilotCrmContactToProperty = vi.fn();

vi.mock('@/lib/ops-foundation/repository', () => ({
  listProperties: vi.fn(),
  createProperty: (...args: unknown[]) => mockCreate(...args),
}));

vi.mock('@/lib/ops-foundation/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ops-foundation/api')>();
  return {
    ...actual,
    requireOpsFoundationContext: () => mockRequire(),
  };
});

vi.mock('@/lib/crm/repository', () => ({
  linkPilotCrmContactToProperty: (...args: unknown[]) => mockLinkPilotCrmContactToProperty(...args),
}));

import { POST } from '@/app/api/ops/properties/route';

const ctx = { accountId: 'acc-1', userId: 'user-1' };

describe('POST /api/ops/properties pilot CRM link', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockRequire.mockReset();
    mockLinkPilotCrmContactToProperty.mockReset();
    mockRequire.mockReturnValue({ ok: true, ctx });
  });

  it('links created property to selected pilot CRM contact when provided', async () => {
    mockCreate.mockResolvedValue({ id: 'p2', title: 'Студия', accountId: 'acc-1' });
    mockLinkPilotCrmContactToProperty.mockResolvedValue({});

    const res = await POST(new Request('http://localhost/api/ops/properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Студия', crmContactId: 'crm-1' }),
    }));

    expect(res.status).toBe(201);
    expect(mockLinkPilotCrmContactToProperty).toHaveBeenCalledWith({
      contactId: 'crm-1',
      propertyId: 'p2',
    });
  });
});
