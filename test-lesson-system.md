# Testing the Lesson Scheduling System

## What's Been Implemented

### Backend (Node.js/Express/MongoDB)
✅ **Lesson Model** (`backend/models/Lesson.js`)
- Stores lesson details, participants, timing, and Agora channel info
- Automatic channel name generation

✅ **Lesson Routes** (`backend/routes/lessons.js`)
- `POST /api/lessons` - Create lesson (called after checkout)
- `GET /api/lessons/my-lessons` - Get user's lessons
- `GET /api/lessons/:id` - Get lesson details
- `GET /api/lessons/:id/status` - Check if user can join (time window check)
- `POST /api/lessons/:id/join` - Secure join with time-gated Agora token generation
- `POST /api/lessons/:id/end` - Mark lesson as completed

✅ **Security Features**
- Time-gated access: Can only join 15 minutes before start time
- Short-lived Agora tokens (expires with lesson window)
- User authorization (only tutor/student can join their lesson)
- No pre-generated tokens stored in database

### Frontend (Angular/Ionic)
✅ **Lesson Service** (`src/app/services/lesson.service.ts`)
- Complete API integration
- Helper methods for time calculations and UI states

✅ **Enhanced Checkout** (`src/app/checkout/checkout.page.ts`)
- Creates lesson in database when user confirms booking
- Integrated with existing tutor selection flow

✅ **Agora Integration** (`src/app/services/agora.service.ts`)
- New `joinLesson()` method that gets secure tokens from backend
- Automatic cleanup and user-friendly error messages

✅ **Lessons Page** (`src/app/lessons/lessons.page.ts`)
- Lists all user's lessons (past and upcoming)
- Real-time join button that enables 15 minutes before lesson
- Countdown timers and status indicators
- Direct integration with video call page

## How to Test

### 1. Start the Backend
```bash
cd /Users/phillipdacosta/language-app/backend
npm start
```

### 2. Start the Frontend
```bash
cd /Users/phillipdacosta/language-app/language-learning-app
ionic serve
```

### 3. Book a Lesson
1. Log in as a student
2. Go to "Find Tutors" 
3. Select a tutor and click "View profile"
4. Click on an available time slot
5. Complete checkout - this creates the lesson in the database

### 4. View Your Lessons
- Navigate to `/lessons` to see your booked lessons
- The "Join Lesson" button will be disabled until 15 minutes before start time

### 5. Test Time-Gated Access
- Try to join early - you'll get a "Too early" message
- Wait until 15 minutes before lesson start - button becomes enabled
- Click "Join Lesson" - it will get a secure Agora token and start the video call

## Key Features

### Time-Based Security
- **15 minutes early access**: Students and tutors can join 15 minutes before lesson starts
- **5 minute grace period**: Can still join up to 5 minutes after lesson ends
- **Short-lived tokens**: Agora tokens expire with the lesson window
- **No permanent links**: Tokens are generated just-in-time, not stored

### User Experience
- **Real-time status**: Lesson cards show countdown timers and current status
- **Smart navigation**: Checkout → Lessons → Video Call flow
- **Error handling**: Clear messages for time restrictions and access issues
- **Responsive design**: Works on mobile and desktop

### Integration
- **Existing Agora setup**: Uses your current video call infrastructure
- **Auth0 integration**: Respects current user authentication
- **Database consistency**: Lessons are properly linked to tutors and students

## Testing Scenarios

1. **Happy Path**: Book lesson → Wait for time window → Join successfully
2. **Early Access**: Try to join before 15-minute window (should fail)
3. **Late Access**: Try to join after lesson + 5 minutes (should fail)
4. **Wrong User**: Try to access someone else's lesson (should fail)
5. **Network Issues**: Test error handling for API failures

## Next Steps (Optional Enhancements)

- **Email/Push Notifications**: Remind users 24h and 15min before lessons
- **Lesson Cancellation**: Allow users to cancel with refund policies
- **Recurring Lessons**: Support for weekly/monthly lesson series
- **Lesson Notes**: Post-lesson feedback and notes system
- **Calendar Integration**: Export lessons to Google Calendar/Outlook
