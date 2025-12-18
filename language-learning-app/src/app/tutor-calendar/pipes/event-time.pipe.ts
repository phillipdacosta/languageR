import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'eventTime',
  standalone: true,
  pure: true
})
export class EventTimePipe implements PipeTransform {
  transform(event: any): string {
    if (!event?.start || !event?.end) return '';
    
    const startTime = new Date(event.start);
    const endTime = new Date(event.end);
    const durationMs = endTime.getTime() - startTime.getTime();
    const durationMinutes = Math.round(durationMs / (1000 * 60));
    
    const formattedTime = this.formatTime(startTime);
    return `${formattedTime} (${durationMinutes}min)`;
  }
  
  private formatTime(date: Date): string {
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 should be 12
    const minutesStr = minutes < 10 ? '0' + minutes : minutes.toString();
    return `${hours}:${minutesStr} ${ampm}`;
  }
}


