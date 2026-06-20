/** Resolve IANA timezone for a property with safe fallback. */

export const DEFAULT_PROPERTY_TIMEZONE = 'Europe/Moscow';

export type PropertyTimezoneResolution = {
  timezone: string;
  timezoneSource: 'property' | 'fallback';
};

export function resolvePropertyTimezone(propertyTimezone?: string | null): PropertyTimezoneResolution {
  const raw = String(propertyTimezone ?? '').trim();
  if (raw && isValidIanaTimezone(raw)) {
    return { timezone: raw, timezoneSource: 'property' };
  }
  return { timezone: DEFAULT_PROPERTY_TIMEZONE, timezoneSource: 'fallback' };
}

export function isValidIanaTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type LocalTimeParts = {
  hours: number;
  minutes: number;
};

export function getLocalTimeParts(timezone: string, now = new Date()): LocalTimeParts {
  const resolved = resolvePropertyTimezone(timezone);
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: resolved.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return { hours: hour, minutes: minute };
  } catch {
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    return { hours: utcHours + 3, minutes: utcMinutes };
  }
}

export function minutesSinceMidnight(parts: LocalTimeParts): number {
  return parts.hours * 60 + parts.minutes;
}

export function isWithinNightWindow(
  localParts: LocalTimeParts,
  nightStart: string,
  nightEnd: string,
): boolean {
  const start = parseClock(nightStart) ?? 22 * 60;
  const end = parseClock(nightEnd) ?? 8 * 60;
  const now = minutesSinceMidnight(localParts);

  if (start === end) return false;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}

function parseClock(value: string): number | null {
  const m = String(value ?? '').trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
