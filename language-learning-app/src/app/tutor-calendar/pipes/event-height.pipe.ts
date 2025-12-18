import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'eventHeight',
  standalone: true,
  pure: true
})
export class EventHeightPipe implements PipeTransform {
  transform(event: any): number {
    if (!event?.start || !event?.end) return 0;
    
    const startTime = new Date(event.start);
    const endTime = new Date(event.end);
    const durationMs = endTime.getTime() - startTime.getTime();
    const durationHours = durationMs / (1000 * 60 * 60);
    const slotHeight = 110; // 110px per hour (Outlook-style spacing)
    
    return durationHours * slotHeight;
  }
}


