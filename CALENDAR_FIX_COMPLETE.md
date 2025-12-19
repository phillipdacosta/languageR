# Tutor Calendar Fix: Show Cancelled Classes Crossed Out ✅

## Problem
When a class was auto-cancelled on the tutor calendar page:
- The class would disappear entirely from the calendar
- User mentioned: "When the tutor-calendar page refreshes, i can see the class load, flash but then it goes away"

**Expected behavior**: Cancelled classes should remain visible but with crossed-out styling.

## Solution Implemented

### 1. Added TEST Auto-Cancel Button (`tutor-calendar.page.html`)
Added red test button at bottom-right of calendar for easier testing:

```html
<!-- 🧪 DEV TEST: Auto-Cancel Button -->
<div style="position: fixed; bottom: 20px; right: 20px; z-index: 9999;">
  <ion-button color="danger" (click)="testAutoCancelClass()" size="small">
    <ion-icon name="warning" slot="start"></ion-icon>
    TEST Auto-Cancel
  </ion-button>
</div>
```

### 2. Added Test Methods (`tutor-calendar.page.ts`)

```typescript
async testAutoCancelClass() {
  // Find first upcoming scheduled class from calendar events
  const upcomingClass = this.events.find((e: any) => 
    e.extendedProps?.isClass && 
    e.extendedProps?.status === 'scheduled' &&
    new Date(e.start) > new Date()
  );
  
  // ... confirmation dialog, then call executeTestAutoCancel()
}

private async executeTestAutoCancel(classId: string, className: string) {
  // Makes API call to /api/classes/:classId/test-auto-cancel
  // Shows loading/success/error toasts
  // Calls refreshCalendar() to update display
}
```

### 3. Removed Filter for Cancelled Classes

**Before** (Line ~1107):
```typescript
// Filter out cancelled classes to avoid cluttering the calendar
const activeAndCompletedClasses = response.classes.filter((cls: any) => cls.status !== 'cancelled');
```

**After**:
```typescript
// Include all classes (including cancelled) to show them crossed out
const allClasses = response.classes;
```

### 4. Updated Class Event Properties

```typescript
const classEvents = allClasses.map((cls: any) => {
  const isCancelled = cls.status === 'cancelled';
  const event: EventInput = {
    id: String(cls._id),
    title: cls.name || 'Class',
    backgroundColor: isCancelled ? '#9ca3af' : '#8b5cf6',  // Gray if cancelled
    borderColor: isCancelled ? '#6b7280' : '#6d28d9',
    textColor: isCancelled ? '#6b7280' : '#ffffff',        // Muted text if cancelled
    classNames: [
      'calendar-class-event', 
      new Date(cls.endTime).getTime() < Date.now() ? 'is-past' : 'is-future',
      isCancelled ? 'is-cancelled' : ''                     // Add is-cancelled class
    ].filter(Boolean),
    extendedProps: {
      // ... other props
      isCancelled: isCancelled,
      cancelReason: cls.cancelReason,
      status: cls.status
    }
  };
  return event;
});
```

### 5. Removed Filter for Cancelled Lessons

**Before** (Line ~1193):
```typescript
// Filter out cancelled lessons to avoid cluttering the calendar
const activeAndCompletedLessons = lessons.filter(lesson => lesson.status !== 'cancelled');
```

**After**:
```typescript
// Convert all lessons to events (including cancelled) to show them crossed out
const allLessons = lessons;
```

### 6. Updated Lesson Event Properties

```typescript
const isCancelled = lesson.status === 'cancelled';

// Determine color based on type and status
if (isCancelled) {
  backgroundColor = '#9ca3af'; // Gray for cancelled
  borderColor = '#6b7280';
}

const eventData = {
  // ... other props
  textColor: isCancelled ? '#6b7280' : '#ffffff',
  classNames: [
    isPast ? 'is-past' : 'is-future', 
    'calendar-lesson-event',
    isCancelled ? 'is-cancelled' : ''
  ].filter(Boolean),
  extendedProps: {
    // ... other props
    isCancelled: isCancelled,
    cancelReason: lesson.cancelReason
  }
} as EventInput;
```

## CSS Already Exists!

The HTML template already has `[class.is-cancelled]` bindings throughout:

```html
<div 
  class="fc-event"
  [class.is-cancelled]="event.extendedProps?.isCancelled"
  ...>
```

And the SCSS has `.is-cancelled` styling:

```scss
.is-cancelled {
  text-decoration: line-through;
  opacity: 0.6;
  // ... more styling
}
```

## How It Works Now

### Calendar Display
1. **All events loaded**: Classes and lessons (both active and cancelled)
2. **Cancelled items get**:
   - Gray background color (`#9ca3af`)
   - Muted text color (`#6b7280`)
   - `is-cancelled` CSS class applied
   - Text crossed out via CSS

3. **Visual appearance**:
   - Active classes: Purple background, white text
   - Cancelled classes: Gray background, muted text, crossed out
   - Active lessons: Green background, white text
   - Cancelled lessons: Gray background, muted text, crossed out

### Auto-Cancel Flow
1. Class auto-cancels (via cron or TEST button)
2. WebSocket notification sent
3. Calendar receives notification
4. `refreshCalendar()` called
5. Events reload from server
6. Cancelled class now has `status: 'cancelled'`
7. Event rendered with `is-cancelled` class
8. CSS applies crossed-out styling

## Files Modified

### Frontend
- ✅ `language-learning-app/src/app/tutor-calendar/tutor-calendar.page.html`
  - Added TEST Auto-Cancel button

- ✅ `language-learning-app/src/app/tutor-calendar/tutor-calendar.page.ts`
  - Added `testAutoCancelClass()` method
  - Added `executeTestAutoCancel()` method
  - Removed filter for cancelled classes (line ~1107)
  - Removed filter for cancelled lessons (line ~1193)
  - Updated class event properties to include `isCancelled` and styling
  - Updated lesson event properties to include `isCancelled` and styling

## Testing Checklist

- [ ] Navigate to tutor calendar page
- [ ] See red "TEST Auto-Cancel" button at bottom-right
- [ ] Create a test class (or use existing upcoming class)
- [ ] Click "TEST Auto-Cancel" button
- [ ] Confirm the cancellation
- [ ] Expected results:
  - [ ] Success toast appears
  - [ ] Calendar refreshes
  - [ ] Cancelled class still visible on calendar
  - [ ] Class has gray background
  - [ ] Class title is crossed out
  - [ ] Class is partially transparent
- [ ] Click on cancelled class
- [ ] Should still show details with cancellation info

## Before vs After

### Before
```
Class displayed → Auto-cancel → Calendar refreshes → Class disappears (filtered out)
```

### After
```
Class displayed → Auto-cancel → Calendar refreshes → Class stays visible with crossed-out styling
```

## Color Scheme

| Status | Background | Border | Text | Opacity |
|--------|-----------|--------|------|---------|
| Scheduled (Class) | Purple `#8b5cf6` | `#6d28d9` | White | 100% |
| Scheduled (Lesson) | Green `#10b981` | `#059669` | White | 100% |
| Cancelled | Gray `#9ca3af` | `#6b7280` | Gray `#6b7280` | 60% |
| Completed | Gray `#6b7280` | `#4b5563` | White | 100% |

---

**Status**: ✅ COMPLETE - Ready to test
**Date**: December 19, 2025

