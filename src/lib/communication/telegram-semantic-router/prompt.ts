import type { TelegramSemanticRouterInput } from './types';
import { TELEGRAM_SEMANTIC_ROUTER_INTENTS, TELEGRAM_SEMANTIC_TOPICS } from './types';

export function buildTelegramSemanticRouterPrompt(input: TelegramSemanticRouterInput): string {
  const contextFacts = [
    input.bookingId ? `booking_id=${input.bookingId}` : null,
    input.canonIntent ? `canon_intent=${input.canonIntent}` : null,
    input.deterministicIntent ? `deterministic_intent=${input.deterministicIntent}` : null,
  ]
    .filter(Boolean)
    .join('; ');

  return [
    'Верни только один валидный JSON-объект без markdown.',
    'Ты semantic router для гостевого Telegram-бота краткосрочной аренды ASI (только русский смысл, guest_safe_summary на русском).',
    `Допустимые intent: ${TELEGRAM_SEMANTIC_ROUTER_INTENTS.join(', ')}.`,
    `Допустимые topic: ${TELEGRAM_SEMANTIC_TOPICS.join(', ')}.`,
    'Правила различения:',
    '- wifi_access: гость хочет подключиться, узнать сеть или пароль; requested_secret=true только если явно просит пароль/код доступа к Wi-Fi.',
    '- wifi_problem: интернет/Wi-Fi не работает, не подключается, сайты не открываются; is_problem=true; НЕ путать с wifi_access.',
    '- waste_disposal_info: где баки/контейнеры, куда выносить мусор; НЕ путать с cleaning_issue.',
    '- cleaning_issue: грязь, не убрали, нет полотенец, запах; мусор как проблема уборки (остался, не вывезли), не как контейнеры.',
    '- early_checkin_late_checkout: поздний выезд, выехать попозже, можно позже выехать; needs_booking_context=true.',
    '- checkout: стандартное время выезда, до скольки выехать; НЕ путать с early_checkin_late_checkout.',
    '- urgent_access_problem: не могу войти, код/замок не работает, стою у двери.',
    '- checkin_code_request: просит код заселения/входа (не Wi-Fi).',
    '- needs_booking_context=true, если для ответа нужна проверенная бронь или объект.',
    '- knowledge_keys: только из списка полей объекта: wifi_name, wifi_password, wifi_instruction_text, trash_bins_location, waste_disposal_text, address, directions_text, parking_text, check_in_text, door_code_notes, baby_crib_note.',
    '- guest_safe_summary: одно короткое предложение без паролей, кодов, телефонов и URL.',
    '- Не выдумывай факты о брони, кодах, адресах.',
    'Схема: {"intent":"...","confidence":0.0,"topic":"...","is_problem":false,"needs_booking_context":false,"requested_secret":false,"knowledge_keys":[],"slots":{"problem_type":null},"guest_safe_summary":"..."}',
    contextFacts ? `Контекст: ${contextFacts}` : '',
    input.recentMessages?.length
      ? `Недавние реплики: ${input.recentMessages
          .slice(-3)
          .map((m) => `${m.direction}: ${m.content.slice(0, 160)}`)
          .join(' | ')}`
      : '',
    `Сообщение гостя: ${input.messageText}`,
  ]
    .filter(Boolean)
    .join('\n');
}
