# Auto-Cancel Timing Update - 15 Minutes ⏰

## Change Summary

Updated the auto-cancel timing from **16 minutes** to **15 minutes** before class start.

## What Changed

### File: `backend/jobs/autoCancelClasses.js`

**Before (16 minutes):**
```javascript
const elevenMinutesFromNow = new Date(now.getTime() + 11 * 60 * 1000); // 11 min
const twentyOneMinutesFromNow = new Date(now.getTime() + 21 * 60 * 1000); // 21 min

// Checks classes starting between 11-21 minutes from now (~16 min window)
```

**After (15 minutes):**
```javascript
const tenMinutesFromNow = new Date(now.getTime() + 10 * 60 * 1000); // 10 min
const twentyMinutesFromNow = new Date(now.getTime() + 20 * 60 * 1000); // 20 min

// Checks classes starting between 10-20 minutes from now (~15 min window)
```

### Comments Updated:
- Line 7: `Runs 15 minutes before class start time` (was 16)
- Line 20: `Start between 10-20 minutes from now (cancel at ~15 minute mark)` (was 11-21, ~16)
- Line 34: `Found ${classes.length} scheduled classes in the next 10-20 minutes (~15 min window)` (was 11-21, ~16)

## How It Works

The cron job runs **every 10 minutes** and checks for classes in a **10-minute window**:

### Timeline Example:
```
Current Time: 12:00 PM
Cron runs every 10 minutes: 12:00, 12:10, 12:20, 12:30...

At 12:00 PM:
- Checks classes starting between 12:10 PM - 12:20 PM
- If class at 12:15 PM doesn't have min students → cancel
- Result: Cancelled ~15 minutes before (12:15 - 12:00 = 15 min)

At 12:10 PM:
- Checks classes starting between 12:20 PM - 12:30 PM
- If class at 12:25 PM doesn't have min students → cancel
- Result: Cancelled ~15 minutes before (12:25 - 12:10 = 15 min)
```

### Why This Window Works:
- **10-20 minute window** = catches classes ~15 minutes before start
- **Cron runs every 10 minutes** = ensures classes are caught within the window
- **Cancels at ~15 minutes** = gives students advance notice but not too early

## Testing

### Manual Test with Test Button:
The test button on the calendar **immediately cancels** any class, regardless of timing. This is for frontend testing only.

### Cron Job Test (Live):
1. **Create a class** with start time exactly 15 minutes in the future
2. **Don't enroll minimum students**
3. **Wait for next cron run** (runs every 10 minutes)
4. **Verify**: Class should be auto-cancelled within the next 10 minutes

Example:
```
Current: 12:00 PM
Class:   12:15 PM (15 min away)
Next cron: 12:10 PM
Result: Will NOT cancel at 12:00 (too early, not in 10-20 min window)
        Will cancel at 12:10 (now 5 min away, was 15 min when cron checked... wait, no)

Actually:
Current: 12:00 PM
Class:   12:15 PM
Window:  12:10-12:20
Result: Class at 12:15 IS in window → Cancel now (at 12:00)
        15 minutes before class start ✅
```

### Precise Test:
```
1. Current time: 12:00:00 PM
2. Create class: 12:15:00 PM (exactly 15 min away)
3. Cron runs at: 12:00:00 PM
4. Window check: 12:10:00 - 12:20:00
5. Class at 12:15:00 IS in window
6. Result: Cancel immediately ✅
```

## Backend Logs

After restart, you should see:
```
📊 [AUTO-CANCEL] Found X scheduled classes in the next 10-20 minutes (~15 min window)
```

Changed from:
```
📊 [AUTO-CANCEL] Found X scheduled classes in the next 11-21 minutes (~16 min window)
```

## Timeline History

### Initial Implementation:
- **145-155 minutes** (2.5 hours before) - Too early

### First Update:
- **25-35 minutes** (30 minutes before) - For easier testing

### Second Update:
- **11-21 minutes** (16 minutes before) - For easier testing

### Current (Final):
- **10-20 minutes** (15 minutes before) - Production setting ✅

## Cron Schedule

The cron job runs **every 10 minutes**:
```javascript
cron.schedule('*/10 * * * *', () => {
  autoCancelClasses(io, connectedUsers);
});
```

This means:
- 12:00 PM
- 12:10 PM
- 12:20 PM
- 12:30 PM
- etc.

Combined with the 10-20 minute window, this ensures classes are cancelled approximately 15 minutes before start time.

## Why 15 Minutes?

**Benefits**:
1. **Not too early** - Students can still enroll up to 15 minutes before
2. **Not too late** - Gives students time to see cancellation before heading to class
3. **Reasonable window** - Enough time for notifications to be seen
4. **Industry standard** - Many platforms cancel 15-30 minutes before

**Comparison**:
- Too early (1+ hour): Students might still want to enroll
- Too late (5 min): Not enough notice for students
- 15 minutes: Sweet spot ✅

---

**Status**: ✅ Updated to 15 minutes
**Backend**: Restarted with new timing
**Date**: December 19, 2025



