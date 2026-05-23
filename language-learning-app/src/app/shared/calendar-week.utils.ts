import { getStripeCountryCode } from '../data/stripe-supported-countries';

/** JavaScript Date.getDay(): 0 = Sunday … 6 = Saturday */
export type CalendarWeekStartDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const DEFAULT_CALENDAR_WEEK_STARTS_ON: CalendarWeekStartDay = 0;

export interface CalendarWeekStartDetectionInput {
  residenceCountry?: string | null;
  country?: string | null;
  interfaceLanguage?: string | null;
  browserLocales?: readonly string[];
}

/** Google Calendar–style week-start choices shown in settings UI */
export const CALENDAR_WEEK_START_UI_OPTIONS: ReadonlyArray<{
  value: CalendarWeekStartDay;
  labelKey: string;
}> = [
  { value: 0, labelKey: 'TUTOR_CALENDAR.WEEK_START_SUNDAY' },
  { value: 1, labelKey: 'TUTOR_CALENDAR.WEEK_START_MONDAY' },
  { value: 6, labelKey: 'TUTOR_CALENDAR.WEEK_START_SATURDAY' },
];

export function normalizeCalendarWeekStartsOn(value: unknown): CalendarWeekStartDay {
  const n = typeof value === 'string' ? parseInt(value, 10) : value;
  if (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 6) {
    return n as CalendarWeekStartDay;
  }
  return DEFAULT_CALENDAR_WEEK_STARTS_ON;
}

/** Start of the calendar week containing `date`, aligned to `weekStartsOn`. */
export function getStartOfCalendarWeek(
  date: Date,
  weekStartsOn: CalendarWeekStartDay = DEFAULT_CALENDAR_WEEK_STARTS_ON,
): Date {
  const normalized = normalizeCalendarWeekStartsOn(weekStartsOn);
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = (day - normalized + 7) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoWeekdayToCalendarWeekStart(isoDay: number): CalendarWeekStartDay | null {
  if (isoDay === 7) {
    return 0;
  }
  if (isoDay >= 1 && isoDay <= 6) {
    return isoDay as CalendarWeekStartDay;
  }
  return null;
}

function readIntlWeekStart(localeTag: string): CalendarWeekStartDay | null {
  try {
    const LocaleCtor = (Intl as { Locale?: new (tag: string, opts?: { region?: string }) => IntlLocaleLike }).Locale;
    if (!LocaleCtor) {
      return null;
    }
    const locale = new LocaleCtor(localeTag);
    const weekInfo = locale.getWeekInfo?.() ?? locale.weekInfo;
    const firstDay = weekInfo?.firstDay;
    if (typeof firstDay === 'number') {
      return isoWeekdayToCalendarWeekStart(firstDay);
    }
  } catch {
    // ignore invalid locale tags
  }
  return null;
}

interface IntlLocaleLike {
  getWeekInfo?: () => { firstDay?: number };
  weekInfo?: { firstDay?: number };
}

function getWeekStartFromRegion(regionCode: string): CalendarWeekStartDay | null {
  try {
    const LocaleCtor = (Intl as { Locale?: new (tag: string, opts?: { region?: string }) => IntlLocaleLike }).Locale;
    if (!LocaleCtor) {
      return null;
    }
    const locale = new LocaleCtor('en', { region: regionCode.toUpperCase() });
    const weekInfo = locale.getWeekInfo?.() ?? locale.weekInfo;
    const firstDay = weekInfo?.firstDay;
    if (typeof firstDay === 'number') {
      return isoWeekdayToCalendarWeekStart(firstDay);
    }
  } catch {
    // ignore
  }
  return null;
}

function collectBrowserLocales(explicit?: readonly string[]): string[] {
  const out: string[] = [];
  const push = (tag?: string | null) => {
    if (tag && !out.includes(tag)) {
      out.push(tag);
    }
  };

  if (explicit?.length) {
    explicit.forEach(push);
  }

  if (typeof navigator !== 'undefined') {
    if (navigator.languages?.length) {
      navigator.languages.forEach(push);
    }
    push(navigator.language);
  }

  return out;
}

/**
 * Infer the calendar week start from residence/country (CLDR region data), then
 * interface language, then browser locale(s). Matches Google Calendar / ISO norms:
 * most of Europe → Monday; US/Canada/Philippines/Japan/Israel → Sunday; parts of
 * Middle East → Saturday.
 */
export function detectCalendarWeekStartsOn(
  input: CalendarWeekStartDetectionInput = {},
): CalendarWeekStartDay {
  const regionCode =
    getStripeCountryCode(input.residenceCountry) ||
    getStripeCountryCode(input.country);

  if (regionCode) {
    const fromRegion = getWeekStartFromRegion(regionCode);
    if (fromRegion !== null) {
      return fromRegion;
    }
  }

  const localeCandidates = [
    input.interfaceLanguage,
    ...collectBrowserLocales(input.browserLocales),
  ].filter(Boolean) as string[];

  for (const tag of localeCandidates) {
    const fromLocale = readIntlWeekStart(tag);
    if (fromLocale !== null) {
      return fromLocale;
    }
  }

  return DEFAULT_CALENDAR_WEEK_STARTS_ON;
}
