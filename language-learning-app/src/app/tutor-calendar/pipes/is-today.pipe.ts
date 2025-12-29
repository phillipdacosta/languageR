import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'isToday',
  standalone: true,
  pure: true
})
export class IsTodayPipe implements PipeTransform {
  transform(date: Date | string): boolean {
    if (!date) return false;
    
    const inputDate = new Date(date);
    const today = new Date();
    
    return inputDate.getFullYear() === today.getFullYear() &&
           inputDate.getMonth() === today.getMonth() &&
           inputDate.getDate() === today.getDate();
  }
}


