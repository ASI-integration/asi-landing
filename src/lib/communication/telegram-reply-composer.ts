import type { ConversationContext, Lang, ReservationPropertyLinkingStateV1 } from './types';
import type { TelegramOperationalCategory, TelegramOperationalFinalAction } from './telegram-operational-intake';
import type { TelegramOperationalSessionCaseV1 } from './types';

export type ReplyComposerAction = TelegramOperationalFinalAction;

export type ReplyComposerInput = {
  update_id: number;
  category: TelegramOperationalCategory;
  action: ReplyComposerAction;
  lang: Lang;
  /** Raw inbound message text; used for dominant-language resolution. */
  text: string;
  extractedFacts: Record<string, unknown>;
  missingFacts: string[];
  urgency: 'normal' | 'urgent';
  linkingState?: ReservationPropertyLinkingStateV1 | null;
  sessionCase?: TelegramOperationalSessionCaseV1 | null;
  sessionMemory?: ConversationContext | null;
};

export type ReplyComposerOutput = {
  text: string;
  template_key: string;
  language: Lang;
};

function pickVariant(update_id: number, options: [string, string]): string {
  // Stable deterministic alternation to avoid repetitive templates.
  return update_id % 2 === 0 ? options[0] : options[1];
}

function inferDominantLang(text: string, fallback: Lang): Lang {
  const raw = String(text ?? '');
  if (/[а-яё]/i.test(raw)) return 'ru';
  if (/(español|espanol|hola\b|buenos\s+dias|buenas\s+tardes|gracias|por\s+favor|hablas\b|wifi|contraseña)/i.test(raw)) {
    return 'es';
  }
  if (fallback === 'ru' || fallback === 'es' || fallback === 'en') return fallback;
  return 'en';
}

function normalizeLang(lang: Lang, text: string): Lang {
  const dominant = inferDominantLang(text, lang);
  if (dominant === 'ru' || dominant === 'es' || dominant === 'en') return dominant;
  return 'en';
}

function oneQuestion(lang: Lang, en: string, ru: string, es: string): string {
  if (lang === 'ru') return ru;
  if (lang === 'es') return es;
  return en;
}

function ack(lang: Lang): string {
  if (lang === 'ru') return 'Понял.';
  if (lang === 'es') return 'Entendido.';
  return 'Understood.';
}

type PropertyKnowledgeShape = {
  wifi_name?: string | null;
  wifi_password?: string | null;
  wifi_notes?: string | null;
  checkin_instructions?: string | null;
  door_code_notes?: string | null;
  access_notes?: string | null;
  parking_rules?: string | null;
  parking_paid_or_free?: string | null;
  parking_location_notes?: string | null;
  quiet_hours?: string | null;
  house_rules?: string | null;
  heating_notes?: string | null;
  emergency_contact_notes?: string | null;
  checkout_notes?: string | null;
  late_checkout_policy?: string | null;
  early_checkin_policy?: string | null;
};

function extractPropertyKnowledge(input: ReplyComposerInput): PropertyKnowledgeShape | null {
  const k = (input.extractedFacts as any)?.property_knowledge;
  if (!k || typeof k !== 'object') return null;
  return k as PropertyKnowledgeShape;
}

function lateCheckoutRequiresApproval(input: ReplyComposerInput): boolean {
  return Boolean((input.extractedFacts as any)?.late_checkout_requires_approval);
}

function shortTrim(s: string | null | undefined, limit: number): string | null {
  if (!s) return null;
  const v = String(s).trim();
  if (!v) return null;
  return v.length > limit ? `${v.slice(0, limit - 1).trim()}…` : v;
}

function wifiSnippet(k: PropertyKnowledgeShape): string | null {
  const parts: string[] = [];
  if (k.wifi_name) parts.push(`network ${String(k.wifi_name)}`);
  if (k.wifi_password) parts.push(`password ${String(k.wifi_password)}`);
  if (parts.length === 0 && k.wifi_notes) return shortTrim(k.wifi_notes, 140);
  if (parts.length === 0) return null;
  const base = parts.join(', ');
  const notes = shortTrim(k.wifi_notes, 80);
  return notes ? `${base} (${notes})` : base;
}

