import { Pipe, PipeTransform } from '@angular/core';
import { getHoursInTz, getMinutesInTz } from '../../shared/timezone.utils';

@Pipe({
  name: 'eventTime',
  standalone: true,
  pure: true
})
export class EventTimePipe implements PipeTransform {
  transform(event: any, timezone?: string, timeFormat?: '12h' | '24h'): string {
    if (!event?.start || !event?.end) return '';

    const startTime = new Date(event.start);
    const endTime = new Date(event.end);
    const durationMs = endTime.getTime() - startTime.getTime();
    const durationMinutes = Math.round(durationMs / (1000 * 60));

    const formattedTime = this.formatTime(startTime, timezone, timeFormat === '24h');
    return `${formattedTime} (${durationMinutes}min)`;
  }

  private formatTime(date: Date, timezone?: string, is24h: boolean = false): string {
    const hours = getHoursInTz(date, timezone);
    const minutes = getMinutesInTz(date, timezone);
    const minutesStr = minutes < 10 ? '0' + minutes : minutes.toString();
    if (is24h) {
      return `${hours.toString().padStart(2, '0')}:${minutesStr}`;
    }
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutesStr} ${ampm}`;
  }
}
