import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'eventsForDay',
  standalone: true,
  pure: true // Memoized - only recalculates when inputs change
})
export class EventsForDayPipe implements PipeTransform {
  transform(events: any[], day: any): any[] {
    if (!events || !day) return [];
    
    const dayStart = new Date(day.date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day.date);
    dayEnd.setHours(23, 59, 59, 999);
    
    // First pass: filter events for this day
    const dayEvents = events.filter(event => {
      if (!event.start) return false;
      const eventStart = new Date(event.start as any);
      const isInRange = eventStart >= dayStart && eventStart <= dayEnd;
      
      // ONLY show actual lessons/classes, NOT availability blocks
      const extendedProps = (event.extendedProps || {}) as any;
      const isAvailability = extendedProps.type === 'availability';
      const isLesson = extendedProps.lessonId || extendedProps.lesson;
      const isClass = extendedProps.classId || extendedProps.isClass;
      
      return isInRange && !isAvailability && (isLesson || isClass);
    });
    
    // Second pass: filter out cancelled events that overlap with active OR newer cancelled events
    const filteredEvents = dayEvents.filter(event => {
      const extendedProps = (event.extendedProps || {}) as any;
      const isCancelled = extendedProps.isCancelled === true;
      
      // If not cancelled, always include
      if (!isCancelled) return true;
      
      // If cancelled, check for overlapping active or newer cancelled events
      const eventStart = new Date(event.start as any).getTime();
      const eventEnd = new Date(event.end as any).getTime();
      const eventCreatedAt = new Date(event.extendedProps?.createdAt || event.start).getTime();
      
      const hasOverlappingConflict = dayEvents.some(otherEvent => {
        if (otherEvent === event) return false; // Don't compare with self
        
        const otherProps = (otherEvent.extendedProps || {}) as any;
        const otherIsCancelled = otherProps.isCancelled === true;
        const otherCreatedAt = new Date(otherEvent.extendedProps?.createdAt || otherEvent.start).getTime();
        
        const otherStart = new Date(otherEvent.start as any).getTime();
        const otherEnd = new Date(otherEvent.end as any).getTime();
        
        // Check if time ranges overlap
        const overlaps = (eventStart < otherEnd && eventEnd > otherStart);
        if (!overlaps) return false;
        
        // If other event is active (non-cancelled), this cancelled event should be hidden
        if (!otherIsCancelled) return true;
        
        // If both are cancelled, hide the older one (show the more recent)
        if (otherIsCancelled && otherCreatedAt > eventCreatedAt) return true;
        
        // If both created at same time, use event ID as tiebreaker (consistent sorting)
        if (otherIsCancelled && otherCreatedAt === eventCreatedAt) {
          const eventId = event.id || '';
          const otherId = otherEvent.id || '';
          return otherId > eventId;
        }
        
        return false;
      });
      
      // Only include cancelled event if it doesn't have an overlapping conflict
      return !hasOverlappingConflict;
    });
    
    return filteredEvents.map(event => {
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

