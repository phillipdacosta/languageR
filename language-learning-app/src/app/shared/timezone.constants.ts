/**
 * Comprehensive list of IANA timezones organized by region
 */

export interface TimezoneOption {
  value: string; // IANA timezone identifier
  label: string; // Display name
  offset: string; // Current offset (e.g., "UTC-5")
  region: string; // Geographic region
}

export const TIMEZONE_REGIONS = {
  AMERICAS: 'Americas',
  EUROPE: 'Europe',
  ASIA: 'Asia',
  AFRICA: 'Africa',
  AUSTRALIA_PACIFIC: 'Australia & Pacific'
} as const;

/**
 * Get current UTC offset for a timezone
 * @param timezone IANA timezone identifier
 * @returns Offset string like "UTC-5" or "UTC+1"
 */
export function getTimezoneOffset(timezone: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset'
    });
    
    const parts = formatter.formatToParts(now);
    const offsetPart = parts.find(part => part.type === 'timeZoneName');
    
    if (offsetPart?.value) {
      return offsetPart.value.replace('GMT', 'UTC');
    }
    
    // Fallback: calculate offset manually
    const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const offset = (tzDate.getTime() - utcDate.getTime()) / (1000 * 60 * 60);
    
    if (offset === 0) return 'UTC';
    const sign = offset > 0 ? '+' : '';
    return `UTC${sign}${offset}`;
  } catch {
    return 'UTC';
  }
}

/**
 * Major timezones organized by region
 */
