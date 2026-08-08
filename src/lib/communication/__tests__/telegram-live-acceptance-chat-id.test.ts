import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
// @ts-ignore The production acceptance boundary is intentionally a Node ESM script.
import {
  normalizeTelegramTestChatId,
  resolveTelegramTestChatId,
  TestChatConfigurationError,
} from '../../../../scripts/telegram-test-chat-id.mjs';
// @ts-ignore The production acceptance boundary is intentionally a Node ESM script.
import { findLinkedReservation } from '../../../../scripts/telegram-autopilot-reservation.mjs';

function reservationLookup(row: Record<string, unknown>) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockResolvedValue({ data: [row], error: null });
  return { sb: { from: vi.fn(() => query) }, query };
}

describe('Telegram acceptance test chat id boundary', () => {
  it.each([
    ['931919812', '931919812'],
    ['-1001234567890', '-1001234567890'],
    ['telegram_test_chat_id: 931919812', '931919812'],
  ])('normalizes %j to %s', (input, expected) => {
    expect(normalizeTelegramTestChatId(input)).toBe(expected);
  });

  it.each(['', 'garbage', '931919812 trailing text', 'NaN'])(
    'rejects invalid input %j with a sanitized configuration error',
    (input) => {
      expect(() => normalizeTelegramTestChatId(input)).toThrowError(TestChatConfigurationError);
      try {
        normalizeTelegramTestChatId(input);
      } catch (error) {
        const configurationError = error as { stage: string; message: string };
        expect(configurationError.stage).toBe('test_chat_configuration');
        expect(configurationError.message).not.toContain(input || '""');
      }
    },
  );

  it('rejects conflicting test chat environment variables', () => {
    expect(() => resolveTelegramTestChatId({
      TELEGRAM_AUTOPILOT_TEST_CHAT_ID: '931919812',
      TELEGRAM_TEST_CHAT_ID: '-1001234567890',
    })).toThrowError(/must resolve to the same integer/);
  });

  it('passes a canonical string, never NaN, to the reservation bigint filter', async () => {
    const { sb, query } = reservationLookup({ id: 'reservation-1', chat_id: '931919812' });

    await expect(findLinkedReservation(sb, 'telegram_test_chat_id: 931919812')).resolves.toMatchObject({
      id: 'reservation-1',
      chat_id: '931919812',
    });

    expect(query.eq).toHaveBeenCalledWith('chat_id', '931919812');
    for (const [, value] of query.eq.mock.calls) expect(Number.isNaN(value)).toBe(false);
  });

  it('fails before any Supabase reservation lookup when input is garbage', async () => {
    const sb = { from: vi.fn() };

    await expect(findLinkedReservation(sb, 'not-a-chat-id')).rejects.toMatchObject({
      stage: 'test_chat_configuration',
      code: 'invalid_test_chat_id',
    });
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('validates the workflow input before SSH and copies the shared parser to the remote runner', () => {
    const workflow = fs.readFileSync(
      path.join(process.cwd(), '.github/workflows/communication-production-completion-v1.yml'),
      'utf8',
    );
    const validation = workflow.indexOf('node scripts/telegram-test-chat-id.mjs');
    const ssh = workflow.indexOf('ssh "${SSH_OPTS[@]}"');

    expect(validation).toBeGreaterThan(-1);
    expect(ssh).toBeGreaterThan(validation);
    expect(workflow).toContain('scripts/telegram-autopilot-reservation.mjs \\');
    expect(workflow).toContain('scripts/telegram-test-chat-id.mjs \\');
    expect(workflow).toContain('stage=test_chat_configuration');
  });
});
