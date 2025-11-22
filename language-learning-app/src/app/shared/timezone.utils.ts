/**
 * Timezone conversion utilities
 * Handles converting times between different timezones
 */

/**
 * Convert a time string (HH:mm) on a specific date from one timezone to another
 * @param dateStr Date string in YYYY-MM-DD format
 * @param timeStr Time string in HH:mm format (24-hour)
 * @param fromTimezone Source timezone (IANA identifier)
 * @param toTimezone Target timezone (IANA identifier)
 * @returns Object with converted date and time
 */
export function convertTimeToTimezone(
  dateStr: string,
  timeStr: string,
  fromTimezone: string,
  toTimezone: string
): { date: string; time: string; dateTime: Date } {
  try {
    // Parse the date and time
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes] = timeStr.split(':').map(Number);
    
    // Create a date string in the source timezone
    // Format: "2024-01-15 14:30" -> needs to be interpreted in fromTimezone
    const dateTimeStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
    
    // Parse as if in fromTimezone
    const sourceDate = new Date(dateTimeStr);
    
    // Get the offset difference between timezones
    const sourceFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: fromTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    const targetFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: toTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    // Create a Date object representing the time in UTC
    // We'll use a reference date to calculate the offset
    const refDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
    
    // Format the reference date in both timezones
    const sourceParts = sourceFormatter.formatToParts(refDate);
    const targetParts = targetFormatter.formatToParts(refDate);
    
    // Extract values
    const getPartValue = (parts: Intl.DateTimeFormatPart[], type: string) => {
      return parts.find(p => p.type === type)?.value || '0';
    };
    
    const targetYear = parseInt(getPartValue(targetParts, 'year'));
    const targetMonth = parseInt(getPartValue(targetParts, 'month'));
    const targetDay = parseInt(getPartValue(targetParts, 'day'));
    const targetHour = parseInt(getPartValue(targetParts, 'hour'));
    const targetMinute = parseInt(getPartValue(targetParts, 'minute'));
    
    // Create the converted date
    const convertedDate = new Date(targetYear, targetMonth - 1, targetDay, targetHour, targetMinute, 0);
    
    // Format output
    const outDate = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
    const outTime = `${String(targetHour).padStart(2, '0')}:${String(targetMinute).padStart(2, '0')}`;
    
    return {
      date: outDate,
      time: outTime,
      dateTime: convertedDate
    };
  } catch (error) {
    console.error('Error converting timezone:', error);
    // Return original values on error
    return {
      date: dateStr,
      time: timeStr,
      dateTime: new Date()
    };
  }
}

/**
 * Simpler approach: Convert a Date object from one timezone to another
 * @param date Date object or ISO string
 * @param fromTimezone Source timezone
 * @param toTimezone Target timezone
 * @returns Date object in target timezone
 */
export function convertDateBetweenTimezones(
  date: Date | string,
  fromTimezone: string,
  toTimezone: string
): Date {
  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    
    // Get the time in the source timezone
    const sourceStr = dateObj.toLocaleString('en-US', { timeZone: fromTimezone });
    
    // Parse it back as if it were in the target timezone
    // This effectively "moves" the time to the target timezone
    const targetDate = new Date(sourceStr);
    
    return targetDate;
  } catch (error) {
    console.error('Error converting date between timezones:', error);
    return typeof date === 'string' ? new Date(date) : date;
  }
}

/**
 * Format a time in 12-hour format with AM/PM
 * @param timeStr Time string in HH:mm format (24-hour)
 * @returns Formatted time string like "2:30 PM"
 */
export function formatTime12Hour(timeStr: string): string {
  try {
    const [hours, minutes] = timeStr.split(':').map(Number);
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
 * Convert availability block times from tutor timezone to viewer timezone
 * @param blocks Availability blocks with startTime and endTime
 * @param date The date for which we're converting
 * @param fromTimezone Tutor's timezone
 * @param toTimezone Viewer's timezone
 * @returns Blocks with converted times
 */
export function convertAvailabilityBlocks(
  blocks: any[],
  date: Date,
  fromTimezone: string,
  toTimezone: string
): any[] {
  if (fromTimezone === toTimezone) {
    return blocks; // No conversion needed
  }
  
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  
  return blocks.map(block => {
    const startConverted = convertTimeToTimezone(dateStr, block.startTime, fromTimezone, toTimezone);
    const endConverted = convertTimeToTimezone(dateStr, block.endTime, fromTimezone, toTimezone);
    
    return {
      ...block,
      originalStartTime: block.startTime,
      originalEndTime: block.endTime,
      startTime: startConverted.time,
      endTime: endConverted.time,
      // Note: Date might change due to timezone conversion
      dateOffset: startConverted.date !== dateStr ? startConverted.date : undefined
    };
  });
}

/**
 * Check if two dates are on the same day in a given timezone
 * @param date1 First date
 * @param date2 Second date
 * @param timezone Timezone to compare in
 * @returns True if same day
 */
export function isSameDayInTimezone(date1: Date, date2: Date, timezone: string): boolean {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    
    const date1Str = formatter.format(date1);
    const date2Str = formatter.format(date2);
    
    return date1Str === date2Str;
  } catch {
    // Fallback to simple comparison
    return date1.toDateString() === date2.toDateString();
  }
}