export const TIMEZONES: TimezoneOption[] = [
  // Americas
  { value: 'America/New_York', label: 'New York (Eastern Time)', offset: '', region: TIMEZONE_REGIONS.AMERICAS },
  { value: 'America/Chicago', label: 'Chicago (Central Time)', offset: '', region: TIMEZONE_REGIONS.AMERICAS },
  { value: 'America/Denver', label: 'Denver (Mountain Time)', offset: '', region: TIMEZONE_REGIONS.AMERICAS },
  { value: 'America/Phoenix', label: 'Phoenix (MST, no DST)', offset: '', region: TIMEZONE_REGIONS.AMERICAS },
  { value: 'America/Los_Angeles', label: 'Los Angeles (Pacific Time)', offset: '', region: TIMEZONE_REGIONS.AMERICAS },
  { value: 'America/Anchorage', label: 'Anchorage (Alaska Time)', offset: '', region: TIMEZONE_REGIONS.AMERICAS },
  { value: 'Pacific/Honolulu', label: 'Honolulu (Hawaii Time)', offset: '', region: TIMEZONE_REGIONS.AMERICAS },
  { value: 'America/Toronto', label: 'Toronto', offset: '', region: TIMEZONE_REGIONS.AMERICAS },
  { value: 'America/Vancouver', label: 'Vancouver', offset: '', region: TIMEZONE_REGIONS.AMERICAS },
  { value: 'America/Mexico_City', label: 'Mexico City', offset: '', region: TIMEZONE_REGIONS.AMERICAS },
  { value: 'America/Bogota', label: 'Bogotá', offset: '', region: TIMEZONE_REGIONS.AMERICAS },
  { value: 'America/Lima', label: 'Lima', offset: '', region: TIMEZONE_REGIONS.AMERICAS },
  { value: 'America/Santiago', label: 'Santiago', offset: '', region: TIMEZONE_REGIONS.AMERICAS },
  { value: 'America/Sao_Paulo', label: 'São Paulo', offset: '', region: TIMEZONE_REGIONS.AMERICAS },
  { value: 'America/Buenos_Aires', label: 'Buenos Aires', offset: '', region: TIMEZONE_REGIONS.AMERICAS },
  
  // Europe
  { value: 'Europe/London', label: 'London', offset: '', region: TIMEZONE_REGIONS.EUROPE },
  { value: 'Europe/Dublin', label: 'Dublin', offset: '', region: TIMEZONE_REGIONS.EUROPE },
  { value: 'Europe/Lisbon', label: 'Lisbon', offset: '', region: TIMEZONE_REGIONS.EUROPE },
  { value: 'Europe/Paris', label: 'Paris', offset: '', region: TIMEZONE_REGIONS.EUROPE },
  { value: 'Europe/Madrid', label: 'Madrid', offset: '', region: TIMEZONE_REGIONS.EUROPE },
  { value: 'Europe/Rome', label: 'Rome', offset: '', region: TIMEZONE_REGIONS.EUROPE },
  { value: 'Europe/Berlin', label: 'Berlin', offset: '', region: TIMEZONE_REGIONS.EUROPE },
  { value: 'Europe/Amsterdam', label: 'Amsterdam', offset: '', region: TIMEZONE_REGIONS.EUROPE },
  { value: 'Europe/Brussels', label: 'Brussels', offset: '', region: TIMEZONE_REGIONS.EUROPE },
  { value: 'Europe/Vienna', label: 'Vienna', offset: '', region: TIMEZONE_REGIONS.EUROPE },
  { value: 'Europe/Zurich', label: 'Zurich', offset: '', region: TIMEZONE_REGIONS.EUROPE },
  { value: 'Europe/Stockholm', label: 'Stockholm', offset: '', region: TIMEZONE_REGIONS.EUROPE },
  { value: 'Europe/Copenhagen', label: 'Copenhagen', offset: '', region: TIMEZONE_REGIONS.EUROPE },
  { value: 'Europe/Oslo', label: 'Oslo', offset: '', region: TIMEZONE_REGIONS.EUROPE },
  { value: 'Europe/Helsinki', label: 'Helsinki', offset: '', region: TIMEZONE_REGIONS.EUROPE },
  { value: 'Europe/Warsaw', label: 'Warsaw', offset: '', region: TIMEZONE_REGIONS.EUROPE },
  { value: 'Europe/Prague', label: 'Prague', offset: '', region: TIMEZONE_REGIONS.EUROPE },
  { value: 'Europe/Budapest', label: 'Budapest', offset: '', region: TIMEZONE_REGIONS.EUROPE },
  { value: 'Europe/Athens', label: 'Athens', offset: '', region: TIMEZONE_REGIONS.EUROPE },
  { value: 'Europe/Istanbul', label: 'Istanbul', offset: '', region: TIMEZONE_REGIONS.EUROPE },
  { value: 'Europe/Moscow', label: 'Moscow', offset: '', region: TIMEZONE_REGIONS.EUROPE },
  
  // Asia
  { value: 'Asia/Dubai', label: 'Dubai', offset: '', region: TIMEZONE_REGIONS.ASIA },
  { value: 'Asia/Karachi', label: 'Karachi', offset: '', region: TIMEZONE_REGIONS.ASIA },
  { value: 'Asia/Kolkata', label: 'Kolkata', offset: '', region: TIMEZONE_REGIONS.ASIA },
  { value: 'Asia/Dhaka', label: 'Dhaka', offset: '', region: TIMEZONE_REGIONS.ASIA },
  { value: 'Asia/Bangkok', label: 'Bangkok', offset: '', region: TIMEZONE_REGIONS.ASIA },
  { value: 'Asia/Singapore', label: 'Singapore', offset: '', region: TIMEZONE_REGIONS.ASIA },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong', offset: '', region: TIMEZONE_REGIONS.ASIA },
  { value: 'Asia/Shanghai', label: 'Shanghai', offset: '', region: TIMEZONE_REGIONS.ASIA },
  { value: 'Asia/Taipei', label: 'Taipei', offset: '', region: TIMEZONE_REGIONS.ASIA },
  { value: 'Asia/Tokyo', label: 'Tokyo', offset: '', region: TIMEZONE_REGIONS.ASIA },
  { value: 'Asia/Seoul', label: 'Seoul', offset: '', region: TIMEZONE_REGIONS.ASIA },
  { value: 'Asia/Manila', label: 'Manila', offset: '', region: TIMEZONE_REGIONS.ASIA },
  { value: 'Asia/Jakarta', label: 'Jakarta', offset: '', region: TIMEZONE_REGIONS.ASIA },
  { value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur', offset: '', region: TIMEZONE_REGIONS.ASIA },
  { value: 'Asia/Ho_Chi_Minh', label: 'Ho Chi Minh City', offset: '', region: TIMEZONE_REGIONS.ASIA },
  { value: 'Asia/Jerusalem', label: 'Jerusalem', offset: '', region: TIMEZONE_REGIONS.ASIA },
  { value: 'Asia/Riyadh', label: 'Riyadh', offset: '', region: TIMEZONE_REGIONS.ASIA },
  
  // Africa
  { value: 'Africa/Cairo', label: 'Cairo', offset: '', region: TIMEZONE_REGIONS.AFRICA },
  { value: 'Africa/Johannesburg', label: 'Johannesburg', offset: '', region: TIMEZONE_REGIONS.AFRICA },
  { value: 'Africa/Lagos', label: 'Lagos', offset: '', region: TIMEZONE_REGIONS.AFRICA },
  { value: 'Africa/Nairobi', label: 'Nairobi', offset: '', region: TIMEZONE_REGIONS.AFRICA },
  { value: 'Africa/Casablanca', label: 'Casablanca', offset: '', region: TIMEZONE_REGIONS.AFRICA },
  { value: 'Africa/Algiers', label: 'Algiers', offset: '', region: TIMEZONE_REGIONS.AFRICA },
  
  // Australia & Pacific
  { value: 'Australia/Sydney', label: 'Sydney', offset: '', region: TIMEZONE_REGIONS.AUSTRALIA_PACIFIC },
  { value: 'Australia/Melbourne', label: 'Melbourne', offset: '', region: TIMEZONE_REGIONS.AUSTRALIA_PACIFIC },
  { value: 'Australia/Brisbane', label: 'Brisbane', offset: '', region: TIMEZONE_REGIONS.AUSTRALIA_PACIFIC },
  { value: 'Australia/Perth', label: 'Perth', offset: '', region: TIMEZONE_REGIONS.AUSTRALIA_PACIFIC },
  { value: 'Australia/Adelaide', label: 'Adelaide', offset: '', region: TIMEZONE_REGIONS.AUSTRALIA_PACIFIC },
  { value: 'Pacific/Auckland', label: 'Auckland', offset: '', region: TIMEZONE_REGIONS.AUSTRALIA_PACIFIC },
  { value: 'Pacific/Fiji', label: 'Fiji', offset: '', region: TIMEZONE_REGIONS.AUSTRALIA_PACIFIC },
];

/**
 * Get timezones with current offsets populated
 */
export function getTimezonesWithOffsets(): TimezoneOption[] {
  return TIMEZONES.map(tz => ({
    ...tz,
    offset: getTimezoneOffset(tz.value)
  }));
}

/**
 * Get timezones grouped by region
 */
export function getTimezonesByRegion(): Record<string, TimezoneOption[]> {
  const withOffsets = getTimezonesWithOffsets();
  const grouped: Record<string, TimezoneOption[]> = {};
  
  withOffsets.forEach(tz => {
    if (!grouped[tz.region]) {
      grouped[tz.region] = [];
    }
    grouped[tz.region].push(tz);
  });
  
  return grouped;
}

/**
 * Detect user's current timezone
 */
export function detectUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/**
 * Find timezone option by value
 */
export function findTimezone(timezoneValue: string): TimezoneOption | undefined {
  return TIMEZONES.find(tz => tz.value === timezoneValue);
}


