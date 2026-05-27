/**
 * Timezone conversion utilities using date-fns-tz for reliable conversions.
 */
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

/**
 * Global hour12 preference. Updated by UserService when the user profile loads
 * or the setting changes. All formatTimeInTz calls respect this unless the
 * caller explicitly overrides hour12.
 */
let _globalHour12: boolean = true;

export function setGlobalTimeFormat(format: '12h' | '24h') {
  _globalHour12 = format === '12h';
}

export function getGlobalHour12(): boolean {
  return _globalHour12;
}

/**
 * True when a tutor has at least one bookable availability block in the future.
 * Used for home-page "Set availability" vs "View calendar" and related CTAs.
 *
 * - Ignores class blocks (synced from scheduled classes, not open availability).
 * - Ignores unavailable/break blocks.
 * - Requires absoluteEnd or absoluteStart in the future (no blind "recurring = true").
 */
export function hasFutureTutorAvailability(
  blocks: any[] | null | undefined,
  now: Date = new Date()
): boolean {
  if (!blocks?.length) {
    return false;
  }
  const nowMs = now.getTime();
  return blocks.some(block => {
    if (!block) {
      return false;
    }
    if (block.type === 'class' || block.type === 'unavailable' || block.type === 'break') {
      return false;
    }
    if (block.type && block.type !== 'available') {
      return false;
    }
    if (block.absoluteEnd) {
      return new Date(block.absoluteEnd).getTime() > nowMs;
    }
    if (block.absoluteStart) {
      return new Date(block.absoluteStart).getTime() > nowMs;
    }
    return false;
  });
}

/**
 * Convert a wall-clock time (HH:mm on YYYY-MM-DD) from one IANA timezone to another.
 * Uses date-fns-tz for correct DST-aware conversion.
 */
export function convertTimeToTimezone(
  dateStr: string,
  timeStr: string,
  fromTimezone: string,
  toTimezone: string
): { date: string; time: string; dateTime: Date; dayOfWeek: number } {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);

  if (fromTimezone === toTimezone) {
    const dt = new Date(year, month - 1, day, hours, minutes, 0, 0);
    return { date: dateStr, time: timeStr, dateTime: dt, dayOfWeek: dt.getDay() };
  }

  try {
    const wallClock = new Date(year, month - 1, day, hours, minutes, 0, 0);
    const utcInstant = fromZonedTime(wallClock, fromTimezone);
    const target = toZonedTime(utcInstant, toTimezone);

    const outYear = target.getFullYear();
    const outMonth = target.getMonth() + 1;
    const outDay = target.getDate();
    const outHours = target.getHours();
    const outMinutes = target.getMinutes();

    return {
      date: `${outYear}-${String(outMonth).padStart(2, '0')}-${String(outDay).padStart(2, '0')}`,
      time: `${String(outHours).padStart(2, '0')}:${String(outMinutes).padStart(2, '0')}`,
      dateTime: target,
      dayOfWeek: target.getDay()
    };
  } catch (error) {
    console.error('Error converting timezone:', error);
    const dt = new Date(year, month - 1, day, hours, minutes, 0, 0);
    return { date: dateStr, time: timeStr, dateTime: dt, dayOfWeek: dt.getDay() };
  }
}

/**
 * Convert a wall-clock time in a specific timezone to a UTC Date.
 */
export function wallClockToUtc(dateStr: string, timeStr: string, timezone: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);
  const wallClock = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return fromZonedTime(wallClock, timezone);
}

/**
 * Convert a UTC Date to wall-clock components in a specific timezone.
 */
export function utcToWallClock(
  utcDate: Date,
  timezone: string
): { date: string; time: string; dayOfWeek: number; hours: number; minutes: number } {
  const zoned = toZonedTime(utcDate, timezone);
  const y = zoned.getFullYear();
  const m = zoned.getMonth() + 1;
  const d = zoned.getDate();
  const h = zoned.getHours();
  const min = zoned.getMinutes();
  return {
    date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    time: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    dayOfWeek: zoned.getDay(),
    hours: h,
    minutes: min
  };
}

/**
 * Format a time string (HH:mm) according to the global preference (12h or 24h).
 */
