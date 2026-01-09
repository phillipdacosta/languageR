# Auto-Cancel Class Testing Guide

## Quick Testing Steps (30 Minutes)

### Prerequisites
- Backend server running with cron jobs enabled
- Tutor account logged in
- Student account available
- Backend logs accessible for monitoring

### Test Scenario 1: Basic Auto-Cancel Flow

#### 1. Create Test Class (as Tutor)
```
Time: Set start time to 35 minutes from now
Name: "Test Auto-Cancel Class"
Min Students: 2
Max Students: 5
Flexible Minimum: OFF (unchecked)
```

#### 2. Invite Only 1 Student
- Invite a student to the class
- Have that student accept (or leave as pending)
- Class now has only 1 confirmed student (below minimum of 2)

#### 3. Monitor and Wait
- Keep tutor home page open (do NOT refresh)
- Keep tutor calendar page open in another tab (do NOT refresh)
- Watch backend logs for auto-cancel check messages
- Wait for ~30 minutes

#### 4. What to Expect at ~30 Minutes Before Start

**Backend Logs Should Show**:
```
🔍 [AUTO-CANCEL] Checking for classes to auto-cancel...
📊 [AUTO-CANCEL] Found 1 scheduled classes in the next 25-35 minutes
🔍 [AUTO-CANCEL] Class "Test Auto-Cancel Class": 1/2 students
❌ [AUTO-CANCEL] Cancelling class - only 1/2 students enrolled
✅ [AUTO-CANCEL] Removed availability block(s) from tutor calendar
📧 [AUTO-CANCEL] Notified tutor about cancellation
🔔 [AUTO-CANCEL] WebSocket notification sent to tutor
```

**Tutor Home Page (NO REFRESH NEEDED)**:
- ✅ Toast notification appears: "Your class has been auto-cancelled..."
- ✅ View automatically switches to "Cancelled" tab
- ✅ Class appears in cancelled section with "Cancelled" badge
- ✅ Cancel reason shows: "Cancelled due to insufficient enrollment"
- ✅ Class is removed from "Upcoming Lessons" section

**Tutor Calendar Page (NO REFRESH NEEDED)**:
- ✅ Toast notification appears
- ✅ Class still visible on calendar
- ✅ Class shows crossed-out styling
- ✅ Class has grey appearance (not purple)
- ✅ Class title may show "(Cancelled)"

**Student Views (NO REFRESH NEEDED)**:
- ✅ Toast notification appears: "The class has been cancelled..."
- ✅ Invitation/enrollment status updates

#### 5. Verify Availability Freed
- As a different student (or same student after refresh)
- Go to tutor availability viewer
- ✅ Refresh the page
- ✅ Time slot should now show as available
- ✅ Student can book that time slot

---

### Test Scenario 2: Class with Enough Students (Should NOT Cancel)

#### 1. Create Test Class (as Tutor)
```
Time: Set start time to 35 minutes from now
Name: "Test No Cancel Class"
Min Students: 2
Max Students: 5
Flexible Minimum: OFF
```

#### 2. Invite 2+ Students
- Invite 2 or more students
- Have them accept the invitations
- Class now meets minimum requirement

#### 3. Wait and Verify
- Wait for ~30 minutes
- ✅ Class should NOT be cancelled
- ✅ No notifications sent
- ✅ Class remains in upcoming lessons
- ✅ Class stays on calendar (purple, not crossed out)

---

### Test Scenario 3: Flexible Minimum Class (Should NOT Cancel)

#### 1. Create Test Class (as Tutor)
```
Time: Set start time to 35 minutes from now
Name: "Test Flexible Class"
Min Students: 2
Max Students: 5
Flexible Minimum: ON (checked)
```

#### 2. Invite Only 1 Student
- Have only 1 student accept
- Class has fewer than minimum students

#### 3. Wait and Verify
- Wait for ~30 minutes
- ✅ Class should NOT be cancelled (flexible minimum allows it)
- ✅ No notifications sent
- ✅ Class remains in upcoming lessons

---

## Quick 5-Minute Test (For Faster Testing)

To test without waiting 30 minutes, temporarily modify the timing:

### Backend Change (Temporary)
Edit `backend/jobs/autoCancelClasses.js`:

```javascript
// Change from:
const twentyFiveMinutesFromNow = new Date(now.getTime() + 25 * 60 * 1000);
const thirtyFiveMinutesFromNow = new Date(now.getTime() + 35 * 60 * 1000);

// To (for 5 minute window):
const twentyFiveMinutesFromNow = new Date(now.getTime() + 3 * 60 * 1000);  // 3 min
const thirtyFiveMinutesFromNow = new Date(now.getTime() + 7 * 60 * 1000);   // 7 min
```

