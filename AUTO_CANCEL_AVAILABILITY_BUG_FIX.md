# Auto-Cancel Availability Restoration Bug Fix

## Issue
When a class was auto-cancelled by the cron job, the availability block was **not being removed** from the tutor's calendar in the database, even though the code appeared to be correct. The tutor's calendar would show the time as "red" (blocked) even after refreshing the page.

## Root Cause
The bug was in the `removeClassAvailability()` function in `backend/jobs/autoCancelClasses.js`.

### The Problem
On line 31 of `autoCancelClasses()`, the Class is queried with `.populate('tutorId', ...)`:

```javascript
const classes = await Class.find({...})
  .populate('tutorId', 'name email firstName lastName auth0Id')
  .populate('confirmedStudents', 'name email firstName lastName auth0Id');
```

This means `classItem.tutorId` becomes a **full User object**, not just an ID.

However, in the `removeClassAvailability()` function, the code was trying to use this populated object directly:

```javascript
const tutor = await User.findById(classItem.tutorId); // ❌ WRONG
```

When you pass a full object to `findById()`, it tries to convert the object to a string and use it as the ID, which fails and returns `null`. The check for `if (!tutor)` would then cause the function to return early, **never removing the availability block**.

## The Fix

Updated `removeClassAvailability()` to handle both populated and unpopulated `tutorId`:

```javascript
async function removeClassAvailability(classItem) {
  try {
    // classItem.tutorId might be populated (an object) or just an ID
    // Handle both cases
    const tutorId = classItem.tutorId._id || classItem.tutorId;
    const tutor = await User.findById(tutorId);
    
    if (!tutor) {
      console.error(`❌ [AUTO-CANCEL] Tutor not found for class ${classItem._id}`);
      return;
    }
    
    console.log(`🔍 [AUTO-CANCEL] Found tutor ${tutor.name} (${tutor._id}), checking ${tutor.availability.length} availability slots`);
    
    // Remove the availability block that matches this class
    const classIdStr = classItem._id.toString();
    const initialAvailabilityLength = tutor.availability.length;
    
    // Log all class-type blocks before filtering (for debugging)
    const classBlocks = tutor.availability.filter(slot => slot.type === 'class');
    console.log(`🔍 [AUTO-CANCEL] Found ${classBlocks.length} class-type blocks before removal`);
    classBlocks.forEach(block => {
      console.log(`   - Class block ID: ${block.id}, Title: ${block.title}, Match: ${block.id === classIdStr}`);
    });
    
    tutor.availability = tutor.availability.filter(
      slot => !(slot.id === classIdStr && slot.type === 'class')
    );
    
    const removedCount = initialAvailabilityLength - tutor.availability.length;
    
    if (removedCount > 0) {
      await tutor.save();
      console.log(`✅ [AUTO-CANCEL] Removed ${removedCount} availability block(s) for class "${classItem.name}" (ID: ${classIdStr}) from tutor ${tutor.name}'s calendar`);
    } else {
      console.log(`⚠️ [AUTO-CANCEL] No availability block found for class "${classItem.name}" (ID: ${classIdStr}) in tutor ${tutor.name}'s calendar`);
      console.log(`⚠️ [AUTO-CANCEL] This might mean the block was already removed or never created`);
    }
  } catch (error) {
    console.error(`❌ [AUTO-CANCEL] Error removing class availability:`, error);
    console.error(`❌ [AUTO-CANCEL] Stack trace:`, error.stack);
  }
}
```

### Key Changes:
1. **Extract the actual ID:** `const tutorId = classItem.tutorId._id || classItem.tutorId;`
   - If `tutorId` is populated (an object), use `._id`
   - If `tutorId` is just an ID, use it directly

2. **Enhanced logging:** Added detailed console logs to help debug future issues:
   - Log tutor name and availability count
   - List all class-type blocks before removal
   - Show which block matches the class ID
   - Include class ID in success/warning messages
   - Add stack traces to errors

## Testing

### Before the Fix:
1. Class gets auto-cancelled ✅
2. Notifications sent ✅
3. WebSocket events emitted ✅
4. **Availability block NOT removed** ❌
5. Tutor calendar still shows time as "red/blocked" ❌

### After the Fix:
1. Class gets auto-cancelled ✅
2. Notifications sent ✅
3. WebSocket events emitted ✅
4. **Availability block IS removed** ✅
5. Tutor calendar shows time as "available" after refresh ✅

### How to Test:
1. Create a class with `flexibleMinimum: false` and `minStudents: 2`
2. Set start time to exactly 2.5 hours from now
3. Don't invite any students (0 confirmed students)
4. Wait for the cron job to run (~every 10 minutes)
5. Check the backend logs for:
   ```
   🔍 [AUTO-CANCEL] Found tutor {name} ({id}), checking {N} availability slots
   🔍 [AUTO-CANCEL] Found {N} class-type blocks before removal
      - Class block ID: {id}, Title: {title}, Match: true
   ✅ [AUTO-CANCEL] Removed 1 availability block(s) for class "{name}" (ID: {id}) from tutor {name}'s calendar
   ```
6. Refresh the tutor's calendar page
7. **Verify:** The time slot is now green/available (not red/blocked)

## Impact

This fix ensures that when classes are auto-cancelled:
- ✅ Time slots are immediately returned to the tutor's availability
- ✅ Tutors can receive new bookings for those times
- ✅ The calendar accurately reflects available times after a page refresh
- ✅ No manual database cleanup is required

## Files Modified

- `backend/jobs/autoCancelClasses.js`
  - Fixed `removeClassAvailability()` function to handle populated tutorId
  - Added enhanced logging for debugging

## Related Documentation

- `CLASS_AVAILABILITY_RESTORATION.md` - Original implementation
- `AUTO_CANCEL_TIMING_UPDATE.md` - Auto-cancel timing (2.5 hours)

## Notes

- **Manual cancellation** (via the DELETE route) doesn't have this issue because it doesn't populate the tutorId
- The enhanced logging will help diagnose any future issues with availability restoration
- The fix is backwards compatible - works whether tutorId is populated or not