function parkingSnippet(k: PropertyKnowledgeShape): string | null {
  const parts: string[] = [];
  if (k.parking_paid_or_free) parts.push(String(k.parking_paid_or_free));
  if (k.parking_rules) parts.push(String(k.parking_rules));
  if (k.parking_location_notes) parts.push(String(k.parking_location_notes));
  const joined = parts.map(p => p.trim()).filter(Boolean).join('; ');
  return shortTrim(joined, 160);
}

function accessSnippet(k: PropertyKnowledgeShape): string | null {
  const parts: string[] = [];
  if (k.door_code_notes) parts.push(String(k.door_code_notes));
  if (k.access_notes) parts.push(String(k.access_notes));
  if (k.checkin_instructions && parts.length === 0) parts.push(String(k.checkin_instructions));
  const joined = parts.map(p => p.trim()).filter(Boolean).join('; ');
  return shortTrim(joined, 160);
}

function heatingSnippet(k: PropertyKnowledgeShape): string | null {
  const parts: string[] = [];
  if (k.heating_notes) parts.push(String(k.heating_notes));
  if (k.emergency_contact_notes) parts.push(String(k.emergency_contact_notes));
  const joined = parts.map(p => p.trim()).filter(Boolean).join('; ');
  return shortTrim(joined, 160);
}

function matchedContextSuffix(input: ReplyComposerInput, lang: Lang): string {
  const facts = input.extractedFacts ?? {};
  const guest = (facts as any).matched_guest ?? (facts as any).guest_name ?? (facts as any).guestName ?? null;
  const rawProp = (facts as any).matched_property_label ?? (facts as any).property_hint ?? (facts as any).property ?? null;
  const prop =
    typeof rawProp === 'string' && rawProp.trim()
      ? // Avoid appending non-address snippets like "the entrance and the code does not work"
        (/\d{1,4}/.test(rawProp) || /(nevsky|невск|liteyn|литейн|ул\.?|улиц|просп|наб\.?)/i.test(rawProp))
        ? rawProp
        : null
      : null;
  const parts: string[] = [];
  if (guest) parts.push(lang === 'ru' ? `гость ${String(guest)}` : `guest ${String(guest)}`);
  if (prop) parts.push(String(prop));
  if (parts.length === 0) return '';
  return lang === 'ru' ? ` (${parts.join(', ')})` : ` (${parts.join(', ')})`;
}

function escalateNow(lang: Lang, urgent: boolean): string {
  if (urgent) {
    if (lang === 'ru') return 'Похоже, это срочно. Передаю в приоритетную обработку.';
    if (lang === 'es') return 'Esto parece urgente. Lo escalo ahora.';
    return 'This looks urgent. I’m escalating it now.';
  }
  if (lang === 'ru') return 'Передаю это команде сейчас.';
  if (lang === 'es') return 'Lo paso al equipo ahora.';
  return 'I’m passing this to the team now.';
}

function shortHoldSentence(lang: Lang, topicEn: string, topicRu: string, topicEs: string): string {
  if (lang === 'ru') return `Проверю ${topicRu} и вернусь с ответом.`;
  if (lang === 'es') return `Revisaré ${topicEs} y te confirmo.`;
  return `I’ll check ${topicEn} and confirm shortly.`;
}

function textHasExplicitRuProperty(text: string): boolean {
  const t = String(text ?? '');
  // Priority RU patterns we must treat as an explicit object mention.
  // IMPORTANT: do NOT use `\b` here because JS word-boundaries are ASCII-centric and fail on Cyrillic.
  return /(?:^|[^\p{L}])(невск[\p{L}]*\s+\d{1,4}|литейн[\p{L}]*\s+\d{1,4})(?=$|[^\p{L}\d])/iu.test(t);
}

