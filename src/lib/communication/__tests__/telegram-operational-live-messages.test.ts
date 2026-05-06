import { describe, it, expect } from 'vitest';
import { tryTelegramOperationalIntake } from '../telegram-operational-intake';
import { composeTelegramOperationalReply } from '../telegram-reply-composer';

function replyFor(text: string, update_id = 101, surfaceLang: 'en' | 'ru' = 'en', shouldGreet = false): { reply: string; category: string } {
  const hit = tryTelegramOperationalIntake({
    text,
    surfaceLang,
    update_id,
    chat_id: 1,
  });
  expect(hit).not.toBeNull();
  if (!hit) throw new Error('expected hit');
  const out = composeTelegramOperationalReply({
    update_id,
    category: hit.category,
    action: hit.finalAction,
    lang: surfaceLang,
    text,
    extractedFacts: hit.extractedFacts ?? {},
    missingFacts: hit.missingFacts ?? [],
    urgency: hit.finalAction === 'escalate_urgent' ? 'urgent' : 'normal',
    linkingState: null,
    sessionCase: null,
    sessionMemory: null,
    shouldGreet,
  });
  return { reply: out.text, category: hit.category };
}

describe('telegram operational intelligence (live-style messages)', () => {
  it('Guest cannot connect to Wi-Fi', () => {
    expect(replyFor('Guest cannot connect to Wi-Fi').reply).toBe('Understood. Which property is this for?');
  });

  it('Guest is at the entrance and the code does not work', () => {
    expect(replyFor('Guest is at the entrance and the code does not work').reply).toBe(
      'Understood. This looks urgent. I’m escalating it now.',
    );
  });

  it('Guest asks where they can park', () => {
    expect(replyFor('Guest asks where they can park').reply).toBe('Understood. Which property is this for?');
  });

  it('There is no heating and it is very cold', () => {
    expect(replyFor('There is no heating and it is very cold').reply).toBe('Understood. This looks urgent. I’m escalating it now.');
  });

  it('Guest asks for late checkout until 13:00', () => {
    expect(replyFor('Guest asks for late checkout until 13:00').reply).toBe('Understood. Which property is this for?');
  });

  it('RU 15:00 called early check-in gets smart standard check-in reply before generic handoff', () => {
    const out = replyFor('Я гость. Хочу заехать завтра в 15:00, можно ранний заезд?', 201, 'ru', true);
    expect(out.category).toBe('checkin_time_question');
    expect(out.category).not.toBe('early_checkin');
    expect(out.reply).toContain('Здравствуйте!');
    expect(out.reply).toMatch(/15:00 обычно считается стандартным временем заезда, не ранним/i);
    expect(out.reply).toMatch(/готовность объекта после уборки/i);
    expect(out.reply).toMatch(/для какого это объекта или брони/i);
    expect(out.reply).not.toMatch(/Передаю это команде сейчас/i);
    expect(out.reply).not.toContain('(а)');
  });

  it('RU 15:00 does not repeat greeting after greeting was already sent', () => {
    const out = replyFor('Я гость. Хочу заехать завтра в 15:00, можно ранний заезд?', 202, 'ru', false);
    expect(out.reply).not.toContain('Здравствуйте!');
    expect(out.reply).toMatch(/^Понял\./);
  });

  it('RU 07:00 explains early check-in needs confirmation', () => {
    const out = replyFor('Можно заехать в 7 утра?', 203, 'ru', true);
    expect(out.category).toBe('early_checkin');
    expect(out.reply).toMatch(/ранний заезд/i);
    expect(out.reply).toMatch(/нужно отдельно подтвердить/i);
    expect(out.reply).not.toContain('(а)');
  });

  it('RU 12:00 mentions cleaning and previous checkout', () => {
    const out = replyFor('Можно заехать в 12:00?', 204, 'ru', true);
    expect(out.category).toBe('early_checkin');
    expect(out.reply).toMatch(/уборк/i);
    expect(out.reply).toMatch(/предыдущего выезда/i);
    expect(out.reply).not.toContain('(а)');
  });
});

