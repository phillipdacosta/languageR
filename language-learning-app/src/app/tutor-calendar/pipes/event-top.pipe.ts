import { Pipe, PipeTransform } from '@angular/core';
import { getHoursInTz, getMinutesInTz } from '../../shared/timezone.utils';

@Pipe({
  name: 'eventTop',
  standalone: true,
  pure: true
})
export class EventTopPipe implements PipeTransform {
  transform(event: any, timezone?: string): number {
    if (!event?.start) return 0;

    const startTime = new Date(event.start);
    const startHour = getHoursInTz(startTime, timezone);
    const startMinute = getMinutesInTz(startTime, timezone);
    const startOffset = 6;
    const slotHeight = 110.3;

    return ((startHour - startOffset) * slotHeight) + (startMinute / 60 * slotHeight);
  }
}