function clarifyPrompt(input: ReplyComposerInput): string {
  const lang = normalizeLang(input.lang, input.text);
  const cat = input.category;
  const missing = input.missingFacts ?? [];

  // Always ask exactly ONE best next question.
  if (cat === 'access_issue') {
    return oneQuestion(
      lang,
      "Is this for today’s check-in, and what exactly is failing: the code, the lock, or the door?",
      'Это про сегодняшнее заселение? Что именно не срабатывает: код, замок или дверь?',
      '¿Es para el check-in de hoy, y qué falla: el código, la cerradura o la puerta?',
    );
  }

  if (cat === 'late_checkout') {
    if (lang === 'ru' && textHasExplicitRuProperty(input.text)) {
      // Object is already explicit; do not ask "Для какого это объекта?"
      return oneQuestion(
        lang,
        'What time would you like for late checkout?',
        'До какого времени нужен поздний выезд?',
        '¿Hasta qué hora necesitas el late checkout?',
      );
    }
    return oneQuestion(
      lang,
      'Which property is this for?',
      'Для какого это объекта?',
      '¿Para qué propiedad es?',
    );
  }

  if (cat === 'early_checkin') {
    return oneQuestion(
      lang,
      'Which property is this for?',
      'Для какого это объекта?',
      '¿Para qué propiedad es?',
    );
  }

  if (cat === 'no_heating') {
    // Prefer location because it routes service faster.
    return oneQuestion(
      lang,
      'Which property is this for?',
      'Для какого это объекта?',
      '¿Para qué propiedad es?',
    );
  }

  if (cat === 'no_hot_water') {
    return oneQuestion(
      lang,
      'Which property is this for?',
      'Для какого это объекта?',
      '¿Para qué propiedad es?',
    );
  }

  if (cat === 'noise_complaint') {
    return oneQuestion(
      lang,
      'Is the noise happening right now?',
      'Шум сейчас продолжается?',
      '¿El ruido está ocurriendo ahora mismo?',
    );
  }

  if (cat === 'cleaning_request') {
    return oneQuestion(
      lang,
      'What do you need: cleaning, towel change, or linen change?',
      'Что нужно: уборка, смена полотенец или постельного белья?',
      '¿Qué necesitas: limpieza, cambio de toallas o cambio de sábanas?',
    );
  }

  if (cat === 'extension_request') {
    return oneQuestion(
      lang,
      'Which property is this for?',
      'Для какого это объекта?',
      '¿Para qué propiedad es?',
    );
  }

  if (cat === 'wifi_issue') {
    // If we already have property (via linking/session), ask the failure mode. Otherwise ask property.
    const knowsProperty =
      Boolean((input.sessionMemory as any)?.propertyLocation) ||
      Boolean((input.sessionMemory as any)?.propertyId) ||
      Boolean((input.sessionCase as any)?.property) ||
      Boolean((input.extractedFacts as any)?.property && (input.extractedFacts as any).property !== 'hint_present') ||
      (lang === 'ru' && textHasExplicitRuProperty(input.text));
    return knowsProperty
      ? oneQuestion(
          lang,
          'What exactly fails with Wi‑Fi: no network, can’t connect, or password not working?',
          'Что именно не работает с Wi‑Fi: нет сети, не подключается или пароль не подходит?',
          '¿Qué falla con el Wi‑Fi: no hay red, no conecta, o la contraseña no funciona?',
        )
      : oneQuestion(lang, 'Which property is this for?', 'Для какого это объекта?', '¿Para qué propiedad es?');
  }

  if (cat === 'parking_question') {
    if (missing.includes('property')) {
      return oneQuestion(lang, 'Which property is this for?', 'Для какого это объекта?', '¿Para qué propiedad es?');
    }
    return oneQuestion(
      lang,
      'Are you arriving by car and do you need overnight parking?',
      'Вы на машине, и нужна парковка на ночь?',
      '¿Vienes en coche y necesitas estacionamiento nocturno?',
    );
  }

  if (cat === 'payment_confirmation') {
    return oneQuestion(
      lang,
      'Can you share the amount and a receipt/screenshot so we can verify?',
      'Пришлите сумму и чек/скрин, чтобы мы могли сверить.',
      '¿Puedes enviar el importe y un recibo/captura para verificar?',
    );
  }

  // Known operational categories should never fall back to generic “more details”.
  // If we somehow land here, ask property (single question).
  if (missing.includes('property')) {
    return oneQuestion(lang, 'Which property is this for?', 'Для какого это объекта?', '¿Para qué propiedad es?');
  }
  return oneQuestion(lang, 'Which property is this for?', 'Для какого это объекта?', '¿Para qué propiedad es?');
}

