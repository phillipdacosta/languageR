# Payment Received Notification Feature

## Overview
Implemented real-time WebSocket notification for tutors when they receive payment after a lesson completes.

## Notification Details

### Message Format
```
"You earned ${{amount}} from your lesson on {{date}} with {{studentName}}"
```

### Example
```
"You earned $6.38 from your lesson on Dec 31, 2024 with Sarah M."
```

## Implementation

### Backend Changes

#### 1. Payment Service (`backend/services/paymentService.js`)

**Added Notification Model Import:**
```javascript
const Notification = require('../models/Notification');
```

**Updated Method Signature:**
```javascript
async completeLessonPayment(lessonId, io = null)
```
- Added optional `io` parameter for WebSocket instance

**Added Notification Logic:**
After successful Stripe Connect transfer:
```javascript
// Create notification in database
const notification = new Notification({
  userId: lesson.tutorId._id,
  type: 'payment_received',
  title: '💰 Payment Received',
  message: `You earned $${tutorPayout.toFixed(2)} from your lesson on ${lessonDate} with ${studentName}`,
  data: {
    lessonId: lessonId.toString(),
    paymentId: payment._id.toString(),
    amount: tutorPayout,
    studentName,
    lessonDate
  }
});
await notification.save();

// Send real-time WebSocket notification
if (io) {
  const { getUserSocketId } = require('../socket/socketManager');
  const tutorSocketId = await getUserSocketId(lesson.tutorId.auth0Id);
  
  if (tutorSocketId) {
    io.to(tutorSocketId).emit('payment_received', {
      notificationId: notification._id.toString(),
      title: notification.title,
      message: notification.message,
      amount: tutorPayout,
      lessonId: lessonId.toString(),
      studentName,
      lessonDate
    });
  }
}
```

**Error Handling:**
- Notification failures don't fail the payment
- Gracefully handles offline tutors (notification saved for later)

#### 2. Lessons Routes (`backend/routes/lessons.js`)

Updated both `call-end` and `leave-beacon` endpoints to pass `req.io`:

**Before:**
```javascript
await paymentService.completeLessonPayment(lesson._id);
```

**After:**
```javascript
await paymentService.completeLessonPayment(lesson._id, req.io); // Pass io for notifications
```

### Frontend Changes

#### WebSocket Service (`language-learning-app/src/app/services/websocket.service.ts`)

Added listener for `payment_received` event:
```typescript
// Listen for payment received notifications (tutors only)
this.socket.on('payment_received', (data: any) => {
  console.log('💰 Payment received notification:', data);
  this.newNotificationSubject.next({
    ...data,
    type: 'payment_received',
    urgent: true // Show immediately
  });
});
```

**Key Features:**
- Marked as `urgent: true` for immediate display
- Automatically triggers notification badge update
- Appears in notification bell dropdown

## When Notification is Sent

### Trigger Event
Notification is sent **immediately after**:
1. ✅ Lesson completes (call ends)
2. ✅ Stripe Connect transfer succeeds
3. ✅ Tutor receives their payout

### Timing
```
Lesson Ends
    ↓
completeLessonPayment() called
    ↓
Stripe Transfer initiated
    ↓
Transfer succeeds ✅
    ↓
💰 NOTIFICATION SENT (real-time via WebSocket)
    ↓
Tutor sees: "You earned $X from your lesson..."
```

### States Where Notification is NOT Sent
- ❌ Tutor not onboarded to Stripe Connect (transfer status = 'pending')
- ❌ Stripe transfer fails (transfer status = 'failed')
- ❌ Lesson hasn't completed yet
- ❌ Payment not linked to lesson

## User Experience

### For Online Tutors
1. **Lesson ends** → Video call closes
2. **~5 seconds later** → Notification bell lights up (red dot)
3. **Tutor clicks bell** → Sees "💰 Payment Received" at top
4. **Tutor reads**: "You earned $6.38 from your lesson on Dec 31, 2024 with Sarah M."
5. **Tutor clicks notification** → (Future: Navigate to earnings page)

