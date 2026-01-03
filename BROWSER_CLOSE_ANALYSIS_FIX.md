# Browser Close Analysis Generation Fix

## Problem
When a tutor ended a lesson by closing the browser/tab, the student never received their lesson analysis. This happened because:

1. **Browser close** triggered `beforeunload` event
2. `beforeunload` sent a `leave-beacon` to notify the other participant
3. **But `leave-beacon` did NOT finalize the lesson or generate analysis**
4. Student was left waiting on the analysis page forever

## Root Cause
The `leave-beacon` endpoint (`/api/lessons/:id/leave-beacon`) only:
- Recorded that the user left
- Emitted a WebSocket event to notify the other participant
- **Did NOT call `call-end` logic** (finalize lesson, generate analysis)

This is different from the early-exit modal flow, which explicitly calls the `call-end` endpoint.

## Solution
Updated the `leave-beacon` endpoint to include the same finalization logic as `call-end`:

### Added to `/backend/routes/lessons.js` (line ~1886)

```javascript
// 🚨 CRITICAL FIX: Finalize lesson when user closes browser
// If the lesson has started but not ended, finalize it now
if (lesson.actualCallStartTime && !lesson.actualCallEndTime) {
  console.log('🔚 Finalizing lesson from browser close...');
  const now = new Date();
  lesson.actualCallEndTime = now;
  
  // Calculate actual duration
  const durationMs = now - new Date(lesson.actualCallStartTime);
  const actualMinutes = Math.ceil(durationMs / (1000 * 60));
  lesson.actualDurationMinutes = actualMinutes;
  
  // Calculate actual price (for office hours)
  if (lesson.isOfficeHours) {
    const tutor = await User.findById(lesson.tutorId);
    const standardRate = tutor?.onboardingData?.hourlyRate || 25;
    const perMinuteRate = standardRate / 50;
    const calculatedPrice = Math.round(perMinuteRate * actualMinutes * 100) / 100;
    lesson.actualPrice = calculatedPrice;
    lesson.billingStatus = 'charged';
  } else {
    lesson.actualPrice = lesson.price;
    lesson.billingStatus = 'charged';
  }
  
  // Mark as completed
  lesson.status = 'completed';
  await lesson.save();
  
  // Notify other participant
  const otherParticipant = isTutor ? lesson.studentId : lesson.tutorId;
  const otherSocketId = await getUserSocketId(otherParticipant.auth0Id);
  
  if (otherSocketId && req.io) {
    req.io.to(otherSocketId).emit('lesson_ended_by_participant', {
      lessonId: lesson._id.toString(),
      endedBy: userRole,
      endedByName,
      message: `${endedByName} has ended the lesson.`,
      actualDuration: actualMinutes,
      scheduledDuration: lesson.duration
    });
  }
  
  // Trigger AI analysis generation (3 seconds later)
  setTimeout(async () => {
    // ... analysis generation logic ...
  }, 3000);
}
```

## Flows Now Supported

### 1. Normal End (Both Click "End Lesson")
✅ Calls `call-end` endpoint
✅ Finalizes lesson
✅ Generates analysis
✅ Both users see analysis page (student) or home (tutor)

### 2. Early Exit via Modal
✅ Calls `call-end` endpoint
✅ Finalizes lesson
✅ Generates analysis
✅ Navigation is role-based

### 3. Browser Close/Tab Close (NEW FIX)
✅ Calls `leave-beacon` endpoint
✅ **Now finalizes lesson** 🎉
✅ **Now generates analysis** 🎉
✅ Other participant sees notification and can view analysis

## Testing
To test the fix:
1. Start a lesson as tutor and student
2. As tutor: Close the browser tab/window (don't click "End Lesson")
3. As student: Should receive notification that tutor left
4. Student should see analysis page with generated analysis (after ~3 seconds)

## Files Modified
- `backend/routes/lessons.js` - Added lesson finalization logic to `leave-beacon` endpoint

---
**Date**: December 31, 2025  
**Fix Priority**: CRITICAL - Affects all lessons where tutor/student closes browser

