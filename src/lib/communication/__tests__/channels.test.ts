import { describe, it, expect, vi } from 'vitest';
import { getChannelAdapter } from '../channels';

vi.mock('../../telegram', () => ({
  replyToTelegram: vi.fn().mockResolvedValue(true),
}));

describe('Channel Adapters', () => {
  it('formats telegram responses tightly', () => {
    const adapter = getChannelAdapter('telegram');
    const result = adapter.formatResponse('  Hello! We have received your request.  ', {});
    expect(result).toBe('Hello! We have received your request.');
  });

  it('formats email responses with professional signatures', () => {
    const adapter = getChannelAdapter('email');
    const result = adapter.formatResponse('Hello! We have received your request.', {});
    const expectedFrom = process.env.EMAIL_FROM_ADDRESS ?? process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'support@asi-global.ru';
    expect(result).toContain('Best regards');
    expect(result).toContain(expectedFrom);
  });

  it('formats phone responses as operator summaries', () => {
    const adapter = getChannelAdapter('phone');
    const result = adapter.formatResponse('Guest needs towels.', {});
    expect(result).toContain('[Call Follow-up');
    expect(result).toContain('Guest needs towels.');
  });

  it('returns valid Max stub', () => {
    const adapter = getChannelAdapter('max');
    expect(adapter.channel).toBe('max');
  });
});
