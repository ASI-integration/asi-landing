const ASI_BRAND_TOKEN = /(^|[\s([{"'«“])ASI(?=$|[\s)\]},!?;:'"»”]|[.](?:\s|$))/gi;
const RUSSIAN_TEXT = /[А-Яа-яЁё]/;
const RUSSIAN_EXACT_HOUR_RANGE = /\b([01]?\d|2[0-3]):00\s*[-–—]\s*([01]?\d|2[0-3]):00\b/g;
const RUSSIAN_EXACT_HOUR_WITH_PREPOSITION = /\b(после|до|около|с|к|в)\s+([01]?\d|2[0-3]):00\b/gi;
const RUSSIAN_EXACT_HOUR = /(^|[^\d:])([01]?\d|2[0-3]):00(?![\d:])/g;
const RUSSIAN_DOTTED_DATE = /\b(0?[1-9]|[12]\d|3[01])[.](0?[1-9]|1[0-2])[.]((?:19|20)\d{2})\b/g;

const RUSSIAN_MONTHS_GENITIVE = [
  '',
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

const RUSSIAN_HOUR_PLAIN = [
  'полночь',
  'час ночи',
  'два часа ночи',
  'три часа ночи',
  'четыре часа ночи',
  'пять утра',
  'шесть утра',
  'семь утра',
  'восемь утра',
  'девять утра',
  'десять утра',
  'одиннадцать утра',
  'полдень',
  'час дня',
  'два часа дня',
  'три часа дня',
  'четыре часа дня',
  'пять вечера',
  'шесть вечера',
  'семь вечера',
  'восемь вечера',
  'девять вечера',
  'десять вечера',
  'одиннадцать вечера',
] as const;

const RUSSIAN_HOUR_GENITIVE = [
  'полуночи',
  'часа ночи',
  'двух часов ночи',
  'трех часов ночи',
  'четырех часов ночи',
  'пяти утра',
  'шести утра',
  'семи утра',
  'восьми утра',
  'девяти утра',
  'десяти утра',
  'одиннадцати утра',
  'полудня',
  'часа дня',
  'двух часов дня',
  'трех часов дня',
  'четырех часов дня',
  'пяти вечера',
  'шести вечера',
  'семи вечера',
  'восьми вечера',
  'девяти вечера',
  'десяти вечера',
  'одиннадцати вечера',
] as const;

const RUSSIAN_HOUR_DATIVE = [
  'полуночи',
  'часу ночи',
  'двум часам ночи',
  'трем часам ночи',
  'четырем часам ночи',
  'пяти утра',
  'шести утра',
  'семи утра',
  'восьми утра',
  'девяти утра',
  'десяти утра',
  'одиннадцати утра',
  'полудню',
  'часу дня',
  'двум часам дня',
  'трем часам дня',
  'четырем часам дня',
  'пяти вечера',
  'шести вечера',
  'семи вечера',
  'восьми вечера',
  'девяти вечера',
  'десяти вечера',
  'одиннадцати вечера',
] as const;

type RussianHourForm = 'plain' | 'genitive' | 'dative';

function russianHourPhrase(hourText: string, form: RussianHourForm): string {
  const hour = Number(hourText);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return `${hourText}:00`;
  if (form === 'genitive') return RUSSIAN_HOUR_GENITIVE[hour];
  if (form === 'dative') return RUSSIAN_HOUR_DATIVE[hour];
  return RUSSIAN_HOUR_PLAIN[hour];
}

/**
 * Normalize only speech-sensitive tokens for Gemini Native Audio.
 *
 * This is deliberately conservative: it handles Russian exact-hour clock
 * values and dotted calendar dates, but leaves arbitrary numbers, PINs,
 * identifiers, URLs, and non-Russian text untouched. The visible Telegram
 * message is never changed; callers pass this transformed copy only to audio.
 */
export function normalizeSpeechTextForNativeAudio(text: string): string {
  let value = String(text ?? '');
  if (!RUSSIAN_TEXT.test(value)) return value;

  value = value.replace(RUSSIAN_DOTTED_DATE, (_match, day: string, month: string, year: string) => {
    const monthName = RUSSIAN_MONTHS_GENITIVE[Number(month)] ?? month;
    return `${Number(day)} ${monthName} ${year} года`;
  });

  value = value.replace(RUSSIAN_EXACT_HOUR_RANGE, (_match, startHour: string, endHour: string) => {
    return `с ${russianHourPhrase(startHour, 'genitive')} до ${russianHourPhrase(endHour, 'genitive')}`;
  });

  value = value.replace(
    RUSSIAN_EXACT_HOUR_WITH_PREPOSITION,
    (_match, preposition: string, hour: string) => {
      const normalizedPreposition = preposition.toLocaleLowerCase('ru-RU');
      const form: RussianHourForm =
        normalizedPreposition === 'в' ? 'plain' : normalizedPreposition === 'к' ? 'dative' : 'genitive';
      return `${preposition} ${russianHourPhrase(hour, form)}`;
    },
  );

  value = value.replace(RUSSIAN_EXACT_HOUR, (_match, prefix: string, hour: string) => {
    return `${prefix}${russianHourPhrase(hour, 'plain')}`;
  });

  return value;
}

/**
 * Normalize text only for conventional TTS synthesis.
 *
 * It shares the safe spoken-time/date normalization above, then additionally
 * rewrites the standalone ASI brand to the owner-selected English letter-name
 * pronunciation. The visible/user-facing text remains unchanged.
 */
export function normalizeSpeechTextForTts(text: string): string {
  return normalizeSpeechTextForNativeAudio(text).replace(
    ASI_BRAND_TOKEN,
    (_match, prefix: string) => `${prefix}Ay Ess Eye`,
  );
}
