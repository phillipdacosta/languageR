import { Pipe, PipeTransform } from '@angular/core';
import { EventInput } from '@fullcalendar/core';
import { computeGrossFreeHoursFromEvents } from '../utils/future-availability.util';

@Pipe({
  name: 'grossFreeHours',
  standalone: true,
  pure: true
})
export class GrossFreeHoursPipe implements PipeTransform {
  transform(events: EventInput[], selectedDay: { date: Date } | null): number {
    if (!selectedDay || !selectedDay.date || !events || events.length === 0) {
      return 0;
    }
    return computeGrossFreeHoursFromEvents(events, selectedDay.date, 'fullDay');
  }
}