### For Offline Tutors
1. **Lesson ends** while tutor is offline
2. **Payment processes** → Notification saved to database
3. **Tutor logs in later** → Sees notification in bell dropdown
4. **Notification persists** until tutor marks it as read

## Notification Data Structure

### Database (Notification Model)
```javascript
{
  userId: ObjectId("..."),              // Tutor's MongoDB ID
  type: 'payment_received',             // Notification type
  title: '💰 Payment Received',         // Display title
  message: 'You earned $6.38 from...', // Full message
  data: {
    lessonId: '...',
    paymentId: '...',
    amount: 6.38,
    studentName: 'Sarah M.',
    lessonDate: 'Dec 31, 2024'
  },
  read: false,                          // Unread by default
  createdAt: Date(),
  updatedAt: Date()
}
```

### WebSocket Event
```javascript
{
  notificationId: '...',
  title: '💰 Payment Received',
  message: 'You earned $6.38 from your lesson on Dec 31, 2024 with Sarah M.',
  amount: 6.38,
  lessonId: '...',
  studentName: 'Sarah M.',
  lessonDate: 'Dec 31, 2024',
  type: 'payment_received',
  urgent: true
}
```

## Edge Cases Handled

### 1. Tutor Not Onboarded to Stripe
- Transfer status = 'pending'
- **No notification sent** (tutor hasn't earned money yet)
- Tutor will see earnings as "pending" in earnings page

### 2. Stripe Transfer Fails
- Transfer status = 'failed'
- **No notification sent** (payment didn't succeed)
- Error logged for manual review

### 3. Tutor Offline
- Notification saved to database ✅
- WebSocket message not sent (no socket connection)
- Tutor sees notification when they log in later ✅

### 4. Notification Creation Fails
- Error caught and logged ❌
- **Payment still succeeds** ✅ (critical path not affected)
- Tutor can still see earnings in earnings page

### 5. Multiple Lessons Complete Simultaneously
- Each lesson triggers separate notification
- Tutors see multiple "Payment Received" notifications
- Each notification links to specific lesson

## Testing Checklist

- [x] Backend: Notification created after successful transfer
- [x] Backend: WebSocket event sent to online tutors
- [x] Backend: Offline tutors get notification saved to DB
- [ ] Frontend: Notification appears in bell dropdown
- [ ] Frontend: Notification badge updates (red dot)
- [ ] Frontend: Clicking notification navigates to earnings page (future)
- [ ] Frontend: Notification shows correct amount, date, student name
- [ ] Edge Case: No notification if transfer fails
- [ ] Edge Case: No notification if tutor not onboarded
- [ ] Edge Case: Payment succeeds even if notification fails

## Future Enhancements

### 1. Clickable Notification
- Click notification → Navigate to `/tabs/profile` (earnings section)
- Show specific payment details

### 2. Sound/Vibration
- Add sound effect when payment received (cash register sound? 💰)
- Haptic feedback on mobile

### 3. Push Notifications
- Send push notification to offline tutors
- "You earned $X! Check your earnings."

### 4. Earnings Summary
- Weekly earnings notification (e.g., Friday)
- "This week you earned $250 from 10 lessons"

### 5. Milestone Notifications
- "Congratulations! You've earned $1,000 total!"
- "You completed 100 lessons!"

## Related Files

### Backend
- `backend/services/paymentService.js` - Main payment logic + notification creation
- `backend/routes/lessons.js` - Lesson completion endpoints
- `backend/models/Notification.js` - Notification schema

### Frontend
- `language-learning-app/src/app/services/websocket.service.ts` - WebSocket listener
- `language-learning-app/src/app/tabs/tabs.page.ts` - Notification display logic

## Notes
- Notification is sent **only after successful Stripe transfer**
- Payment amount shown is **tutor payout** (after platform fee)
- Student name is formatted as "FirstName L." for privacy
- Date is formatted as "Month Day, Year" (e.g., "Dec 31, 2024")
- Notification type: `payment_received` (can be used for filtering/styling)

