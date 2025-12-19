# Calendar Cancelled Events Display Fix 🔧

## Problem
**User report**: "The class was completely removed from the tutor-calendar UI instead of just crossing out the words."

## Root Cause
Two Angular pipes were filtering out cancelled events:
- `EventsForDayPipe` (week view)
- `EventsForSelectedDayPipe` (day view)

Both had this logic on line 29:
```typescript
return isInRange && !isAvailability && (isLesson || isClass) && !isCancelled;
//                                                                ^^^^^^^^^^^^^^
//                                                                THIS WAS REMOVING THEM
```

## The Fix

### Files Modified
1. `language-learning-app/src/app/tutor-calendar/pipes/events-for-day.pipe.ts`
2. `language-learning-app/src/app/tutor-calendar/pipes/events-for-selected-day.pipe.ts`

### Changes

**Before** (line 22-29):
```typescript
// ONLY show actual lessons/classes, NOT availability blocks or cancelled events
const extendedProps = (event.extendedProps || {}) as any;
const isAvailability = extendedProps.type === 'availability';
const isLesson = extendedProps.lessonId || extendedProps.lesson;
const isClass = extendedProps.classId || extendedProps.isClass;
const isCancelled = extendedProps.isCancelled === true;

return isInRange && !isAvailability && (isLesson || isClass) && !isCancelled;
```

**After**:
```typescript
// ONLY show actual lessons/classes, NOT availability blocks
// INCLUDE cancelled events (they'll be styled with strikethrough)
const extendedProps = (event.extendedProps || {}) as any;
const isAvailability = extendedProps.type === 'availability';
const isLesson = extendedProps.lessonId || extendedProps.lesson;
const isClass = extendedProps.classId || extendedProps.isClass;

return isInRange && !isAvailability && (isLesson || isClass);
```

**Key change**: Removed `&& !isCancelled` from the return statement.

## CSS Styling (Already Existed)

The CSS for cancelled events was already in place in `tutor-calendar.page.scss`:

### Week/Day View Events (line 1568-1578):
```scss
.calendar-event.is-cancelled {
  opacity: 0.6;
  background: #f3f4f6;
  border-left-color: #9ca3af;
  
  .event-title,
  .event-time {
    text-decoration: line-through;  // ✅ Strikethrough
    color: #6b7280;
  }
}
```

### Timeline Cards (line 3975-3985):
```scss
.timeline-card.is-cancelled {
  background: #f3f4f6;
  
  .card-text .title,
  .title,
  .card-text .subtitle,
  .subtitle {
    text-decoration: line-through;  // ✅ Strikethrough
    color: #6b7280;
  }
}
```

## HTML Binding (Already Existed)

The HTML template was already applying the `is-cancelled` class based on `extendedProps.isCancelled`:

### Week View (line 532):
```html
<div *ngFor="let event of events | eventsForDay:day" 
     class="calendar-event"
     [class.is-cancelled]="event.extendedProps?.isCancelled"
     ...>
```

### Day View (line 614):
```html
<div *ngFor="let event of events | eventsForSelectedDay:selectedDayView" 
     class="calendar-event"
     [class.is-cancelled]="event.extendedProps?.isCancelled"
     ...>
```

## Expected Behavior

### After Auto-Cancel or Test Button Click:

1. **Week View**: Cancelled class remains visible in the calendar grid
   - Faded appearance (60% opacity)
   - Gray background
   - Event title has **strikethrough text**
   - Event time has **strikethrough text**

2. **Day View**: Same styling as week view
   - Event stays in the timeline
   - Strikethrough styling applied
   - Gray/muted colors

3. **Timeline/Agenda**: Cancelled events shown with:
   - Strikethrough on title and subtitle
   - Gray background
   - Faded appearance

## Testing

### Test with Auto-Cancel Button:
1. Create a class with start time 16+ minutes in the future
2. Don't enroll minimum students
3. Click "TEST Auto-Cancel" button on calendar page
4. Class should:
   - ✅ Stay visible on calendar
   - ✅ Show with strikethrough text
   - ✅ Appear faded/gray
   - ❌ NOT disappear

### Visual Check:
- Open tutor-calendar page
- Trigger auto-cancel on a visible class
- **Before fix**: Class disappears from calendar
- **After fix**: Class stays visible with strikethrough

## Architecture Note

The pipes were originally designed to hide cancelled events, likely from an earlier iteration where cancelled events were meant to be hidden. However, the UX requirement changed to **show** cancelled events with strikethrough styling (similar to Google Calendar behavior).

The CSS and HTML bindings were updated for this new behavior, but the pipes were overlooked and continued filtering out cancelled events at the data level, preventing them from ever rendering.

This fix aligns the pipe logic with the current UX requirement and existing CSS styling.

---

**Status**: ✅ Fixed
**User Impact**: Cancelled classes now visible with strikethrough on calendar
**Date**: December 19, 2025

