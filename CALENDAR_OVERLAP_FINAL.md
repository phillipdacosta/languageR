# Calendar Overlap Logic - Show Most Recent Event 🎯

## Updated Strategy

When multiple events overlap at the same time, **show only one**:
1. **Active (non-cancelled) events** take priority over cancelled events
2. **Among cancelled events**, show only the **most recent** one

This keeps the UI clean and readable in all scenarios.

## All Scenarios Covered

### Scenario 1: Active vs Cancelled
```
Cancelled: Spanish 101 (12:30-12:55)
Active:    Phillip D. (12:30-12:55)

Display: Only "Phillip D." ✅
```

### Scenario 2: Two Cancelled Events (Same Time)
```
Cancelled A: Spanish 101 (12:30-12:55) - created 10:00 AM
Cancelled B: English Class (12:30-12:55) - created 10:30 AM

Display: Only "English Class" (more recent) ✅
```

### Scenario 3: Partial Overlap (Your Example)
```
Cancelled A: Class (12:30-12:55) - created 10:00 AM
Cancelled B: Lesson (12:30-1:25) - created 11:00 AM

Display: Only Lesson 12:30-1:25 (more recent, larger) ✅
```

### Scenario 4: Active Overlaps Multiple Cancelled
```
Cancelled A: Class (12:30-12:55)
Cancelled B: Lesson (12:30-1:25)
Active:      New Class (12:30-12:55)

Display: Only "New Class" (active takes priority) ✅
```

### Scenario 5: No Overlap
```
Cancelled A: Class (12:30-12:55)
Cancelled B: Lesson (1:30-1:55)

Display: Both (no conflict, both visible) ✅
```

## Logic Details

### Priority Rules (in order):
1. **Active always wins** - If an active event overlaps, hide all cancelled events
2. **Most recent cancelled wins** - Among overlapping cancelled events, show only the newest
3. **Tiebreaker** - If created at exact same time, use event ID (alphabetical)

### Code Logic:

```typescript
// For each cancelled event, check if it should be hidden
const hasOverlappingConflict = dayEvents.some(otherEvent => {
  // Skip self-comparison
  if (otherEvent === event) return false;
  
  // Get timestamps for comparison
  const eventCreatedAt = new Date(event.extendedProps?.createdAt || event.start).getTime();
  const otherCreatedAt = new Date(otherEvent.extendedProps?.createdAt || otherEvent.start).getTime();
  
  // Check time overlap
  const overlaps = (eventStart < otherEnd && eventEnd > otherStart);
  if (!overlaps) return false;
  
  // RULE 1: Active event overlaps → hide this cancelled event
  if (!otherIsCancelled) return true;
  
  // RULE 2: Other cancelled event is newer → hide this older cancelled event
  if (otherIsCancelled && otherCreatedAt > eventCreatedAt) return true;
  
  // RULE 3: Same creation time → use ID as tiebreaker
  if (otherIsCancelled && otherCreatedAt === eventCreatedAt) {
    return otherId > eventId;
  }
  
  return false;
});
```

### CreatedAt Field

The logic uses `event.extendedProps.createdAt` to determine which event is "more recent":
- **Lessons**: Use `createdAt` from the database
- **Classes**: Use `createdAt` from the database
- **Fallback**: If `createdAt` is missing, use `event.start` (event start time)

This fallback ensures the logic always works, even for old events without a `createdAt` field.

## Your Example Walkthrough

### Timeline:
1. **10:00 AM**: Class "Spanish 101" created (12:30-12:55)
2. **11:00 AM**: Class auto-cancelled
3. **11:30 AM**: Student books lesson (12:30-1:25)
4. **12:00 PM**: Student cancels lesson

### Events in Database:
```javascript
Event A: {
  title: "Spanish 101",
  start: "12:30",
  end: "12:55",
  status: "cancelled",
  createdAt: "10:00 AM"
}

Event B: {
  title: "Phillip D.",
  start: "12:30",
  end: "1:25",
  status: "cancelled",
  createdAt: "11:30 AM"
}
```

