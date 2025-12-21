# Auto-Cancel UI Fixes - Issues and Solutions

## Issues Identified

### 1. Tab1 (Tutor Home) - Cancelled View Switches to Timeline
**Problem**: When clicking the "Cancelled" tab, cancelled classes are shown in timeline view format instead of keeping the "Upcoming Lessons" card format.

**Expected Behavior**: Cancelled classes should display in the SAME format as they were shown before cancellation (i.e., in the "Upcoming Lessons" card section with the cancelled badge).

**Root Cause**: The `lessonView` toggle between 'upcoming' and 'cancelled' is likely rendering cancelled lessons in a different section/format (timeline) rather than just filtering which lessons to show in the same "Upcoming Lessons" section.

**Solution**: 
- Keep the same card UI for both upcoming and cancelled views
- Only difference should be the status badge and styling
- Don't switch to timeline view just for cancelled lessons

### 2. Tutor Calendar - Cancelled Classes Disappear
**Problem**: When a class is auto-cancelled, it briefly appears on the calendar then disappears. The calendar is filtering out cancelled classes.

**Expected Behavior**: Cancelled classes should ALWAYS remain visible on the calendar but with crossed-out styling to indicate cancellation.

**Root Cause**: The calendar is likely filtering out events where `status === 'cancelled'` OR `isCancelled === true`.

**Locations to Fix**:
1. `tutor-calendar.page.ts` - Check `convertClassesToEvents()` or similar methods
2. `tutor-calendar.page.ts` - Check if there's filtering in `build*()` methods that exclude cancelled
3. Look for filters like: `.filter(event => event.status !== 'cancelled')`

**Solution**:
- Keep cancelled classes in the events array
- Ensure `isCancelled` property is set correctly
- The HTML already has styling for `is-cancelled` class (crossed-out text)
- Just need to ensure cancelled events aren't filtered out

## Testing Approach

### Create Manual Test Button

Add a test button to manually trigger auto-cancel for a specific class without waiting for cron:

**Backend**: Add test endpoint in `backend/routes/classes.js`:

```javascript
// TEST ENDPOINT - Manually trigger auto-cancel for a class
router.post('/:classId/test-auto-cancel', verifyToken, async (req, res) => {
  try {
    const { classId } = req.params;
    const { autoCancelClasses } = require('../jobs/autoCancelClasses');
    
    // Get the class
    const cls = await ClassModel.findById(classId);
    if (!cls) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    
    // Manually cancel it (simulate auto-cancel)
    cls.status = 'cancelled';
    cls.cancelledAt = new Date();
    cls.cancelReason = 'minimum_not_met';
    await cls.save();
    
    // Run the auto-cancel notifications/cleanup
    const { io, connectedUsers } = req;
    await autoCancelClasses(io, connectedUsers);
    
    res.json({ success: true, message: 'Class manually cancelled for testing' });
  } catch (error) {
    console.error('Error in test auto-cancel:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});
```

**Frontend**: Add test button in tab1.page.html (dev mode only):

```html
<!-- DEV TEST BUTTON -->
<ion-button 
  *ngIf="currentUser?.userType === 'tutor'" 
  color="danger" 
  (click)="testAutoCancelClass()"
  style="position: fixed; bottom: 80px; right: 20px; z-index: 9999;">
  TEST Auto-Cancel
</ion-button>
```

**Frontend**: Add method in tab1.page.ts:

```typescript
async testAutoCancelClass() {
  // Find first upcoming class
  const upcomingClass = this.lessons.find((l: any) => l.isClass && l.status === 'scheduled');
  if (!upcomingClass) {
    const toast = await this.toastController.create({
      message: 'No upcoming classes to test',
      duration: 2000
    });
    await toast.present();
    return;
  }
  
  const classId = (upcomingClass as any)._id;
  console.log('Testing auto-cancel for class:', classId);
  
  // Call test endpoint
  try {
    const response = await fetch(`http://localhost:3000/api/classes/${classId}/test-auto-cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${await this.authService.getToken()}`,
        'Content-Type': 'application/json'
      }
    });
    
    const result = await response.json();
    console.log('Test auto-cancel result:', result);
    
    const toast = await this.toastController.create({
      message: result.message || 'Test triggered',
      duration: 2000
    });
    await toast.present();
  } catch (error) {
    console.error('Test auto-cancel error:', error);
  }
}
```

## Files to Modify

### Tab1 (Tutor Home) Fixes
1. **tab1.page.html** - Ensure cancelled view uses same card layout as upcoming
2. **tab1.page.ts** - Verify `switchLessonView()` method doesn't change layout
3. **tab1.page.scss** - Ensure cancelled cards have proper styling

### Tutor Calendar Fixes
1. **tutor-calendar.page.ts**:
   - Find where classes are converted to events
   - Remove any filter that excludes cancelled classes
   - Ensure `isCancelled` property is set on events

2. **tutor-calendar.page.html**:
   - Already has `[class.is-cancelled]` binding
   - Already has crossed-out styling

3. **tutor-calendar.page.scss**:
   - Verify `.is-cancelled` has `text-decoration: line-through`

## Next Steps

1. Locate the exact code in tab1 that switches to timeline for cancelled
2. Locate the exact filter in tutor-calendar that removes cancelled events  
3. Apply fixes
4. Add test button for easier iteration
5. Test the complete flow

## Success Criteria

- [ ] Cancelled classes stay in "Upcoming Lessons" card format (not timeline)
- [ ] Cancelled classes show "Cancelled" badge
- [ ] Cancelled classes show cancel reason
- [ ] Cancelled classes remain visible on tutor calendar
- [ ] Cancelled classes show crossed-out styling on calendar
- [ ] WebSocket updates work in real-time
- [ ] No page refresh needed to see changes


