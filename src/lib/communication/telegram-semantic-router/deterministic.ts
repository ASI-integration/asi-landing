import type {
  TelegramSemanticRouterIntent,
  TelegramSemanticRouterResult,
  TelegramSemanticTopic,
} from './types';

function normalizeRu(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function has(text: string, ...needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function hasWasteDisposalRequest(text: string): boolean {
  if (
    has(
      text,
      'где выбрасывать мусор',
      'куда выносить мусор',
      'где мусорка',
      'где мусорку',
      'где баки',
      'где контейнеры',
      'мусорные баки',
      'мусорные контейнеры',
      'куда деть мусор',
      'где контейнерная площадка',
      'контейнерная площадка',
      'trash bins',
      'garbage bins',
      'recycling',
    )
  ) {
    return true;
  }
  return (
    text.includes('мусор') &&
    has(text, 'где', 'куда', 'выбрасывать', 'выкинуть', 'выносить', 'отнести', 'деть')
  );
}

function hasCleaningIssue(text: string): boolean {
  if (hasWasteDisposalRequest(text)) return false;
  return (
    has(
      text,
      'гряз',
      'не убрали',
      'нет полотенец',
      'пахнет',
      'туалетной бумаги',
      'белье гряз',
      'бельё гряз',
      'уборк',
      'не убран',
    ) ||
    (text.includes('мусор') &&
      has(text, 'не вывезли', 'переполн', 'воняет', 'грязн', 'остал', 'от прошлых', 'не убран'))
  );
}

function hasLateCheckoutRequest(text: string): boolean {
  if (
    has(
      text,
      'поздний выезд',
      'выехать попозже',
      'выезд попозже',
      'late checkout',
      'задержимся с выездом',
      'можно late checkout',
    )
  ) {
    return true;
  }
  return has(text, 'можно позже', 'попозже', 'позже выех') && has(text, 'выех', 'выезд');
}

function hasEarlyCheckinRequest(text: string): boolean {
  return has(
    text,
    'ранний заезд',
    'заехать раньше',
    'приедем в',
    'оставить чемоданы',
    'оставить багаж',
    'остаться до',
  );
}

function hasWifiProblemRequest(text: string): boolean {
  const wifiTerms = ['wifi', 'wi-fi', 'wi fi', 'вайф', 'вай фай', 'вай-фай', 'интернет', 'сеть'];
  const exactProblem = [
    'интернет не работает',
    'не работает интернет',
    'интернет пропал',
    'пропал интернет',
    'нет интернета',
    'интернета нет',
    'wifi не работает',
    'wi-fi не работает',
    'вайфай не работает',
    'сайты не открываются',
    'сайты не грузятся',
    'не открываются сайты',
    'не грузит интернет',
    'не грузится интернет',
    'интернет не грузит',
    'подключен, но интернета нет',
    'подключение есть, но сайты',
    'сеть есть, но сайты',
  ];
  const problemMarkers = [
    'не работает',
    'не подключается',
    'не можем подключиться',
    'не могу подключиться',
    'не получается подключиться',
    'нет интернета',
    'интернета нет',
    'пропал',
    'не грузит',
    'не грузится',
    'не открываются',
    'не открывается',
  ];
  return has(text, ...exactProblem) || (has(text, ...wifiTerms) && has(text, ...problemMarkers));
}

function hasWifiAccessRequest(text: string): boolean {
  const wifiTerms = ['wifi', 'wi-fi', 'wi fi', 'вайф', 'вай-фай', 'вай фай', 'интернет', 'сети гостя'];
  if (!has(text, ...wifiTerms)) return false;
  if (hasWifiProblemRequest(text)) return false;
  return has(text, 'парол', 'password', 'подключ', 'данные', 'какой', 'название', 'сеть', 'логин');
}

function buildResult(params: {
  intent: TelegramSemanticRouterIntent;
  confidence: number;
  topic: TelegramSemanticTopic;
  is_problem: boolean;
  needs_booking_context: boolean;
  requested_secret: boolean;
  knowledge_keys: string[];
  problem_type: string | null;
  guest_safe_summary: string;
}): TelegramSemanticRouterResult {
  return {
    intent: params.intent,
    confidence: params.confidence,
    topic: params.topic,
    is_problem: params.is_problem,
    needs_booking_context: params.needs_booking_context,
    requested_secret: params.requested_secret,
    knowledge_keys: params.knowledge_keys,
    slots: { problem_type: params.problem_type },
    guest_safe_summary: params.guest_safe_summary,
    source: 'deterministic',
  };
}

export function classifyTelegramGuestSemanticDeterministic(messageText: string): TelegramSemanticRouterResult {
  const text = normalizeRu(messageText);
  if (!text) {
    return buildResult({
      intent: 'unknown',
      confidence: 0.2,
      topic: 'general',
      is_problem: false,
      needs_booking_context: false,
      requested_secret: false,
      knowledge_keys: [],
      problem_type: null,
      guest_safe_summary: 'Пустое сообщение гостя.',
    });
  }

  if (has(text, 'пожар', 'дым', 'газ', 'угроза', 'опасно', 'помогите срочно')) {
    return buildResult({
      intent: 'urgent_access_problem',
      confidence: 0.97,
      topic: 'access',
      is_problem: true,
      needs_booking_context: true,
      requested_secret: false,
      knowledge_keys: [],
      problem_type: 'safety_emergency',
      guest_safe_summary: 'Гость сообщает об опасной ситуации.',
    });
  }

  if (
    has(text, 'стою у двери', 'не могу попасть', 'не могу войти', 'нет доступа', 'застрял на улице') ||
    (has(text, 'код', 'ключ', 'домофон', 'двер', 'замок') &&
      has(text, 'не работает', 'не подходит', 'не открывает', 'не открывается'))
  ) {
    return buildResult({
      intent: 'urgent_access_problem',
      confidence: 0.96,
      topic: 'access',
      is_problem: true,
      needs_booking_context: true,
      requested_secret: true,
      knowledge_keys: ['door_code_notes', 'check_in_text'],
      problem_type: 'access_blocked',
      guest_safe_summary: 'Гость не может попасть в объект, проблема с доступом.',
    });
  }

  if (hasWasteDisposalRequest(text)) {
    return buildResult({
      intent: 'waste_disposal_info',
      confidence: 0.93,
      topic: 'waste',
      is_problem: false,
      needs_booking_context: true,
      requested_secret: false,
      knowledge_keys: ['trash_bins_location', 'waste_disposal_text'],
      problem_type: null,
      guest_safe_summary: 'Гость спрашивает, куда выносить мусор или где баки.',
    });
  }

  if (hasCleaningIssue(text)) {
    return buildResult({
      intent: 'cleaning_issue',
      confidence: 0.92,
      topic: 'cleaning',
      is_problem: true,
      needs_booking_context: true,
      requested_secret: false,
      knowledge_keys: [],
      problem_type: 'housekeeping',
      guest_safe_summary: 'Гость жалуется на уборку или чистоту.',
    });
  }

  if (hasWifiProblemRequest(text)) {
    return buildResult({
      intent: 'wifi_problem',
      confidence: 0.91,
      topic: 'wifi',
      is_problem: true,
      needs_booking_context: true,
      requested_secret: false,
      knowledge_keys: ['wifi_name', 'wifi_instruction_text'],
      problem_type: 'internet_not_working',
      guest_safe_summary: 'Гость сообщает, что интернет или Wi-Fi не работает.',
    });
  }

  if (hasWifiAccessRequest(text) || has(text, 'вайф', 'wi-fi', 'wifi', 'интернет', 'сети гостя')) {
    const requestedSecret = has(text, 'парол', 'password');
    return buildResult({
      intent: 'wifi_access',
      confidence: requestedSecret ? 0.9 : 0.82,
      topic: 'wifi',
      is_problem: false,
      needs_booking_context: true,
      requested_secret: requestedSecret,
      knowledge_keys: ['wifi_name', 'wifi_password', 'wifi_instruction_text'],
      problem_type: null,
      guest_safe_summary: requestedSecret
        ? 'Гость просит данные для подключения к Wi-Fi.'
        : 'Гость спрашивает про Wi-Fi или интернет.',
    });
  }

  if (has(text, 'как заселиться', 'заселен', 'заселение', 'инструкция по заселению', 'где ключ', 'как попасть в квартиру')) {
    return buildResult({
      intent: 'check_in_access',
      confidence: 0.88,
      topic: 'access',
      is_problem: false,
      needs_booking_context: true,
      requested_secret: has(text, 'код', 'ключ'),
      knowledge_keys: ['check_in_text', 'door_code_notes'],
      problem_type: null,
      guest_safe_summary: 'Гость спрашивает про заселение или вход.',
    });
  }

  if (has(text, 'дайте код', 'код для входа', 'одноразовый код', 'код от двери', 'код доступа')) {
    return buildResult({
      intent: 'checkin_code_request',
      confidence: 0.94,
      topic: 'access',
      is_problem: false,
      needs_booking_context: true,
      requested_secret: true,
      knowledge_keys: ['door_code_notes'],
      problem_type: null,
      guest_safe_summary: 'Гость просит код для входа.',
    });
  }

  if (has(text, 'как добраться', 'как доехать', 'маршрут', 'адрес', 'где находится', 'куда ехать')) {
    return buildResult({
      intent: 'property_directions',
      confidence: 0.87,
      topic: 'directions',
      is_problem: false,
      needs_booking_context: true,
      requested_secret: false,
      knowledge_keys: ['address', 'directions_text'],
      problem_type: null,
      guest_safe_summary: 'Гость спрашивает адрес или маршрут.',
    });
  }

  if (has(text, 'парков', 'припарков', 'стоянк', 'машину куда')) {
    return buildResult({
      intent: 'parking',
      confidence: 0.86,
      topic: 'parking',
      is_problem: false,
      needs_booking_context: true,
      requested_secret: false,
      knowledge_keys: ['parking_text'],
      problem_type: null,
      guest_safe_summary: 'Гость спрашивает про парковку.',
    });
  }

  if (has(text, 'не работает душ', 'протекает', 'не греет вода', 'нет горячей воды', 'кондиционер', 'холодильник', 'сломал')) {
    return buildResult({
      intent: 'maintenance_issue',
      confidence: 0.9,
      topic: 'maintenance',
      is_problem: true,
      needs_booking_context: true,
      requested_secret: false,
      knowledge_keys: [],
      problem_type: 'equipment_failure',
      guest_safe_summary: 'Гость сообщает о поломке или неисправности.',
    });
  }

  if (hasLateCheckoutRequest(text) || hasEarlyCheckinRequest(text)) {
    return buildResult({
      intent: 'early_checkin_late_checkout',
      confidence: 0.89,
      topic: 'checkout',
      is_problem: false,
      needs_booking_context: true,
      requested_secret: false,
      knowledge_keys: [],
      problem_type: null,
      guest_safe_summary: 'Гость спрашивает про ранний заезд или поздний выезд.',
    });
  }

  if (has(text, 'до скольки выезд', 'время выезда', 'когда выезжать')) {
    return buildResult({
      intent: 'checkout',
      confidence: 0.85,
      topic: 'checkout',
      is_problem: false,
      needs_booking_context: true,
      requested_secret: false,
      knowledge_keys: ['checkout_time'],
      problem_type: null,
      guest_safe_summary: 'Гость спрашивает про время выезда.',
    });
  }

  if (has(text, 'бронь', 'бронирование', 'номер брони')) {
    return buildResult({
      intent: 'booking_lookup_missing_details',
      confidence: 0.8,
      topic: 'booking',
      is_problem: false,
      needs_booking_context: true,
      requested_secret: false,
      knowledge_keys: [],
      problem_type: null,
      guest_safe_summary: 'Гость ищет или уточняет бронирование.',
    });
  }

  return buildResult({
    intent: 'unknown',
    confidence: 0.35,
    topic: 'general',
    is_problem: false,
    needs_booking_context: false,
    requested_secret: false,
    knowledge_keys: [],
    problem_type: null,
    guest_safe_summary: 'Смысл сообщения гостя пока неясен.',
  });
}
