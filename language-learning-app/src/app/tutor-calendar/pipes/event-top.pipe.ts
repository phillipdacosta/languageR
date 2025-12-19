import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'eventTop',
  standalone: true,
  pure: true
})
export class EventTopPipe implements PipeTransform {
  transform(event: any): number {
    if (!event?.start) return 0;
    
    const startTime = new Date(event.start);
    const startHour = startTime.getHours();
    const startMinute = startTime.getMinutes();
    const startOffset = 6; // Calendar starts at 6 AM
    const slotHeight = 110.3; // 110px per hour (Outlook-style spacing)
    
    return ((startHour - startOffset) * slotHeight) + (startMinute / 60 * slotHeight);
  }
}