### Test Steps
1. Create class starting in 7 minutes from now
2. Invite only 1 student (min is 2)
3. Wait 5 minutes
4. Cron job will cancel the class
5. Verify all UI updates happen without refresh

**IMPORTANT**: Change the timing back to 25-35 minutes after testing!

---

## Troubleshooting

### Auto-Cancel Not Triggering
**Check**:
- Cron job is running (check backend logs every 10 minutes)
- Class start time is in the 25-35 minute window
- Class status is 'scheduled' (not already cancelled/completed)
- `flexibleMinimum` is `false`
- Confirmed students count < minStudents

### WebSocket Not Working
**Check**:
- Browser console for WebSocket connection errors
- User is logged in and authenticated
- Backend WebSocket server is running
- connectedUsers map has the user's auth0Id

### Toast Not Appearing
**Check**:
- Browser console for errors
- Toast controller is working
- Page is in foreground (some browsers pause background tabs)

### Cancelled Tab Not Showing Class
**Check**:
- `loadLessons()` was called after notification
- Class status in database is 'cancelled'
- Class has recent/future start time (within last 7 days)

### Calendar Not Updating
**Check**:
- `refreshCalendar()` was called
- Calendar page is listening to WebSocket notifications
- Class data includes cancelled status

---

## Expected Timeline

```
T-35 min: Create class (start time set to T+35)
T-30 min: Cron job triggers, class auto-cancelled
T-30 min: WebSocket notifications sent
T-30 min: UI updates in real-time (no refresh)
T-30 min: Availability blocks freed
T-29 min: Students can see freed slots (after refresh)
```

---

## Backend Logs to Monitor

### Successful Auto-Cancel
```
🔍 [AUTO-CANCEL] Checking for classes to auto-cancel...
📊 [AUTO-CANCEL] Found 1 scheduled classes in the next 25-35 minutes
🔍 [AUTO-CANCEL] Class "Test Class": 1/2 students
❌ [AUTO-CANCEL] Cancelling class - only 1/2 students enrolled
🔍 [AUTO-CANCEL] Found tutor John Doe
✅ [AUTO-CANCEL] Removed 1 availability block(s)
📧 [AUTO-CANCEL] Notified tutor John Doe about cancellation
🔔 [AUTO-CANCEL] WebSocket notification sent to tutor
📧 [AUTO-CANCEL] Notified student Jane Smith about cancellation
🔔 [AUTO-CANCEL] WebSocket notification sent to student
✅ [AUTO-CANCEL] Auto-cancelled 1 classes
```

### No Classes to Cancel
```
🔍 [AUTO-CANCEL] Checking for classes to auto-cancel...
📊 [AUTO-CANCEL] Found 0 scheduled classes in the next 25-35 minutes
✅ [AUTO-CANCEL] Auto-cancelled 0 classes
```

---

## Success Criteria

✅ **Must Have** (All Working):
- [ ] Class auto-cancels at 30 minutes before start
- [ ] Tutor home page updates without refresh
- [ ] Tutor home switches to "Cancelled" tab automatically
- [ ] Cancelled class appears in cancelled section
- [ ] Tutor calendar shows crossed-out class without refresh
- [ ] Toast notifications appear for tutor and students
- [ ] Availability blocks are freed
- [ ] Students can book freed slots after refresh

✅ **Nice to Have** (Already Working):
- [ ] Appropriate styling for cancelled classes
- [ ] Clear cancel reason displayed
- [ ] WebSocket real-time updates
- [ ] Proper logging for debugging

---

## Current Configuration

- **Auto-Cancel Window**: 30 minutes before class start (25-35 min range)
- **Cron Frequency**: Every 10 minutes
- **Min Delay Between Checks**: N/A (stateless)
- **Notification Types**: `class_auto_cancelled`, `class_invitation_cancelled`

---

## Rollback Plan

If issues occur, revert these files:
1. `backend/jobs/autoCancelClasses.js`
2. `language-learning-app/src/app/tab1/tab1.page.ts`
3. `language-learning-app/src/app/tutor-calendar/tutor-calendar.page.ts`

Use git to revert to previous commit:
```bash
git checkout HEAD~1 backend/jobs/autoCancelClasses.js
git checkout HEAD~1 language-learning-app/src/app/tab1/tab1.page.ts
git checkout HEAD~1 language-learning-app/src/app/tutor-calendar/tutor-calendar.page.ts
```