export function formatTime12Hour(timeStr: string): string {
  try {
    const [hours, minutes] = timeStr.split(':').map(Number);
    if (!_globalHour12) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`;
  } catch {
    return timeStr;
  }
}

/**
 * Get a human-readable timezone label
 * @param timezone IANA timezone identifier
 * @returns Formatted label like "New York (UTC-5)"
 */
export function getTimezoneLabel(timezone: string): string {
  try {
    const now = new Date();
    
    // Get offset
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset'
    });
    
    const parts = formatter.formatToParts(now);
    const offsetPart = parts.find(part => part.type === 'timeZoneName');
    const offset = offsetPart?.value.replace('GMT', 'UTC') || 'UTC';
    
    // Get city name from timezone
    const city = timezone.split('/').pop()?.replace(/_/g, ' ') || timezone;
    
    return `${city} (${offset})`;
  } catch {
    return timezone;
  }
}

/**
 * Format a UTC Date as a time string (e.g., "2:30 PM") in the given timezone.
 * Falls back to browser timezone if none provided.
 * @param locale BCP 47 locale (e.g. 'en', 'fr', 'de') for localized output; defaults to 'en-US'.
 * @param hour12 Explicit override. When omitted, uses the global user preference set via setGlobalTimeFormat().
 */
export function formatTimeInTz(date: Date | string, timezone?: string, locale?: string, hour12?: boolean): string {
  const h12 = hour12 !== undefined ? hour12 : _globalHour12;
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '';
    const loc = toIntlLocale(locale);
    const tzOpts: Intl.DateTimeFormatOptions = timezone ? { timeZone: timezone } : {};

    if (!h12) {
      // 24h: HH:mm, no AM/PM
      return d.toLocaleTimeString(loc, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        ...tzOpts,
      });
    }

    // 12h: always include AM/PM (some locales omit dayPeriod with hour: 'numeric')
    const formatter = new Intl.DateTimeFormat(loc, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      ...tzOpts,
    });
    const parts = formatter.formatToParts(d);
    const hour = parts.find(p => p.type === 'hour')?.value ?? '';
    const minute = parts.find(p => p.type === 'minute')?.value ?? '';
    const dayPeriod = parts.find(p => p.type === 'dayPeriod')?.value?.trim() ?? '';
    if (dayPeriod) {
      return `${hour}:${minute} ${dayPeriod}`;
    }
    return formatter.format(d);
  } catch {
    return '';
  }
}

/**
 * Format a UTC Date as a date string (e.g., "Feb 23, 2026") in the given timezone.
 * Falls back to browser timezone if none provided.
 * @param locale BCP 47 locale (e.g. 'en', 'fr', 'de') for localized output; defaults to 'en-US'.
 */
export function formatDateInTz(
  date: Date | string,
  timezone?: string,
  options?: Intl.DateTimeFormatOptions,
  locale?: string
): string {
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '';
    const loc = toIntlLocale(locale);
    const defaults: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      ...(timezone ? { timeZone: timezone } : {})
    };
    return d.toLocaleDateString(loc, { ...defaults, ...options });
  } catch {
    return '';
  }
}

/**
 * Format a UTC Date as a time range (e.g., "2:30 PM – 3:00 PM") in the given timezone.
 * @param locale BCP 47 locale for localized output.
 */
export function formatTimeRangeInTz(
  start: Date | string,
  end: Date | string,
  timezone?: string,
  locale?: string,
  hour12?: boolean
): string {
  return `${formatTimeInTz(start, timezone, locale, hour12)} – ${formatTimeInTz(end, timezone, locale, hour12)}`;
}

/** Normalize short app locale codes for Intl (e.g. ngx-translate `es` → `es`). */
export function toIntlLocale(locale?: string): string {
  const raw = (locale || 'en').trim();
  if (!raw) return 'en-US';
  if (raw.includes('-')) return raw;
  const map: Record<string, string> = {
    en: 'en-US',
    pt: 'pt-BR',
    zh: 'zh-CN',
    no: 'nb-NO',
    he: 'he-IL',
    fa: 'fa-IR',
    ar: 'ar',
  };
  return map[raw] || raw;
}

/**
 * Get the hour (0-23) of a Date in a given timezone.
 * Falls back to local getHours() if no timezone provided.
 */
export function getHoursInTz(date: Date, timezone?: string): number {
  if (!timezone) return date.getHours();
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }).formatToParts(date);
    const hourPart = parts.find(p => p.type === 'hour');
    const h = parseInt(hourPart?.value || '0', 10);
    return h === 24 ? 0 : h;
  } catch {
    return date.getHours();
  }
}

/**
 * Get the minute (0-59) of a Date in a given timezone.
 * Falls back to local getMinutes() if no timezone provided.
 */
export function getMinutesInTz(date: Date, timezone?: string): number {
  if (!timezone) return date.getMinutes();
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, minute: 'numeric' }).formatToParts(date);
    const minPart = parts.find(p => p.type === 'minute');
    return parseInt(minPart?.value || '0', 10);
  } catch {
    return date.getMinutes();
  }
}

/**
 * Check if two dates are on the same day in a given timezone.
 */
export function isSameDayInTimezone(date1: Date, date2: Date, timezone: string): boolean {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(date1) === formatter.format(date2);
  } catch {
    return date1.toDateString() === date2.toDateString();
  }
}


