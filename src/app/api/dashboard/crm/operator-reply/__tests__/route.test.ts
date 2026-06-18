import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetCrmContactById = vi.fn();
const mockSendOperatorReplyToTelegram = vi.fn();

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn().mockResolvedValue({ userId: 'user-1', email: 'ops@asi.test' }),
  isSessionSecretConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/dashboard/internal-access', () => ({
  isDashboardInternalUser: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/crm/repository', () => ({
  getCrmContactById: (...args: unknown[]) => mockGetCrmContactById(...args),
}));

vi.mock('@/lib/crm/operator-followup', () => ({
  sendOperatorReplyToTelegram: (...args: unknown[]) => mockSendOperatorReplyToTelegram(...args),
}));

import { POST } from '../route';

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/dashboard/crm/operator-reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/dashboard/crm/operator-reply', () => {
  beforeEach(() => {
    mockGetCrmContactById.mockReset();
    mockSendOperatorReplyToTelegram.mockReset();
  });

  it('does not send empty operator reply', async () => {
    const res = await POST(request({
      crmContactId: 'contact-1',
      telegramChatId: '8101',
      relatedEscalationId: 'esc-1',
      replyText: '   ',
    }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Введите ответ оператора');
    expect(mockSendOperatorReplyToTelegram).not.toHaveBeenCalled();
  });

  it('passes CRM reply payload to Telegram sender', async () => {
    mockSendOperatorReplyToTelegram.mockResolvedValue({ ok: true });
    mockGetCrmContactById.mockResolvedValue({ id: 'contact-1' });

    const res = await POST(request({
      crmContactId: 'contact-1',
      telegramChatId: '8101',
      relatedEscalationId: 'esc-1',
      replyText: 'Добрый день! Можно выехать до 13:00.',
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(mockSendOperatorReplyToTelegram).toHaveBeenCalledWith(expect.objectContaining({
      contactId: 'contact-1',
      telegramChatId: '8101',
      relatedEscalationId: 'esc-1',
      replyText: 'Добрый день! Можно выехать до 13:00.',
      operatorId: 'ops@asi.test',
    }));
  });
});
