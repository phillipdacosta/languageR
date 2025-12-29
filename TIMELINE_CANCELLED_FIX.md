# Timeline Cancelled Items Fix ✅

## Problem
When a class in the **timeline** was auto-cancelled:
- Tabs would appear (should only appear if NEXT CLASS is cancelled)
- Cancelled item might disappear from timeline

**User's requirement:**
- If NEXT CLASS (CBA) is NOT cancelled, and timeline item (ABC) IS cancelled:
  - NO tabs should appear
  - Timeline item (ABC) stays in timeline with cancelled badge + reason
  - NEXT CLASS (CBA) unchanged

## Solution Implemented

### 1. Updated `hasCancelledLessons()` Logic
Changed from showing tabs whenever ANY lesson is cancelled, to ONLY when the NEXT CLASS itself is cancelled:

```typescript
// Before
hasCancelledLessons(): boolean {
  return this.cancelledLessons.length > 0;
}

// After
hasCancelledLessons(): boolean {
  // Only show tabs if the first lesson (NEXT CLASS) is cancelled
  // If a lesson in timeline is cancelled, it stays there with badges
  if (!this.firstLessonForSelectedDate || !this.firstLessonForSelectedDate.lesson) {
    return false;
  }
  return this.firstLessonForSelectedDate.lesson.status === 'cancelled';
}
```

### 2. Updated `computeTimelineEvents()` to Include Cancelled Lessons
Timeline now shows ALL upcoming lessons (both active and cancelled) mixed together in chronological order:

```typescript
// Combine upcoming lessons and cancelled lessons
const allLessonsForTimeline = [...this.lessons, ...this.cancelledLessons];

return allLessonsForTimeline
  .filter(lesson => {
    // Exclude if it's in the past
    if (new Date(lesson.startTime) <= now) return false;
    // Exclude if it's the next class being shown in the card section
    if (nextClassLessonId && String(lesson._id) === String(nextClassLessonId)) return false;
    return true;
  })
  .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()) // Sort by time
  .slice(0, 3) // Get next 3 items
  .map(lesson => {
    const isCancelled = lesson.status === 'cancelled';
    
    return {
      // ... other properties
      isCancelled: isCancelled,
      cancelReason: isCancelled ? lesson.cancelReason : null
    };
  });
```

### 3. Updated `hasMoreTimelineEvents()`
Now considers both active and cancelled lessons when determining if there are more than 3 items:

```typescript
hasMoreTimelineEvents(): boolean {
  const allLessons = [...this.lessons, ...this.cancelledLessons];
  const now = new Date();
  const futureLessons = allLessons.filter(lesson => new Date(lesson.startTime) > now);
  
  // Filter out the next class from count
  const timelineLessons = futureLessons.filter(lesson => {
    if (nextClassLessonId && String(lesson._id) === String(nextClassLessonId)) return false;
    return true;
  });
  
  return timelineLessons.length > 3;
}
```

## Scenarios and Expected Behavior

### Scenario 1: NEXT CLASS is NOT cancelled, Timeline item IS cancelled
**Setup:**
- NEXT CLASS card: Lesson CBA (active, starts in 10 mins)
- Timeline: Class ABC (cancelled, starts in 2 hours)

**Behavior:**
- ✅ NO tabs appear
- ✅ NEXT CLASS card shows CBA (unchanged)
- ✅ Timeline shows ABC with cancelled badge + "Cancelled due to insufficient enrollment"

### Scenario 2: NEXT CLASS IS cancelled
**Setup:**
- NEXT CLASS card: Class ABC (cancelled)
- Timeline: Lesson XYZ (active, starts later)

**Behavior:**
- ✅ Tabs appear ("Upcoming" / "Cancelled")
- ✅ "Upcoming" tab: Shows empty state or next upcoming lesson
- ✅ "Cancelled" tab: Shows ABC in card format with red "CANCELLED" badge

### Scenario 3: Multiple timeline items, one cancelled
**Setup:**
- NEXT CLASS card: Lesson A (active, starts in 5 mins)
- Timeline:
  - Lesson B (active, starts in 30 mins)
  - Class C (cancelled, starts in 1 hour)
  - Lesson D (active, starts in 2 hours)

**Behavior:**
- ✅ NO tabs appear
- ✅ Timeline shows B, C (with cancelled badge), D in chronological order
- ✅ All items stay in timeline regardless of status

## Key Logic Rules

1. **Tabs visibility**: `hasCancelledLessons()` returns true ONLY if `firstLessonForSelectedDate.lesson.status === 'cancelled'`

2. **Timeline composition**: Mix of `this.lessons` (active) + `this.cancelledLessons` (cancelled), sorted by start time

3. **Position-based display**: Cancelled items stay where they chronologically belong, just get visual indicators

4. **NEXT CLASS is sacred**: If it's not cancelled, no tabs. If it is cancelled, tabs appear to let user view it in card format.

## Files Modified

- ✅ `language-learning-app/src/app/tab1/tab1.page.ts`
  - `hasCancelledLessons()` - Only true if NEXT CLASS is cancelled
  - `computeTimelineEvents()` - Include cancelled lessons in timeline
  - `hasMoreTimelineEvents()` - Count both active and cancelled lessons

## HTML Already Supports This

The timeline HTML already has the badges and styling:

```html
<div class="timeline-cancelled-badge" *ngIf="event.isCancelled">
  <ion-icon name="close-circle"></ion-icon>
  <span>Cancelled</span>
</div>

<p class="cancellation-reason" *ngIf="event.isCancelled && event.cancelReason === 'minimum_not_met'">
  <ion-icon name="information-circle-outline"></ion-icon>
  Cancelled due to insufficient enrollment
</p>
```

## Testing Checklist

- [ ] Create 2 classes:
  - Class A: Starts in 10 minutes (will be NEXT CLASS)
  - Class B: Starts in 1 hour (will be in timeline)
- [ ] Verify Class A is in "NEXT CLASS" card
- [ ] Verify Class B is in timeline
- [ ] Verify NO tabs are showing
- [ ] Trigger auto-cancel on Class B (the timeline one)
- [ ] Expected results:
  - [ ] NO tabs appear
  - [ ] Class A still in "NEXT CLASS" card (unchanged)
  - [ ] Class B stays in timeline position
  - [ ] Class B shows cancelled badge
  - [ ] Class B shows "Cancelled due to insufficient enrollment"
- [ ] Now trigger auto-cancel on Class A (NEXT CLASS)
- [ ] Expected results:
  - [ ] Tabs NOW appear
  - [ ] Can switch between "Upcoming" and "Cancelled"
  - [ ] Class A shows in card format when "Cancelled" tab active

---

**Status**: ✅ COMPLETE - Ready to test
**Date**: December 19, 2025



