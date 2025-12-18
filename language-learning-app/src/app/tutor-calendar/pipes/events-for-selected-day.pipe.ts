import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'eventsForSelectedDay',
  standalone: true,
  pure: true
})
export class EventsForSelectedDayPipe implements PipeTransform {
  transform(events: any[], selectedDay: any): any[] {
    if (!events || !selectedDay || !selectedDay.date) return [];
    
    const dayStart = new Date(selectedDay.date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(selectedDay.date);
    dayEnd.setHours(23, 59, 59, 999);
    
    return events.filter(event => {
      if (!event.start) return false;
      const eventStart = new Date(event.start as any);
      const isInRange = eventStart >= dayStart && eventStart <= dayEnd;
      
      // ONLY show actual lessons/classes, NOT availability blocks
      const extendedProps = (event.extendedProps || {}) as any;
      const isAvailability = extendedProps.type === 'availability';
      const isLesson = extendedProps.lessonId || extendedProps.lesson;
      const isClass = extendedProps.classId || extendedProps.isClass;
      
      return isInRange && !isAvailability && (isLesson || isClass);
    }).map(event => {
      const extendedProps = (event.extendedProps || {}) as any;
      
      // Check if it's a class or a lesson
      const isClass = extendedProps.isClass || extendedProps.classId;
      
      // For classes, use class name and thumbnail
      // For lessons, use student name and avatar
      let displayName = '';
      let avatar = '';
      
      if (isClass) {
        displayName = extendedProps.className || event.title || 'Class';
        avatar = extendedProps.classThumbnail || '';
      } else {
        const studentName = extendedProps.studentName || extendedProps.student?.name || '';
        displayName = this.formatNameWithInitial(studentName);
        avatar = extendedProps.studentAvatar || extendedProps.student?.profilePicture || '';
      }
      
      return {
        ...event,
        title: event.title || 'Untitled Event',
        studentName: displayName,
        studentAvatar: avatar,
        isAvailability: false,
        isClass: isClass,
        start: new Date(event.start as any),
        end: new Date(event.end as any)
      };
    });
  }
  
  private formatNameWithInitial(fullName: string): string {
    if (!fullName) return '';
    const parts = fullName.split(' ');
    if (parts.length > 1) {
      return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
    }
    return fullName;
  }
}

