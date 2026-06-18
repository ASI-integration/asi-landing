import { sanitizeGuestFacingReply } from './guest-facing-ru';
import type { TelegramPropertyObjectV1 } from './telegram-booking-object-memory';

/** Домены гостевого консьержа v1. */
export type GuestConciergeDomain =
  | 'check_in_access'
  | 'check_out'
  | 'booking_stay'
  | 'house_rules'
  | 'property_appliances'
  | 'wifi_tech'
  | 'maintenance_issue'
  | 'nearby_area'
  | 'weather_local_plans'
  | 'safety_emergency'
  | 'off_topic_safe'
  | 'disallowed_or_sensitive';

/** Тип гостевой ситуации перед ответом. */
export type GuestConciergeSituationKind =
  | 'informational_question'
  | 'household_recommendation'
  | 'problem_or_breakdown'
  | 'urgent_danger'
  | 'off_topic_safe'
  | 'disallowed_or_sensitive'
  | 'unclear_message';

export type GuestConciergeNearbySubtype =
  | 'food'
  | 'grocery'
  | 'pharmacy'
  | 'transport'
  | 'sights'
  | 'general';

export type GuestConciergeMaintenanceSubtype =
  | 'wifi'
  | 'access_door'
  | 'water_leak'
  | 'appliance'
  | 'noise_neighbors'
  | 'cleaning_supplies'
  | 'general';

export type GuestConciergeClassification = {
  domain: GuestConciergeDomain;
  situation: GuestConciergeSituationKind;
  confidence: number;
  signals: string[];
  urgent: boolean;
  needsEscalation: boolean;
  nearbySubtype?: GuestConciergeNearbySubtype;
  maintenanceSubtype?: GuestConciergeMaintenanceSubtype;
};

export type GuestConciergeReplyContext = {
  property?: TelegramPropertyObjectV1 | null;
  addressHint?: string | null;
};

