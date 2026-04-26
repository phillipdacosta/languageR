import { Pipe, PipeTransform } from '@angular/core';
import { EventInput } from '@fullcalendar/core';
import { computeFutureFreeHoursFromEvents } from '../utils/future-availability.util';

@Pipe({
  name: 'freeHours',
  standalone: true,
  pure: true // Only recalculates when inputs change
})
export class FreeHoursPipe implements PipeTransform {
  transform(events: EventInput[], selectedDay: { date: Date } | null): number {
    if (!selectedDay || !selectedDay.date || !events || events.length === 0) {
      return 0;
    }
    return computeFutureFreeHoursFromEvents(events, selectedDay.date, new Date(), 'fullDay');
  }
}


