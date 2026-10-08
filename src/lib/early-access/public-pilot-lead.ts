import { normalizeCrmContactInput, type NormalizedCrmContactInput } from '@/lib/crm/normalize';

const OBJECT_COUNT: Record<string, number> = {
  '1 объект': 1,
  '2-5 объектов': 2,
  '6-10 объектов': 6,
  '11-20 объектов': 11,
  'Более 20 объектов': 21,
};

export type PublicPilotLeadInput = {
  name?: unknown;
  contact?: unknown;
  objectsCount?: unknown;
  referral?: unknown;
  consent?: unknown;
  website?: unknown;
};

export type PublicPilotLeadResult =
  | { ok: true; input: NormalizedCrmContactInput }
  | { ok: false; message: string };

export function normalizePublicPilotLead(body: PublicPilotLeadInput): PublicPilotLeadResult {
  if (typeof body.website !== 'string' && body.website !== undefined) {
    return { ok: false, message: 'Не удалось проверить заявку.' };
  }
  if (String(body.website ?? '').trim()) {
    return { ok: false, message: 'Не удалось проверить заявку.' };
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const contact = typeof body.contact === 'string' ? body.contact.trim() : '';
  const count = typeof body.objectsCount === 'string' ? body.objectsCount.trim() : '';
  if (!name || name.length > 160 || /[\r\n\x00-\x1f]/.test(name)) {
    return { ok: false, message: 'Укажите имя (не более 160 символов).' };
  }
  if (!contact || contact.length > 100 || /[\r\n\x00-\x1f]/.test(contact)) {
    return { ok: false, message: 'Укажите телефон, Telegram или электронную почту.' };
  }
  if (!(count in OBJECT_COUNT)) {
    return { ok: false, message: 'Выберите количество объектов.' };
  }
  if (body.consent !== true) {
    return { ok: false, message: 'Подтвердите согласие с обработкой персональных данных.' };
  }

  const telegram = /^@[a-zA-Z0-9_]{5,32}$/.test(contact) ? contact.slice(1) : '';
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? contact : '';
  const digits = contact.replace(/\D/g, '');
  const phone = !email && !telegram && /^[+]?[\d ()-]{10,26}$/.test(contact) &&
    digits.length >= 10 && digits.length <= 15 ? contact : '';
  if (!telegram && !email && !phone) {
    return { ok: false, message: 'Проверьте контакт: телефон, @Telegram или email.' };
  }

  // A referral is attribution only, never access or membership authorization.
  const strigunov = body.referral === 'strigunov';
  const input = normalizeCrmContactInput({
    name,
    phone,
    telegramUsername: telegram,
    email: email || null,
    role: 'owner',
    source: 'form',
    objectsCount: OBJECT_COUNT[count],
    note: [
      'Заявка с сайта ASI, закрытый бесплатный пилот.',
      strigunov ? 'Источник заявки: Стригунов (переход по ссылке).' : 'Источник заявки: сайт ASI.',
      `Количество объектов (как выбрано): ${count}.`,
      'Ожидается проверка заявки оператором, не автоматическое подключение.',
    ].join('\n'),
    status: 'new',
    communicationStatus: 'needs_manual_reaction',
    nextStep: 'Связаться с заявителем, уточнить объект и согласовать подключение.',
  });
  return { ok: true, input };
}