function normalizeRu(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function has(text: string, ...needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function matches(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function textOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function composeLocationHint(context: GuestConciergeReplyContext): string {
  const address = textOrNull(context.addressHint) ?? textOrNull(context.property?.address);
  if (address) return `в районе: ${address}`;
  return 'рядом с объектом';
}

function detectNearbySubtype(text: string): GuestConciergeNearbySubtype {
  if (has(text, 'ресторан', 'кафе', 'кофейн', 'поесть', 'завтрак', 'обед', 'ужин', 'грузинск', 'итальянск', 'еда', 'перекус', 'кофе')) {
    return 'food';
  }
  if (has(text, 'продукт', 'магазин', 'супермаркет', 'молок', 'хлеб', 'купить', 'доставк')) {
    return 'grocery';
  }
  if (has(text, 'аптек', 'лекарств', 'таблет', 'пластыр', 'градусник')) {
    return 'pharmacy';
  }
  if (has(text, 'транспорт', 'метро', 'такси', 'автобус', 'трамва', 'как доехать', 'маршрут', 'остановк', 'парковк', 'банкомат')) {
    return 'transport';
  }
  if (has(text, 'посмотреть', 'достопримеч', 'погулять', 'рядом интересн', 'музе', 'парк', 'куда сходить')) {
    return 'sights';
  }
  return 'general';
}

function detectMaintenanceSubtype(text: string): GuestConciergeMaintenanceSubtype {
  if (has(text, 'wi-fi', 'wifi', 'вайф', 'вай фай', 'вай-фай', 'интернет', 'сеть') && has(text, 'не работ', 'не подключ', 'пропал', 'не груз', 'не открыва')) {
    return 'wifi';
  }
  if (
    has(text, 'не открыва', 'не открывает', 'застрял', 'не могу попасть', 'не могу войти', 'нет доступа', 'ключ', 'замок', 'домофон', 'код') &&
    has(text, 'двер', 'вход', 'подъезд', 'ключ', 'замок', 'домофон', 'код')
  ) {
    return 'access_door';
  }
  if (has(text, 'потек', 'протеч', 'течет', 'течёт', 'залива', 'затоп', 'потоп', 'вода под', 'капает')) {
    return 'water_leak';
  }
  if (has(text, 'сосед', 'шум', 'громко', 'музык', 'кричат')) {
    return 'noise_neighbors';
  }
  if (has(text, 'гряз', 'не убран', 'нет полотен', 'нет бель', 'не хватает', 'туалетн')) {
    return 'cleaning_supplies';
  }
  if (has(text, 'чайник', 'плит', 'стирал', 'холодильник', 'кондиционер', 'отоплен', 'свет', 'розетк', 'сантехник', 'душ', 'унитаз')) {
    return 'appliance';
  }
  return 'general';
}

function isDisallowedOrSensitive(text: string): boolean {
  return (
    matches(text, /(как|инструкц).{0,24}(взлом|вскрыть|обойти).{0,24}(замок|двер)/iu) ||
    matches(text, /(украсть|наркот|самоубий|убить|вред себе|обойти закон)/iu) ||
    matches(text, /(юридическ|медицинск|диагноз|лечени).{0,32}(совет|рекоменд)/iu) ||
    has(text, 'взломать замок', 'вскрыть замок', 'обойти замок', 'взлом двери')
  );
}

function isSafetyEmergency(text: string): boolean {
  return (
    has(text, 'пожар', 'горит', 'дым', 'газ', 'утечк', 'угроз', 'напал', 'оружие', 'нож', 'кровь', 'не дыш', 'потерял сознание') ||
    (has(text, 'опасно', 'срочно', 'помогите') && has(text, 'вода', 'электричество', 'дверь', 'замок', 'пожар', 'газ'))
  );
}

function isOffTopicSafe(text: string): boolean {
  if (matches(text, /(что такое|объясни|расскажи).{0,48}(закон|термодинамик|физик|математик|квант|истори|политик|философ)/iu)) {
    return true;
  }
  if (matches(text, /второй закон термодинамик/iu)) return true;
  if (has(text, 'термодинамик', 'энтропи') && !has(text, 'отоплен', 'батаре', 'кондиционер', 'температур в квартир')) {
    return true;
  }
  return false;
}

function isMaintenanceProblem(text: string): boolean {
  return (
    has(text, 'не работает', 'сломано', 'сломался', 'сломалась', 'поломк', 'протекает', 'течет', 'течёт', 'нет горячей воды') ||
    has(text, 'грязно', 'не убрано', 'не хватает', 'сосед', 'шум') ||
    detectMaintenanceSubtype(text) !== 'general'
  );
}

function isBookingStaySensitive(text: string): boolean {
  return has(
    text,
    'возврат',
    'вернуть деньги',
    'компенсац',
    'скидк',
    'жалоб',
    'конфликт',
    'спор',
    'претенз',
    'продл',
    'продлен',
    'измен',
    'перенести брон',
    'отмен',
    'депозит',
    'документ',
    'доплат',
    'оплат',
    'счет',
    'чек',
    'обеща',
    'оператор',
    'человек',
    'паспорт',
    'персональн',
    'личные данные',
    'банковск',
    'картой',
    'платеж',
  );
}

function isHouseRulesQuestion(text: string): boolean {
  return (
    has(text, 'правил', 'тишин', 'животн', 'шум', 'мусор', 'уборк', 'бель', 'полотенц', 'вечеринк') ||
    has(text, 'курить', 'курени', 'табач', 'сигарет', 'вейп', 'vape', 'кальян')
  );
}

function isWifiTechQuestion(text: string): boolean {
  return has(text, 'wi-fi', 'wifi', 'вайф', 'вай фай', 'вай-фай', 'интернет', 'телевизор', 'приставк', 'роутер', 'сеть', 'парол');
}

function isPropertyAppliancesQuestion(text: string): boolean {
  return has(
    text,
    'чайник',
    'плит',
    'стирал',
    'холодильник',
    'свет',
    'вода',
    'отоплен',
    'кондиционер',
    'окн',
    'розетк',
    'сантехник',
    'душ',
    'унитаз',
    'батаре',
  );
}

function isCheckInAccess(text: string): boolean {
  return (
    has(text, 'заезд', 'заселен', 'заселиться', 'как попасть', 'как зайти', 'адрес', 'как добраться', 'как найти', 'где наход', 'подъезд', 'домофон') ||
    has(text, 'ключ', 'код от двер', 'код двер', 'код на двер', 'код доступа') ||
    (has(text, 'код') && has(text, 'двер'))
  );
}

function isCheckOut(text: string): boolean {
  return has(text, 'выезд', 'check-out', 'checkout', 'чекаут', 'поздн', 'ключ', 'оставить ключ', 'перед выездом');
}

function isNearbyArea(text: string): boolean {
  return (
    has(text, 'рядом', 'поблизости', 'недалеко', 'около объекта', 'в районе', 'ресторан', 'кафе', 'завтрак', 'аптек', 'магазин', 'метро', 'такси') ||
    detectNearbySubtype(text) !== 'general'
  );
}

function isWeatherOrPlans(text: string): boolean {
  return has(text, 'погод', 'зонт', 'одеться', 'дожд', 'снег', 'холодно', 'жарко', 'прогноз', 'куда сходить сегодня', 'чем заняться');
}

/** Определяет домен и тип гостевой ситуации. */
export function classifyGuestConciergeMessage(messageText: string): GuestConciergeClassification {
  const text = normalizeRu(messageText);
  const signals: string[] = [];

  if (!text) {
    return {
      domain: 'off_topic_safe',
      situation: 'unclear_message',
      confidence: 0.3,
      signals: ['concierge_v1_empty_message'],
      urgent: false,
      needsEscalation: false,
    };
  }

  if (isDisallowedOrSensitive(text)) {
    return {
      domain: 'disallowed_or_sensitive',
      situation: 'disallowed_or_sensitive',
      confidence: 0.99,
      signals: ['concierge_v1_disallowed'],
      urgent: false,
      needsEscalation: false,
    };
  }

  if (isSafetyEmergency(text)) {
    return {
      domain: 'safety_emergency',
      situation: 'urgent_danger',
      confidence: 0.98,
      signals: ['concierge_v1_safety_emergency'],
      urgent: true,
      needsEscalation: true,
    };
  }

  if (isMaintenanceProblem(text)) {
    const maintenanceSubtype = detectMaintenanceSubtype(text);
    const urgent = maintenanceSubtype === 'water_leak';
    signals.push('concierge_v1_maintenance');
    return {
      domain: 'maintenance_issue',
      situation: urgent ? 'urgent_danger' : 'problem_or_breakdown',
      confidence: 0.93,
      signals,
      urgent,
      needsEscalation: true,
      maintenanceSubtype,
    };
  }

  if (isBookingStaySensitive(text)) {
    return {
      domain: 'booking_stay',
      situation: 'informational_question',
      confidence: 0.92,
      signals: ['concierge_v1_booking_stay'],
      urgent: false,
      needsEscalation: true,
    };
  }

  if (isOffTopicSafe(text)) {
    return {
      domain: 'off_topic_safe',
      situation: 'off_topic_safe',
      confidence: 0.88,
      signals: ['concierge_v1_off_topic'],
      urgent: false,
      needsEscalation: false,
    };
  }

  if (isWifiTechQuestion(text)) {
    signals.push('concierge_v1_wifi_tech');
    const isProblem = has(text, 'не работ', 'не подключ', 'пропал', 'не груз', 'слабый сигнал');
    return {
      domain: 'wifi_tech',
      situation: isProblem ? 'problem_or_breakdown' : 'informational_question',
      confidence: 0.9,
      signals,
      urgent: false,
      needsEscalation: isProblem,
      maintenanceSubtype: isProblem ? 'wifi' : undefined,
    };
  }

  if (isHouseRulesQuestion(text)) {
    return {
      domain: 'house_rules',
      situation: 'informational_question',
      confidence: 0.9,
      signals: ['concierge_v1_house_rules'],
      urgent: false,
      needsEscalation: false,
    };
  }

  if (isCheckOut(text) && !isCheckInAccess(text)) {
    return {
      domain: 'check_out',
      situation: 'informational_question',
      confidence: 0.88,
      signals: ['concierge_v1_check_out'],
      urgent: false,
      needsEscalation: false,
    };
  }

  if (isCheckInAccess(text)) {
    return {
      domain: 'check_in_access',
      situation: 'informational_question',
      confidence: 0.88,
      signals: ['concierge_v1_check_in_access'],
      urgent: false,
      needsEscalation: false,
    };
  }

  if (isPropertyAppliancesQuestion(text)) {
    return {
      domain: 'property_appliances',
      situation: 'informational_question',
      confidence: 0.84,
      signals: ['concierge_v1_property_appliances'],
      urgent: false,
      needsEscalation: false,
    };
  }

  if (isWeatherOrPlans(text)) {
    return {
      domain: 'weather_local_plans',
      situation: 'household_recommendation',
      confidence: 0.86,
      signals: ['concierge_v1_weather_plans'],
      urgent: false,
      needsEscalation: false,
    };
  }

  if (isNearbyArea(text)) {
    const nearbySubtype = detectNearbySubtype(text);
    signals.push('concierge_v1_nearby_area');
    return {
      domain: 'nearby_area',
      situation: 'household_recommendation',
      confidence: 0.87,
      signals,
      urgent: false,
      needsEscalation: false,
      nearbySubtype,
    };
  }

  return {
    domain: 'off_topic_safe',
    situation: 'unclear_message',
    confidence: 0.45,
    signals: ['concierge_v1_unclear'],
    urgent: false,
    needsEscalation: false,
  };
}

function guestTemplate(text: string): string {
  return sanitizeGuestFacingReply(text) ?? text;
}

function composeNearbyFoodReply(location: string): string {
  return guestTemplate(
    `Да, конечно. Если нужно быстро и недалеко, лучше смотреть варианты в пешей доступности ${location}. Точных проверенных рекомендаций по этому объекту у меня пока нет, поэтому перед выходом лучше сверить часы работы и рейтинг в картах. Если хотите, могу подсказать, какие варианты обычно удобнее искать: завтрак, кофе с собой или полноценное кафе.`,
  );
}

function composeNearbyBreakfastReply(location: string): string {
  return guestTemplate(
    `Утром удобнее всего смотреть кафе и завтраки в пешей доступности ${location}. Точных проверенных мест по этому объекту у меня пока нет — перед выходом лучше сверить часы работы и рейтинг в картах. Если подскажете, нужен быстрый кофе, полноценный завтрак или что-то с собой, помогу сориентироваться, что искать.`,
  );
}

function composeNearbyGroceryReply(location: string): string {
  return guestTemplate(
    `Да. Продукты удобнее искать ${location}: супермаркет, магазин у дома или доставку. Точных проверенных адресов у меня пока нет — перед выходом лучше сверить часы работы в картах.`,
  );
}

function composeNearbyPharmacyReply(location: string): string {
  return guestTemplate(
    `Аптеку лучше искать ${location} в картах. Точных проверенных адресов у меня пока нет — перед выходом проверьте часы работы и наличие нужного препарата.`,
  );
}

function composeNearbyTransportReply(location: string): string {
  return guestTemplate(
    `Для транспорта рядом с объектом удобнее проверить маршрут ${location} в картах: метро, остановки и такси могут зависеть от времени дня. Точных проверенных вариантов по этому объекту у меня пока нет.`,
  );
}

function composeNearbySightsReply(location: string): string {
  return guestTemplate(
    `Можно посмотреть места для прогулки и достопримечательности ${location}. Точных проверенных рекомендаций у меня пока нет — лучше выбрать по картам и отзывам то, что ближе и удобно по времени.`,
  );
}

function composeNearbyGeneralReply(location: string): string {
  return guestTemplate(
    `Да. Я могу подсказать по нейтральным вопросам ${location}. Точных проверенных адресов и часов работы у меня пока нет — перед выходом лучше сверить это в картах.`,
  );
}

function composeWeatherPlansReply(location: string): string {
  return guestTemplate(
    `По погоде лучше свериться с актуальным прогнозом в картах или погодном приложении ${location}. Если подскажете, планируете прогулку, поездку или что-то рядом с объектом, помогу сориентироваться по бытовым вариантам без выдуманных мест.`,
  );
}

function composeMaintenanceReply(subtype: GuestConciergeMaintenanceSubtype | undefined): string {
  switch (subtype) {
    case 'wifi':
      return guestTemplate(
        'Понял, с Wi-Fi неудобно. Попробуйте на минуту выключить и снова включить Wi-Fi на устройстве и открыть любой другой сайт. Если не поможет, напишите, пожалуйста: сеть видна, но не подключается, или подключение есть, но сайты не открываются. Передаю вопрос оператору.',
      );
    case 'access_door':
      return guestTemplate(
        'Понял, с доступом не получается. Проверьте, пожалуйста, код или ключ ещё раз без лишней спешки и убедитесь, что это нужная дверь или подъезд. Если не откроется, напишите, что именно происходит: код не подходит, ключ не поворачивается или домофон молчит. Передаю вопрос оператору.',
      );
    case 'water_leak':
      return guestTemplate(
        'Понял. Если безопасно, перекройте воду под раковиной или у стояка и не трогайте электроприборы рядом с водой. Передаю срочно оператору — он свяжется с вами.',
      );
    case 'noise_neighbors':
      return guestTemplate(
        'Понял, шум мешает. Если ситуация спокойная, попробуйте сначала не вступать в конфликт. Если шум продолжается или есть угроза, напишите, пожалуйста, что именно происходит. Передаю вопрос оператору.',
      );
    case 'cleaning_supplies':
      return guestTemplate(
        'Понял, с чистотой или расходниками проблема. Напишите, пожалуйста, чего именно не хватает или что не устроило. Передаю вопрос оператору.',
      );
    case 'appliance':
      return guestTemplate(
        'Понял, техника работает не так, как нужно. Напишите, пожалуйста, что именно сломалось или не включается. Если есть риск протечки или запаха гари — сразу отключите прибор от сети. Передаю вопрос оператору.',
      );
    default:
      return guestTemplate(
        'Понял, есть проблема в объекте. Напишите, пожалуйста, что именно случилось и где. Передаю вопрос оператору — команда проверит и поможет.',
      );
  }
}

function composeSafetyEmergencyReply(): string {
  return guestTemplate(
    'Понял, это срочно. Если есть угроза жизни, пожар, газ или сильное затопление — звоните 112. Передаю сообщение оператору.',
  );
}

function composeBookingStayReply(): string {
  return guestTemplate(
    'Понял вопрос по бронированию. Передаю оператору — он проверит условия и напишет вам здесь.',
  );
}

function composeDisallowedReply(): string {
  return guestTemplate(
    'С такими запросами помочь не могу. Если нужна помощь по проживанию, заезду, объекту, району или бытовым вопросам — напишите, и я подскажу.',
  );
}

function composeOffTopicReply(messageText: string): string {
  const text = normalizeRu(messageText);
  if (matches(text, /второй закон термодинамик|термодинамик|энтропи/iu)) {
    return guestTemplate(
      'Если совсем коротко: в замкнутой системе беспорядок со временем обычно растёт. Но я здесь в первую очередь как помощник по проживанию, поэтому лучше всего помогу с заездом, объектом, районом, техникой и бытовыми вопросами.',
    );
  }
  return guestTemplate(
    'Могу коротко ответить, но я здесь в первую очередь как помощник по проживанию. Лучше всего помогу с заездом, объектом, районом, техникой и бытовыми вопросами.',
  );
}

/** Собирает живой ответ гостю по классификации Operating Domain v1. */
export function composeGuestConciergeOperatingReply(
  classification: GuestConciergeClassification,
  context: GuestConciergeReplyContext,
  messageText = '',
): string {
  const location = composeLocationHint(context);
  const lower = normalizeRu(messageText);

  switch (classification.domain) {
    case 'nearby_area': {
      if (classification.nearbySubtype === 'food' && has(lower, 'завтрак', 'утром', 'кофе')) {
        return composeNearbyBreakfastReply(location);
      }
      switch (classification.nearbySubtype) {
        case 'food':
          return composeNearbyFoodReply(location);
        case 'grocery':
          return composeNearbyGroceryReply(location);
        case 'pharmacy':
          return composeNearbyPharmacyReply(location);
        case 'transport':
          return composeNearbyTransportReply(location);
        case 'sights':
          return composeNearbySightsReply(location);
        default:
          return composeNearbyGeneralReply(location);
      }
    }
    case 'weather_local_plans':
      return composeWeatherPlansReply(location);
    case 'maintenance_issue':
      return composeMaintenanceReply(classification.maintenanceSubtype);
    case 'booking_stay':
      return composeBookingStayReply();
    case 'safety_emergency':
      return composeSafetyEmergencyReply();
    case 'disallowed_or_sensitive':
      return composeDisallowedReply();
    case 'off_topic_safe':
      if (classification.situation === 'off_topic_safe') {
        return composeOffTopicReply(messageText);
      }
      return guestTemplate(
        'Пока не до конца понял вопрос. Напишите, пожалуйста, что нужно по проживанию: заезд, доступ, Wi-Fi, техника, район рядом или проблема в объекте.',
      );
    default:
      return composeNearbyGeneralReply(location);
  }
}

/** Точка расширения для эскалации владельцу/оператору. */
export function shouldEscalateGuestConcierge(classification: GuestConciergeClassification): boolean {
  return classification.needsEscalation;
}
