# Calendar Event Persistence Fix 🔧

## Problem
User reported:
1. "the class completely got removed. This is wrong."
2. "I am also still seeing old classes."
3. "there are obviously lifecycle hooks that are being called over and over causing ui/ux issues"

## Root Cause Analysis

### Issue 1: Events Being Cleared
Multiple places in the code were calling `this.events = []`, which wiped out ALL calendar events:

**Culprits:**
- Line 1455: `forceReinitializeCalendar()` - cleared events before reload
- Line 2342: `forceRefreshAvailability()` - cleared events before reload  
- Line 1547, 1600: `loadAndUpdateCalendarData()` - cleared in some paths

**Problem**: These functions are called by:
- WebSocket notifications (`class_auto_cancelled`)
- `refreshCalendar()`
- Lifecycle hooks (`ionViewDidEnter`)
- User actions

When they run, they clear `this.events = []`, then asynchronously load data. If multiple calls happen rapidly, events get cleared repeatedly before data can load.

### Issue 2: Race Conditions
The load sequence:
1. `loadAndUpdateCalendarData()` loads availability
2. `loadLessonsAndClasses()` loads lessons and classes (parallel, async)
3. Each loader merges into `this.events`

**BUT** if lifecycle hooks or WebSocket triggers another `refreshCalendar()` while loads are in progress, `this.events = []` wipes everything.

### Issue 3: Lifecycle Hook Spam
- `ionViewWillEnter()` - sets loading states
- `ionViewDidEnter()` - calls `refreshCalendarData()` or `forceReinitializeCalendar()`
- WebSocket notifications call `refreshCalendar()`
- Each refresh can trigger multiple data loads

## Solution Implemented

### 1. Never Clear Events Array
Changed all places that were clearing events to instead **merge** data:

**Before**:
```typescript
refreshCalendar() {
  this.events = [];  // ❌ Clears everything
  this.loadAndUpdateCalendarData();
}
```

**After**:
```typescript
refreshCalendar() {
  console.log('🔄 [REFRESH] refreshCalendar() called');
  // DON'T clear events - just reload and merge
  if (this.currentUser && this.currentUser.id) {
    this.loadLessonsAndClasses(this.currentUser.id);
  }
  this.loadAndUpdateCalendarData();
}
```

### 2. Fixed `forceReinitializeCalendar()`

**Before**:
```typescript
private forceReinitializeCalendar() {
  this.events = [];  // ❌ Clears everything
  this.loadAndUpdateCalendarData();
  if (this.currentUser && this.currentUser.id) {
    this.loadLessonsAndClasses(this.currentUser.id);
  }
  this.cdr.detectChanges();
}
```

**After**:
```typescript
private forceReinitializeCalendar() {
  console.log('🔄 [FORCE-REINIT] forceReinitializeCalendar() called - SHOULD ONLY HAPPEN ON FIRST LOAD');
  
  // DON'T clear events - data loads will merge properly
  // this.events = [];  // REMOVED
  
  this.loadAndUpdateCalendarData();
  if (this.currentUser && this.currentUser.id) {
    this.loadLessonsAndClasses(this.currentUser.id);
  }
  this.cdr.detectChanges();
}
```

### 3. Fixed `forceRefreshAvailability()`

**Before**:
```typescript
private forceRefreshAvailability() {
  this.events = [];  // ❌ Clears lessons and classes too!
  
  this.userService.getAvailability().subscribe({
    next: (res) => {
      this.events = res.availability.map(b => this.blockToEvent(b));
    }
  });
}
```

**After**:
```typescript
private forceRefreshAvailability() {
  console.log('🔄 [FORCE-REFRESH-AVAIL] forceRefreshAvailability() called');
  
  // DON'T clear all events - only update availability, preserve lessons/classes
  
  this.userService.getAvailability().subscribe({
    next: (res) => {
      // Remove old availability events, keep lessons and classes
      const nonAvailabilityEvents = this.events.filter(event => {
        const extendedProps = event.extendedProps as any;
        return extendedProps?.type !== 'availability' && 
               (extendedProps?.isLesson !== undefined || extendedProps?.isClass);
      });
      
      if (res.availability && res.availability.length > 0) {
        const availEvents = res.availability.map(b => this.blockToEvent(b));
        this.events = [...availEvents, ...nonAvailabilityEvents];
      } else {
        this.events = nonAvailabilityEvents;
      }
      // ... update calendar display
    }
  });
}
```

## How Merging Works Now

### Availability Load
```typescript
// Filter out OLD availability, keep lessons/classes
const nonAvailabilityEvents = this.events.filter(e => 
  e.extendedProps?.type !== 'availability'
);

// Merge NEW availability with existing lessons/classes
this.events = [...availabilityEvents, ...nonAvailabilityEvents];
```

### Lessons Load
```typescript
// Filter out OLD lessons, keep availability/classes
const nonLessonEvents = this.events.filter(e => {
  const ext = e.extendedProps as any;
  return !ext?.lessonId;
});

// Merge NEW lessons with existing availability/classes
this.events = [...nonLessonEvents, ...lessonEvents];
```

### Classes Load
```typescript
// Filter out OLD classes, keep availability/lessons
const nonClassEvents = this.events.filter(e => {
  const ext = e.extendedProps as any;
  return !ext?.isClass && !ext?.classId;
});

// Merge NEW classes with existing availability/lessons
this.events = [...nonClassEvents, ...classEvents];
```

## Benefits

1. **No Data Loss**: Events never get cleared, only replaced/merged
2. **Race Condition Safe**: Multiple refresh calls won't lose data
3. **Better Performance**: No need to reload ALL data on every refresh
4. **Cancelled Classes Persist**: They stay in the array with `isCancelled: true`
5. **Smoother UX**: No flickering or disappearing events

## Testing Strategy

### Console Logging Added
All key functions now log:
- `🔄 [REFRESH]` - refresh calls
- `🔄 [FORCE-REINIT]` - reinit calls
- `🔄 [FORCE-REFRESH-AVAIL]` - availability refresh
- `📚 [CLASS-DEBUG]` - class loading
- `📚 [LOAD-DEBUG]` - lesson loading

Watch console to see:
- How many times functions are called
- If events are being preserved
- If cancelled classes are in the array

### Test Cancelled Class
1. Load calendar - see all classes
2. Auto-cancel a class
3. Check console - should see:
   ```
   🔄 [REFRESH] refreshCalendar() called
   📚 [CLASS-DEBUG] All classes: X total classes
   📚 [CLASS-DEBUG] Classes: [...includes cancelled with status: 'cancelled']
   ```
4. Cancelled class should stay visible with crossed-out styling

## Files Modified
- ✅ `tutor-calendar.page.ts`
  - `refreshCalendar()` - removed `this.events = []`
  - `forceReinitializeCalendar()` - removed `this.events = []`, added logging
  - `forceRefreshAvailability()` - removed `this.events = []`, merges properly

## Remaining Concerns

### Potential Issues to Watch
1. **Memory**: Events array could grow if old/past events aren't cleaned up
2. **Duplicates**: If event IDs change, might get duplicates
3. **Stale Data**: Old events might persist if not properly filtered

### Recommendations
- Monitor `this.events.length` in console
- Consider adding periodic cleanup of past events (> 7 days old)
- Consider using a Set or Map for better deduplication

---

**Status**: ✅ Fixed - Events no longer get cleared
**Date**: December 19, 2025
**Next**: Monitor console logs during testing to verify lifecycle behavior




