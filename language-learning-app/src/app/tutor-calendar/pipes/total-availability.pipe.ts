import { Pipe, PipeTransform } from '@angular/core';
import { EventInput } from '@fullcalendar/core';
import { computeFutureTotalAvailabilityHoursFromEvents } from '../utils/future-availability.util';

@Pipe({
  name: 'totalAvailability',
  standalone: true,
  pure: true
})
export class TotalAvailabilityPipe implements PipeTransform {
  transform(events: EventInput[], selectedDay: { date: Date } | null): number {
    if (!selectedDay || !selectedDay.date || !events || events.length === 0) {
      return 0;
    }
    return computeFutureTotalAvailabilityHoursFromEvents(events, selectedDay.date, new Date(), 'fullDay');
  }
}