function replyTextForCategory(input: ReplyComposerInput): { template_key: string; text: string } {
  const lang = normalizeLang(input.lang, input.text);
  const cat = input.category;

  if (input.action === 'clarify') {
    const q = clarifyPrompt(input);
    const t = lang === 'ru'
      ? `Понял. ${q}`
      : lang === 'es'
        ? `Entendido. ${q}`
        : `Understood. ${q}`;
    return { template_key: `${cat}.clarify.q1`, text: `${t}${matchedContextSuffix(input, lang)}` };
  }

  if (input.action === 'escalate_operator') {
    return {
      template_key: `${cat}.escalate_operator.v1`,
      text: `${ack(lang)} ${escalateNow(lang, false)}${matchedContextSuffix(input, lang)}`,
    };
  }

  if (input.action === 'escalate_urgent') {
    const k = extractPropertyKnowledge(input);
    let opsAppend = '';
    if (k) {
      if (cat === 'access_issue') {
        const snip = accessSnippet(k);
        if (snip) opsAppend = lang === 'ru' ? ` [доступ: ${snip}]` : ` [access: ${snip}]`;
      } else if (cat === 'no_heating') {
        const snip = heatingSnippet(k);
        if (snip) opsAppend = lang === 'ru' ? ` [отопление: ${snip}]` : ` [heating: ${snip}]`;
      } else if (cat === 'no_hot_water') {
        const em = shortTrim(k.emergency_contact_notes, 120);
        if (em) opsAppend = lang === 'ru' ? ` [экстренный контакт: ${em}]` : ` [emergency: ${em}]`;
      }
    }
    return {
      template_key: `${cat}.escalate_urgent.v1`,
      text: `${ack(lang)} ${escalateNow(lang, true)}${matchedContextSuffix(input, lang)}${opsAppend}`,
    };
  }

  // action === 'reply'
  if (cat === 'access_issue') {
    const v = pickVariant(input.update_id, [
      shortHoldSentence(lang, 'the access issue', 'проблему с доступом', 'el problema de acceso'),
      shortHoldSentence(lang, 'access now', 'доступ сейчас', 'el acceso ahora'),
    ]);
    return {
      template_key: `${cat}.reply.v${input.update_id % 2 === 0 ? 1 : 2}`,
      text: `${ack(lang)} ${v}${matchedContextSuffix(input, lang)}`,
    };
  }

  if (cat === 'late_checkout') {
    const k = extractPropertyKnowledge(input);
    const policy = k ? shortTrim(k.late_checkout_policy ?? null, 180) : null;
    if (policy) {
      if (lateCheckoutRequiresApproval(input)) {
        const approvalLine =
          lang === 'ru'
            ? 'По этой политике требуется согласование — я передаю запрос оператору.'
            : lang === 'es'
              ? 'Según esta política se requiere aprobación — lo escalo a un operador.'
              : 'This policy requires approval — I’m escalating to an operator.';
        return {
          template_key: `${cat}.reply.policy_requires_approval.v1`,
          text: `${ack(lang)} ${lang === 'ru' ? 'Политика позднего выезда' : lang === 'es' ? 'Política de late checkout' : 'Late checkout policy'}: ${policy}. ${approvalLine}${matchedContextSuffix(input, lang)}`,
        };
      }
      return {
        template_key: `${cat}.reply.grounded.v1`,
        text: `${ack(lang)} ${lang === 'ru' ? 'Политика позднего выезда' : lang === 'es' ? 'Política de late checkout' : 'Late checkout policy'}: ${policy}.${matchedContextSuffix(input, lang)}`,
      };
    }
    const v = pickVariant(input.update_id, [
      shortHoldSentence(lang, 'late checkout availability', 'возможность позднего выезда', 'la disponibilidad de late checkout'),
      shortHoldSentence(lang, 'a late checkout option', 'вариант позднего выезда', 'la opción de late checkout'),
    ]);
    return { template_key: `${cat}.reply.v${input.update_id % 2 === 0 ? 1 : 2}`, text: `${ack(lang)} ${v}` };
  }

  if (cat === 'early_checkin') {
    const k = extractPropertyKnowledge(input);
    const policy = k ? shortTrim(k.early_checkin_policy ?? null, 180) : null;
    if (policy) {
      return {
        template_key: `${cat}.reply.grounded.v1`,
        text: `${ack(lang)} ${lang === 'ru' ? 'Политика раннего заезда' : lang === 'es' ? 'Política de early check-in' : 'Early check-in policy'}: ${policy}.${matchedContextSuffix(input, lang)}`,
      };
    }
    const v = pickVariant(input.update_id, [
      shortHoldSentence(lang, 'early check-in availability', 'возможность раннего заезда', 'la disponibilidad de early check-in'),
      shortHoldSentence(lang, 'an early check-in option', 'вариант раннего заезда', 'la opción de early check-in'),
    ]);
    return { template_key: `${cat}.reply.v${input.update_id % 2 === 0 ? 1 : 2}`, text: `${ack(lang)} ${v}` };
  }

  if (cat === 'no_heating') {
    const v = pickVariant(input.update_id, [
      shortHoldSentence(lang, 'the heating issue', 'проблему с отоплением', 'el problema de calefacción'),
      shortHoldSentence(lang, 'heating now', 'отопление', 'la calefacción'),
    ]);
    return { template_key: `${cat}.reply.v${input.update_id % 2 === 0 ? 1 : 2}`, text: `${ack(lang)} ${v}` };
  }

  if (cat === 'no_hot_water') {
    const v = pickVariant(input.update_id, [
      shortHoldSentence(lang, 'the hot water issue', 'проблему с горячей водой', 'el problema de agua caliente'),
      shortHoldSentence(lang, 'hot water now', 'горячую воду', 'el agua caliente'),
    ]);
    return { template_key: `${cat}.reply.v${input.update_id % 2 === 0 ? 1 : 2}`, text: `${ack(lang)} ${v}` };
  }

  if (cat === 'noise_complaint') {
    const v = pickVariant(input.update_id, [
      shortHoldSentence(lang, 'this noise complaint', 'эту жалобу на шум', 'esta queja por ruido'),
      shortHoldSentence(lang, 'the noise issue', 'проблему с шумом', 'el problema de ruido'),
    ]);
    return { template_key: `${cat}.reply.v${input.update_id % 2 === 0 ? 1 : 2}`, text: `${ack(lang)} ${v}` };
  }

  if (cat === 'cleaning_request') {
    const v = pickVariant(input.update_id, [
      shortHoldSentence(lang, 'housekeeping', 'уборку/сервис', 'la limpieza'),
      shortHoldSentence(lang, 'a cleaning request', 'запрос на уборку', 'la solicitud de limpieza'),
    ]);
    return { template_key: `${cat}.reply.v${input.update_id % 2 === 0 ? 1 : 2}`, text: `${ack(lang)} ${v}` };
  }

  if (cat === 'extension_request') {
    const v = pickVariant(input.update_id, [
      shortHoldSentence(lang, 'an extension', 'продление', 'una extensión'),
      shortHoldSentence(lang, 'availability for an extension', 'доступность продления', 'disponibilidad para extensión'),
    ]);
    return { template_key: `${cat}.reply.v${input.update_id % 2 === 0 ? 1 : 2}`, text: `${ack(lang)} ${v}` };
  }

  if (cat === 'wifi_issue') {
    const hasMatchedProp = Boolean((input.extractedFacts as any)?.matched_property_id || (input.extractedFacts as any)?.matched_property_label);
    const k = extractPropertyKnowledge(input);
    const wifiInfo = k ? wifiSnippet(k) : null;
    if (wifiInfo) {
      const label = (input.extractedFacts as any)?.matched_property_label ?? (input.extractedFacts as any)?.property_hint ?? '';
      const base =
        lang === 'ru'
          ? `Wi‑Fi${label ? ` для ${label}` : ''}: ${wifiInfo}.`
          : lang === 'es'
            ? `Wi‑Fi${label ? ` para ${label}` : ''}: ${wifiInfo}.`
            : `Wi‑Fi${label ? ` for ${label}` : ''}: ${wifiInfo}.`;
      const followUp =
        lang === 'ru'
          ? ' Если всё ещё не работает — уточните: нет сети, не подключается или пароль не подходит?'
          : lang === 'es'
            ? ' Si aún no funciona: ¿no hay red, no conecta o la contraseña no funciona?'
            : ' If it still fails: no network, can’t connect, or password not working?';
      return {
        template_key: `${cat}.reply.grounded.v1`,
        text: `${ack(lang)} ${base}${followUp}`,
      };
    }
    const v = hasMatchedProp
      ? (lang === 'ru'
          ? 'Проверю Wi‑Fi по этому объекту и вернусь с обновлением.'
          : lang === 'es'
            ? 'Revisaré el Wi‑Fi de esa propiedad y te confirmo.'
            : 'I’ll check the Wi‑Fi for this property and confirm shortly.')
      : pickVariant(input.update_id, [
          lang === 'ru'
            ? 'Пожалуйста, пришлите объект, и я проверю данные по Wi‑Fi.'
            : lang === 'es'
              ? 'Envíame la propiedad y reviso los datos de Wi‑Fi.'
              : 'Please send the property and I’ll check the Wi‑Fi details.',
          lang === 'ru'
            ? 'Пришлите объект — проверю сеть и пароль Wi‑Fi.'
            : lang === 'es'
              ? 'Envíame la propiedad y reviso la red y la contraseña de Wi‑Fi.'
              : 'Send the property and I’ll confirm the Wi‑Fi network and password.',
        ]);
    return {
      template_key: `${cat}.reply.v${input.update_id % 2 === 0 ? 1 : 2}`,
      text: `${ack(lang)} ${v}${matchedContextSuffix(input, lang)}`,
    };
  }

  if (cat === 'parking_question') {
    const k = extractPropertyKnowledge(input);
    const parkInfo = k ? parkingSnippet(k) : null;
    if (parkInfo) {
      const label = (input.extractedFacts as any)?.matched_property_label ?? (input.extractedFacts as any)?.property_hint ?? '';
      const base =
        lang === 'ru'
          ? `Парковка${label ? ` (${label})` : ''}: ${parkInfo}.`
          : lang === 'es'
            ? `Estacionamiento${label ? ` (${label})` : ''}: ${parkInfo}.`
            : `Parking${label ? ` (${label})` : ''}: ${parkInfo}.`;
      return {
        template_key: `${cat}.reply.grounded.v1`,
        text: `${ack(lang)} ${base}`,
      };
    }
    const v = pickVariant(input.update_id, [
      lang === 'ru'
        ? 'Уточню правила парковки для этого адреса и вернусь с инструкцией.'
        : lang === 'es'
          ? 'Revisaré las opciones de estacionamiento para esa dirección y te confirmo.'
          : 'I’ll confirm the parking options for that address and send the instructions.',
      lang === 'ru'
        ? 'Проверю, где можно парковаться рядом (платно/бесплатно), и вернусь с ответом.'
        : lang === 'es'
          ? 'Revisaré dónde se puede aparcar cerca (gratis/de pago) y te confirmo.'
          : 'I’ll check where you can park nearby (paid/free) and confirm.',
    ]);
    return { template_key: `${cat}.reply.v${input.update_id % 2 === 0 ? 1 : 2}`, text: `${ack(lang)} ${v}` };
  }

  if (cat === 'payment_confirmation') {
    const v = pickVariant(input.update_id, [
      lang === 'ru'
        ? 'Спасибо — передаю подтверждение оплаты в команду для сверки.'
        : lang === 'es'
          ? 'Gracias — paso la confirmación de pago al equipo para verificar.'
          : 'Thanks — I’m passing the payment confirmation to the team to verify.',
      lang === 'ru'
        ? 'Понял. Передаю в команду для проверки оплаты; если есть чек/скрин — пришлите.'
        : lang === 'es'
          ? 'Entendido. Lo paso al equipo para verificar; si tienes recibo/captura, envíalo.'
          : 'Understood. I’m sending this to the team to verify; if you have a receipt/screenshot, please share it.',
    ]);
    // v2 already includes its own ack sometimes; keep it short and avoid duplication.
    const text = v.startsWith('Понял') || v.startsWith('Understood') || v.startsWith('Entendido') ? v : `${ack(lang)} ${v}`;
    return { template_key: `${cat}.reply.v${input.update_id % 2 === 0 ? 1 : 2}`, text };
  }

  // Should not happen for the requested categories, but keep it safe and short.
  return { template_key: `${cat}.reply.v1`, text: `${ack(lang)} ${shortHoldSentence(lang, 'this', 'это', 'esto')}` };
}

function enforceTelegramStyle(text: string): string {
  let t = String(text ?? '').trim();
  t = t.replace(/\s+/g, ' ');
  // Hard cap: keep it short (Telegram). Avoid multi-paragraph dumps.
  if (t.length > 240) t = `${t.slice(0, 237).trim()}…`;
  return t;
}

export function composeTelegramOperationalReply(input: ReplyComposerInput): ReplyComposerOutput {
  const language = normalizeLang(input.lang, input.text);
  const { template_key, text } = replyTextForCategory({ ...input, lang: language });
  const out: ReplyComposerOutput = { text: enforceTelegramStyle(text), template_key, language };

  try {
    console.log(
      JSON.stringify({
        route: 'reply_composer',
        category: input.category,
        action: input.action,
        language,
        template_key,
        update_id: input.update_id,
      }),
    );
  } catch {
    // never throw from logging
  }

  return out;
}

