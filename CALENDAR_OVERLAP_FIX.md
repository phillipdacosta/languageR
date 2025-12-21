# Calendar Overlap Fix - Hide Cancelled Events with Active Conflicts ✨

## Problem / Edge Case
**User Report**: 
> "12:30 - 12:55 Class was auto-cancelled. Calendar correctly reflected the event as cancelled by showing crossed out text. The timeslot became available on the tutor-availability view. So a student saw it open and booked a class for 12:30-12:55. Now both events occupy the cell on the tutor-calendar making it unreadable."

### Visual Example:
```
Before (overlapping):
┌─────────────────────────┐
│ 12:30 PM (25min)        │
│ Phillip DaCosta sfkjg...│ ← New active lesson (readable)
│ Phillip DaCosta sfkjg...│ ← Cancelled class (crossed out, overlapping)
└─────────────────────────┘
```

**Result**: Text is unreadable, UI is cluttered.

## Solution: Prioritize Active Events

**Strategy**: When a cancelled event and an active (non-cancelled) event overlap in time, **hide the cancelled event** and show only the active one.

### Rationale:
1. **Active events are current reality** - they matter most
2. **Cancelled events are historical** - less important
3. **Clean UI** - one event per time slot = readable
4. **No data loss** - cancelled events are still in the database and can be viewed elsewhere (e.g., in a history view if you add one later)

## Implementation

### Files Modified:
1. `language-learning-app/src/app/tutor-calendar/pipes/events-for-day.pipe.ts` (Week View)
2. `language-learning-app/src/app/tutor-calendar/pipes/events-for-selected-day.pipe.ts` (Day View)

### Logic (Same for Both Pipes):

```typescript
transform(events: any[], day: any): any[] {
  // Step 1: Filter events for this day (existing logic)
  const dayEvents = events.filter(event => {
    // ... filter by date range, exclude availability blocks ...
  });
  
  // Step 2: Filter out cancelled events that overlap with active events (NEW)
  const filteredEvents = dayEvents.filter(event => {
    const isCancelled = event.extendedProps?.isCancelled === true;
    
    // If not cancelled, always include
    if (!isCancelled) return true;
    
    // If cancelled, check for overlapping active events
    const eventStart = new Date(event.start).getTime();
    const eventEnd = new Date(event.end).getTime();
    
    const hasOverlappingActiveEvent = dayEvents.some(otherEvent => {
      if (otherEvent === event) return false; // Don't compare with self
      
      const otherIsCancelled = otherEvent.extendedProps?.isCancelled === true;
      if (otherIsCancelled) return false; // Only check overlap with active events
      
      const otherStart = new Date(otherEvent.start).getTime();
      const otherEnd = new Date(otherEvent.end).getTime();
      
      // Check if time ranges overlap
      return (eventStart < otherEnd && eventEnd > otherStart);
    });
    
    // Only include cancelled event if it doesn't overlap with any active event
    return !hasOverlappingActiveEvent;
  });
  
  // Step 3: Map to display format (existing logic)
  return filteredEvents.map(event => { ... });
}
```

### Overlap Detection Algorithm:

Two events overlap if:
```
eventStart < otherEnd AND eventEnd > otherStart
```

**Examples**:

✅ **Overlap** (Cancelled event will be hidden):
```
Cancelled:  |-------|
Active:        |-------|
            12:30   12:55
```

✅ **Overlap** (Cancelled event will be hidden):
```
Cancelled:     |-------|
Active:     |-------|
           12:30   12:55
```

✅ **Exact Match** (Cancelled event will be hidden):
```
Cancelled:  |-------|
Active:     |-------|
           12:30   12:55
```

❌ **No Overlap** (Both events will show):
```
Cancelled:  |-------|
Active:               |-------|
           12:30   12:55   1:20
```

## Behavior After Fix

### Scenario 1: Cancelled Class with New Lesson at Same Time
```
Timeline:
1. Class "Spanish 101" at 12:30-12:55 is auto-cancelled
2. Student books lesson "Phillip D." at 12:30-12:55

Calendar Display:
- Shows: "Phillip D." (active lesson) ✅
- Hides: "Spanish 101" (cancelled class, overlaps) ✅

Result: Clean, readable UI
```

### Scenario 2: Cancelled Class with NO New Booking
```
Timeline:
1. Class "Spanish 101" at 12:30-12:55 is auto-cancelled
2. No new booking

Calendar Display:
- Shows: "Spanish 101" (crossed out, cancelled) ✅

Result: Tutor can still see the cancellation history
```

