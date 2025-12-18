import { Pipe, PipeTransform } from '@angular/core';
import { EventInput } from '@fullcalendar/core';

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
    
    const dayStart = new Date(selectedDay.date);
    dayStart.setHours(6, 0, 0, 0);
    const dayEnd = new Date(selectedDay.date);
    dayEnd.setHours(23, 0, 0, 0);
    
    let totalAvailableMinutes = 0;
    
    for (const event of events) {
      if (!event.start || !event.end) continue;
      
      const eventStart = new Date(event.start as string | number | Date);
      const eventEnd = new Date(event.end as string | number | Date);
      
      if (isNaN(eventStart.getTime()) || isNaN(eventEnd.getTime())) continue;
      if (eventStart >= dayEnd || eventEnd <= dayStart) continue;
      
      const clampedStart = eventStart.getTime() < dayStart.getTime() ? dayStart : eventStart;
      const clampedEnd = eventEnd.getTime() > dayEnd.getTime() ? dayEnd : eventEnd;
      const durationMinutes = Math.round((clampedEnd.getTime() - clampedStart.getTime()) / 60000);
      
      const extended = (event.extendedProps as any) || {};
      const isAvailability = extended.type === 'available';
      
      if (isAvailability) {
        totalAvailableMinutes += durationMinutes;
      }
    }
    
    return Math.round((totalAvailableMinutes / 60) * 10) / 10;
  }
}


