import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isGuestReplyLlmPolishEnabled,
  polishGuestReplyWithLlm,
  type GuestReplyLlmPolishProvider,
} from '../guest-reply-llm-polish';

vi.mock('@/lib/openai', () => ({
  callLLM: vi.fn(),
}));

import { callLLM } from '@/lib/openai';

const mockedCallLlm = vi.mocked(callLLM);

describe('guest-reply-llm-polish', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('is disabled by default', () => {
    vi.stubEnv('COMMUNICATION_LLM_POLISH_ENABLED', 'false');
    expect(isGuestReplyLlmPolishEnabled()).toBe(false);
  });

  it('returns the draft unchanged when polish is disabled', async () => {
    vi.stubEnv('COMMUNICATION_LLM_POLISH_ENABLED', 'false');
    const draft = 'Понял вопрос по оплате. Передаю его оператору, чтобы он проверил бронирование и условия.';

    await expect(
      polishGuestReplyWithLlm({ draftReply: draft, scenario: 'price_payment' }),
    ).resolves.toBe(draft);
    expect(mockedCallLlm).not.toHaveBeenCalled();
  });

  it('returns the draft when LLM is unavailable', async () => {
    vi.stubEnv('COMMUNICATION_LLM_POLISH_ENABLED', 'true');
    mockedCallLlm.mockResolvedValueOnce(null);
    const draft = 'Сейчас уточню точный адрес у оператора и напишу вам здесь.';

    await expect(
      polishGuestReplyWithLlm({ draftReply: draft, scenario: 'address_directions' }),
    ).resolves.toBe(draft);
  });

  it('accepts polished text only when it stays guest-safe', async () => {
    vi.stubEnv('COMMUNICATION_LLM_POLISH_ENABLED', 'true');
    const draft = 'Понял вопрос по оплате. Передаю его оператору, чтобы он проверил бронирование и условия.';
    const provider: GuestReplyLlmPolishProvider = {
      polishReply: async () =>
        'Понял ваш вопрос об оплате. Передаю оператору — он проверит бронирование и условия.',
    };

    await expect(
      polishGuestReplyWithLlm({ draftReply: draft, scenario: 'price_payment' }, provider),
    ).resolves.toBe('Понял ваш вопрос об оплате. Передаю оператору — он проверит бронирование и условия.');
  });

  it('rejects polished text with internal debug tokens', async () => {
    vi.stubEnv('COMMUNICATION_LLM_POLISH_ENABLED', 'true');
    const draft = 'Сейчас уточню точный адрес у оператора и напишу вам здесь.';
    const provider: GuestReplyLlmPolishProvider = {
      polishReply: async () => 'intent=address_directions missing fields object.address',
    };

    await expect(
      polishGuestReplyWithLlm({ draftReply: draft, scenario: 'address_directions' }, provider),
    ).resolves.toBe(draft);
  });
});
