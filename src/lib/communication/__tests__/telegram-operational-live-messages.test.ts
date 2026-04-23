import { describe, it, expect } from 'vitest';
import { tryTelegramOperationalIntake } from '../telegram-operational-intake';
import { composeTelegramOperationalReply } from '../telegram-reply-composer';

function replyFor(text: string, update_id = 101): string {
  const hit = tryTelegramOperationalIntake({
    text,
    surfaceLang: 'en',
    update_id,
    chat_id: 1,
  });
  expect(hit).not.toBeNull();
  if (!hit) throw new Error('expected hit');
  const out = composeTelegramOperationalReply({
    update_id,
    category: hit.category,
    action: hit.finalAction,
    lang: 'en',
    text,
    extractedFacts: hit.extractedFacts ?? {},
    missingFacts: hit.missingFacts ?? [],
    urgency: hit.finalAction === 'escalate_urgent' ? 'urgent' : 'normal',
    linkingState: null,
    sessionCase: null,
    sessionMemory: null,
  });
  return out.text;
}

describe('telegram operational intelligence (live-style messages)', () => {
  it('Guest cannot connect to Wi-Fi', () => {
    expect(replyFor('Guest cannot connect to Wi-Fi')).toBe('Understood. Which property is this for?');
  });

  it('Guest is at the entrance and the code does not work', () => {
    expect(replyFor('Guest is at the entrance and the code does not work')).toBe(
      'Understood. This looks urgent. I’m escalating it now.',
    );
  });

  it('Guest asks where they can park', () => {
    expect(replyFor('Guest asks where they can park')).toBe('Understood. Which property is this for?');
  });

  it('There is no heating and it is very cold', () => {
    expect(replyFor('There is no heating and it is very cold')).toBe('Understood. This looks urgent. I’m escalating it now.');
  });

  it('Guest asks for late checkout until 13:00', () => {
    expect(replyFor('Guest asks for late checkout until 13:00')).toBe('Understood. Which property is this for?');
  });
});

