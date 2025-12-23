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
    
    // First pass: filter events for this day
    const dayEvents = events.filter(event => {
      if (!event.start) return false;
      const eventStart = new Date(event.start as any);
      const isInRange = eventStart >= dayStart && eventStart <= dayEnd;
      
      // Show lessons, classes, AND availability blocks
      const extendedProps = (event.extendedProps || {}) as any;
      const isAvailability = extendedProps.type === 'availability' || extendedProps.type === 'available';
      const isLesson = extendedProps.lessonId || extendedProps.lesson;
      const isClass = extendedProps.classId || extendedProps.isClass;
      
      return isInRange && (isLesson || isClass || isAvailability);
    });
    
    // Second pass: filter out cancelled events that overlap with active OR newer cancelled events
    const filteredEvents = dayEvents.filter(event => {
      const extendedProps = (event.extendedProps || {}) as any;
      const isCancelled = extendedProps.isCancelled === true;
      
      // If not cancelled, always include
      if (!isCancelled) return true;
      
      // Log cancelled events
      console.log('📅 [DAY-PIPE] Found cancelled event:', event.title, 'at', new Date(event.start as any).toLocaleString());
      
      // If cancelled, check for overlapping active or newer cancelled events
      const eventStart = new Date(event.start as any).getTime();
      const eventEnd = new Date(event.end as any).getTime();
      const eventCreatedAt = new Date(event.extendedProps?.createdAt || event.start).getTime();
      
      const hasOverlappingConflict = dayEvents.some(otherEvent => {
        if (otherEvent === event) return false; // Don't compare with self
        
        const otherProps = (otherEvent.extendedProps || {}) as any;
        const otherIsCancelled = otherProps.isCancelled === true;
        const otherCreatedAt = new Date(otherEvent.extendedProps?.createdAt || otherEvent.start).getTime();
        
        // Check if other event is availability - availability blocks should NOT hide cancelled events
        const otherIsAvailability = otherProps.type === 'availability' || otherProps.type === 'available';
        if (otherIsAvailability) {
          console.log('  ℹ️ Ignoring overlapping availability block');
          return false; // Availability blocks don't hide cancelled events
        }
        
        const otherStart = new Date(otherEvent.start as any).getTime();
        const otherEnd = new Date(otherEvent.end as any).getTime();
        
        // Check if time ranges overlap
        const overlaps = (eventStart < otherEnd && eventEnd > otherStart);
        if (!overlaps) return false;
        
        // If other event is active (non-cancelled), this cancelled event should be hidden
        if (!otherIsCancelled) {
          console.log('  ❌ Hiding cancelled event because of overlapping active event:', otherEvent.title);
          return true;
        }
        
        // If both are cancelled, hide the older one (show the more recent)
        if (otherIsCancelled && otherCreatedAt > eventCreatedAt) {
          console.log('  ❌ Hiding cancelled event because of newer cancelled event:', otherEvent.title);
          return true;
        }
        
        // If both created at same time, use event ID as tiebreaker (consistent sorting)
        if (otherIsCancelled && otherCreatedAt === eventCreatedAt) {
          const eventId = event.id || '';
          const otherId = otherEvent.id || '';
          return otherId > eventId;
        }
        
        return false;
      });
      
      // Only include cancelled event if it doesn't have an overlapping conflict
      const shouldShow = !hasOverlappingConflict;
      console.log('  ', shouldShow ? '✅ SHOWING' : '❌ HIDING', 'cancelled event');
      return shouldShow;
    });
    
    return filteredEvents.map(event => {
      const extendedProps = (event.extendedProps || {}) as any;
      
      // Check if it's availability, class, or lesson
      const isAvailability = extendedProps.type === 'availability' || extendedProps.type === 'available';
      const isClass = extendedProps.isClass || extendedProps.classId;
      
      // For availability: show "Available"
      // For classes: use class name and thumbnail
      // For lessons: use student name and avatar
      let displayName = '';
      let avatar = '';
      
      if (isAvailability) {
        displayName = '';
        avatar = '';
      } else if (isClass) {
        displayName = extendedProps.className || event.title || 'Class';
        avatar = extendedProps.classThumbnail || '';
      } else {
        const studentName = extendedProps.studentName || extendedProps.student?.name || '';
        displayName = this.formatNameWithInitial(studentName);
        avatar = extendedProps.studentAvatar || extendedProps.student?.profilePicture || '';
      }
      
      return {
        ...event,
        title: isAvailability ? 'Available' : (event.title || 'Untitled Event'),
        studentName: displayName,
        studentAvatar: avatar,
        isAvailability: isAvailability,
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