### Overlap Check:
```
Event A: 12:30-12:55
Event B: 12:30-1:25
         ^^^^^ overlap (12:30-12:55)
```

### Filter Logic:
**For Event A:**
- Is cancelled? ✅
- Overlaps with Event B? ✅ (12:30-12:55 range overlaps)
- Event B is cancelled? ✅
- Event B is newer? ✅ (11:30 AM > 10:00 AM)
- **Result**: Hide Event A ❌

**For Event B:**
- Is cancelled? ✅
- Overlaps with Event A? ✅
- Event A is cancelled? ✅
- Event A is newer? ❌ (10:00 AM < 11:30 AM)
- **Result**: Show Event B ✅

### Calendar Display:
```
┌─────────────────────────┐
│ 12:30 PM (55min)        │
│ Phillip D. (cancelled)  │ ← Only the most recent cancelled event
└─────────────────────────┘
```

## Edge Cases Handled

### ✅ Three Cancelled Events Overlapping
```
Cancelled A: 12:30-12:55 (created 10:00)
Cancelled B: 12:30-12:55 (created 11:00)
Cancelled C: 12:30-12:55 (created 12:00)

Display: Only C (most recent)
```

### ✅ Cancelled Event Spans Multiple Slots
```
Cancelled A: 12:00-1:00 (created 10:00)
Cancelled B: 12:30-12:55 (created 11:00)

Display: Only B (more recent, even though A is larger)
```

### ✅ Same CreatedAt Timestamp
```
Cancelled A: 12:30-12:55 (created 10:00, id: "abc123")
Cancelled B: 12:30-12:55 (created 10:00, id: "xyz789")

Display: Only B (id "xyz789" > "abc123" alphabetically)
```

### ✅ Missing CreatedAt (Fallback)
```
Cancelled A: 12:30-12:55 (no createdAt, start: 12:30)
Cancelled B: 12:30-12:55 (no createdAt, start: 12:30)

Display: Uses event ID as tiebreaker
```

## Visual Examples

### Before Fix (Unreadable):
```
┌─────────────────────────┐
│ 12:30 PM (25min)        │
│ Spanish 101 sfkjg...    │ ← Old cancelled class
│ Phillip D. sfkjg...     │ ← New cancelled lesson (overlapping)
└─────────────────────────┘
```

### After Fix (Clean):
```
┌─────────────────────────┐
│ 12:30 PM (55min)        │
│ Phillip D.              │ ← Only the most recent
└─────────────────────────┘
```

## Testing

### Test Scenario:
1. **Create class** "Spanish 101" at 12:30-12:55
2. **Auto-cancel** the class
3. **Verify**: Cancelled class shows with strikethrough ✅
4. **Book lesson** "Phillip D." at 12:30-1:25 (overlaps)
5. **Cancel lesson**
6. **Verify**: Only "Phillip D." shows (most recent) ✅
7. **Create another lesson** "John S." at 12:30-12:55
8. **Verify**: Only "John S." shows (active takes priority) ✅

## Performance

**Complexity**: O(n²) per day column
- n = number of events per day (typically < 20)
- For each cancelled event, checks all other events for overlaps
- Acceptable performance for typical use cases

**Optimization**: Pipes are memoized (`pure: true`), so recalculation only happens when the events array changes.

## Files Modified
- ✅ `language-learning-app/src/app/tutor-calendar/pipes/events-for-day.pipe.ts`
- ✅ `language-learning-app/src/app/tutor-calendar/pipes/events-for-selected-day.pipe.ts`

Both pipes now implement the same logic for consistent behavior in week and day views.

---

**Status**: ✅ Implemented
**Strategy**: Show most recent event when multiple overlap
**Priority**: Active > Newer Cancelled > Older Cancelled
**Result**: Clean, readable calendar UI in all scenarios
**Date**: December 19, 2025