### Scenario 3: Two Cancelled Events (Both Show)
```
Timeline:
1. Class "Spanish 101" at 12:30-12:55 is cancelled
2. Lesson "John D." at 12:30-12:55 is also cancelled

Calendar Display:
- Shows: Both events (both crossed out, but overlapping) ⚠️

Note: This is rare and acceptable - both are historical
```

### Scenario 4: Multiple Active Events (All Show)
```
Timeline:
1. Lesson A at 12:30-12:55 (active)
2. Lesson B at 12:30-12:55 (active) - double booking bug

Calendar Display:
- Shows: Both active events (overlapping) ⚠️

Note: This indicates a double-booking issue that should be fixed separately
```

## Edge Cases Handled

### ✅ Partial Overlap:
```
Cancelled Class: 12:30-1:30 (60min)
Active Lesson:   12:45-1:10 (25min)

Result: Cancelled class is hidden (overlaps with active lesson)
```

### ✅ Multiple Cancelled Events with One Active:
```
Cancelled Class A: 12:30-12:55
Cancelled Class B: 12:30-12:55
Active Lesson:     12:30-12:55

Result: Both cancelled classes are hidden, only active lesson shows
```

### ✅ Cancelled Event Spans Multiple Active Events:
```
Cancelled Class: 12:00-2:00 (2 hours)
Active Lesson A: 12:30-12:55
Active Lesson B: 1:30-1:55

Result: Cancelled class is hidden (overlaps with both active lessons)
```

## Testing

### Test Scenario:
1. **Create a class** at 12:30-12:55
2. **Auto-cancel the class** (test button)
3. **Verify**: Class shows with strikethrough on calendar ✅
4. **Book a new lesson** at 12:30-12:55 (as a student)
5. **Refresh tutor-calendar**
6. **Verify**: Only the new active lesson shows, cancelled class is hidden ✅
7. **Cancel the new lesson**
8. **Refresh tutor-calendar**
9. **Verify**: Both cancelled events show (both crossed out) - acceptable ✅

### Visual Test:
**Before Fix**:
```
┌─────────────────────────┐
│ 12:30 PM (25min)        │
│ Phillip DaCosta sfkjg...│ ← Unreadable overlap
│ Phillip DaCosta sfkjg...│
└─────────────────────────┘
```

**After Fix**:
```
┌─────────────────────────┐
│ 12:30 PM (25min)        │
│ Phillip DaCosta         │ ← Clean, readable!
└─────────────────────────┘
```

## Alternative Solutions Considered

### ❌ Option 2: Layer with z-index (cancelled behind active)
```css
.calendar-event.is-cancelled {
  z-index: 1;
}
.calendar-event:not(.is-cancelled) {
  z-index: 10;
}
```

**Problem**: 
- Both events still take up space
- Cancelled event peeks out from behind
- Still visually cluttered

### ❌ Option 3: Remove all cancelled events
```typescript
const filteredEvents = dayEvents.filter(event => 
  !event.extendedProps?.isCancelled
);
```

**Problem**:
- Tutor loses all visibility into cancellation history
- Can't see what was cancelled if no replacement booking

### ✅ Option 1 (Implemented): Conditional hiding
**Pros**:
- Clean UI when there's an active replacement
- Tutor can still see cancellations when slots remain empty
- Best of both worlds

## Performance Impact

**Minimal**:
- Two-pass filter (1st: day filter, 2nd: overlap check)
- Complexity: O(n²) worst case, but n is small (typically < 20 events per day)
- Pipes are memoized (`pure: true`), so recalculation only happens when events array changes

## Future Enhancements (Optional)

### 1. Cancelled Events Toggle
Add a button to show/hide all cancelled events:
```typescript
showCancelledEvents = false;

toggleCancelledEvents() {
  this.showCancelledEvents = !this.showCancelledEvents;
}
```

### 2. Cancelled Events History View
Separate page or modal to view all cancelled events:
```
/tutor-calendar/history
```

### 3. Tooltip on Active Event
When hovering over an active event that replaced a cancelled one, show tooltip:
```
"This slot was previously: Spanish 101 (cancelled)"
```

---

**Status**: ✅ Implemented
**Impact**: Prevents unreadable UI when cancelled events are replaced
**User Experience**: Clean calendar, prioritizes current reality over history
**Date**: December 19, 2025


