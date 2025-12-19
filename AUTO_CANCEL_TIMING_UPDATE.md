# Auto-Cancel Timing Update

## Change Summary
Updated the class auto-cancel timing from **1 hour** before class start to **2.5 hours** before class start.

## Details

### Previous Behavior
- Classes were auto-cancelled if minimum enrollment wasn't met **1 hour** before start time
- Time window: 55-65 minutes before class start
- Example: Class at 12:00 PM → Auto-cancel check at 11:00 AM

### New Behavior
- Classes are now auto-cancelled if minimum enrollment isn't met **2.5 hours** before start time
- Time window: 145-155 minutes before class start (2h 25m to 2h 35m)
- Example: Class at 12:00 PM → Auto-cancel check at **9:30 AM**

## Technical Changes

**File**: `backend/jobs/autoCancelClasses.js`

**Changes Made**:
1. Updated time window from 55-65 minutes to 145-155 minutes
2. Updated comments to reflect "2.5 hours before" instead of "1 hour before"
3. Updated console log messages to show "145-155 minutes (2.5 hours)"

```javascript
// Before:
const fiftyFiveMinutesFromNow = new Date(now.getTime() + 55 * 60 * 1000);
const sixtyFiveMinutesFromNow = new Date(now.getTime() + 65 * 60 * 1000);

// After:
const oneHundredFortyFiveMinutesFromNow = new Date(now.getTime() + 145 * 60 * 1000);
const oneHundredFiftyFiveMinutesFromNow = new Date(now.getTime() + 155 * 60 * 1000);
```

## Testing

### To Test Auto-Cancel:
1. Create a class with `flexibleMinimum: false` and minimum students > 0
2. Set class start time to be exactly **2.5 hours from now** (e.g., if it's 9:30 AM, set class for 12:00 PM)
3. Don't enroll enough students to meet the minimum
4. Wait for the cron job to run (runs every 10 minutes)
5. Class should be auto-cancelled when the job runs

### Example Timeline:
- **9:25 AM**: Class scheduled for 12:00 PM with min 2 students, only 1 enrolled
- **9:30 AM**: Cron job runs → Class is in the 145-155 minute window → Auto-cancelled ✅
- **9:40 AM**: Cron job runs → Class already cancelled, skipped

## Background Job
The auto-cancel job runs **every 10 minutes** as configured in `server.js`:

```javascript
cron.schedule('*/10 * * * *', async () => {
  autoCancelClasses(io, connectedUsers).catch(err => {
    console.error('❌ [Cron] Error in autoCancelClasses:', err);
  });
});
```

## Files Modified
- `backend/jobs/autoCancelClasses.js`

## Status
✅ Complete - Backend must be restarted for changes to take effect

