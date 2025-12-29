import { Pipe, PipeTransform } from '@angular/core';
import { EventInput } from '@fullcalendar/core';

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
    
    // Only calculate for the calendar's visible hours (6 AM to 11 PM)
    const dayStart = new Date(selectedDay.date);
    dayStart.setHours(6, 0, 0, 0); // Start at 6 AM
    const dayEnd = new Date(selectedDay.date);
    dayEnd.setHours(23, 0, 0, 0); // End at 11 PM
    
    let totalAvailableMinutes = 0;
    let totalBookedMinutes = 0;
    
    // Loop through all events for this day
    for (const event of events) {
      if (!event.start || !event.end) continue;
      
      const eventStart = new Date(event.start as string | number | Date);
      const eventEnd = new Date(event.end as string | number | Date);
      
      if (isNaN(eventStart.getTime()) || isNaN(eventEnd.getTime())) continue;
      
      // Check if event overlaps with this day's visible hours
      if (eventStart >= dayEnd || eventEnd <= dayStart) continue;
      
      // Clamp to visible hours
      const clampedStart = eventStart.getTime() < dayStart.getTime() ? dayStart : eventStart;
      const clampedEnd = eventEnd.getTime() > dayEnd.getTime() ? dayEnd : eventEnd;
      const durationMinutes = Math.round((clampedEnd.getTime() - clampedStart.getTime()) / 60000);
      
      const extended = (event.extendedProps as any) || {};
      // Check for 'available' (not 'availability')
      const isAvailability = extended.type === 'available';
      const isLesson = Boolean(extended.lessonId);
      const isClass = Boolean(extended.classId || extended.isClass);
      
      if (isAvailability) {
        totalAvailableMinutes += durationMinutes;
      } else if (isLesson || isClass) {
        totalBookedMinutes += durationMinutes;
      }
    }
    
    // Available but not booked = total availability - booked lessons
    const freeMinutes = Math.max(0, totalAvailableMinutes - totalBookedMinutes);
    
    // Convert to hours (rounded to 1 decimal place)
    return Math.round((freeMinutes / 60) * 10) / 10;
  }
}


