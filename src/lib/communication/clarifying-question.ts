import { CommunicationDecision, Lang } from './types';

function q(lang: Lang, ru: string, en: string): { ru?: string; en: string } {
  return lang === 'ru' ? { ru, en } : { en };
}

/**
 * Pick ONE best next clarifying question.
 * Must target the most important missing fact and avoid generic filler.
 */
export function pickSingleBestClarifyingQuestion(input: {
  decision: CommunicationDecision;
  lang: Lang;
}): { ru?: string; en: string } | null {
  const missing = input.decision.missingFacts ?? [];

  // Ambiguous entity → ask to disambiguate reservation first.
  if (input.decision.entityResolution.status === 'ambiguous') {
    return q(
      input.lang,
      'Уточните, пожалуйста: о какой брони речь (номер/код брони или дата заезда + имя гостя)?',
      'Which reservation is this about (booking/reference number, or check-in date + guest name)?',
    );
  }

  if (missing.includes('reservation_or_property') || missing.includes('reservation')) {
    return q(
      input.lang,
      'Подскажите, пожалуйста: какой объект/адрес или номер брони?',
      'Which property/address or booking reference is this about?',
    );
  }

  if (missing.includes('property_or_area')) {
    return q(
      input.lang,
      'Какой объект/район вас интересует?',
      'Which property or area is this about?',
    );
  }

  if (missing.includes('dates')) {
    return q(
      input.lang,
      'На какие даты вам нужно (заезд и выезд)?',
      'What dates is this for (check-in and check-out)?',
    );
  }

  if (missing.includes('arrival_time')) {
    return q(
      input.lang,
      'Во сколько вы планируете приехать?',
      'What time will you arrive?',
    );
  }

  if (missing.includes('issue_detail')) {
    return q(
      input.lang,
      'Что именно произошло (кратко) и где именно?',
      'What exactly happened, and where is the issue?',
    );
  }

  if (missing.includes('reservation_or_dates_or_name')) {
    return q(
      input.lang,
      'Для чека/счёта уточните, пожалуйста: имя гостя и даты проживания (или номер брони).',
      'For the receipt/invoice, please share the guest name and stay dates (or a booking reference).',
    );
  }

  if (missing.includes('guest_name')) {
    return q(input.lang, 'Как имя гостя?', 'What is the guest name?');
  }

  if (missing.includes('check_in_date')) {
    return q(input.lang, 'Какая дата заезда?', 'What is the check-in date?');
  }

  // If nothing recognized, avoid asking a vague question.
  return null;
}

