import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'isEventPast',
  standalone: true,
  pure: true
})
export class IsEventPastPipe implements PipeTransform {
  transform(event: any): boolean {
    if (!event?.end) return false;
    
    const endTime = new Date(event.end);
    const now = new Date();
    
    return endTime < now;
  }
}


