# 🎯 How to Start and Test Lessons

## ✅ Quick Setup Checklist

### 1. Backend Setup
```bash
cd /Users/phillipdacosta/language-app/backend
npm start
```
**✅ Fixed**: Added authentication middleware to all lesson endpoints

### 2. Frontend Setup
```bash
cd /Users/phillipdacosta/language-app/language-learning-app
ionic serve
```

### 3. Agora Configuration
- **App ID**: Already configured in environment
- **App Certificate**: You need to add this to `backend/config.env`
- Get your certificate from [Agora Console](https://console.agora.io/)

## 🚀 Complete Testing Flow

### Step 1: Book a Lesson
1. **Login** as a student (not tutor)
2. **Navigate** to "Find Tutors" (`/tabs/tutor-search`)
3. **Select a tutor** and click "View profile"
4. **Pick a time slot** from their availability calendar
5. **Complete checkout** - this creates the lesson in database

### Step 2: View Your Lessons
1. **Navigate to** `/lessons` (you can type this in the URL bar)
2. **See your booked lesson** with status "Scheduled"
3. **Notice the countdown** - "Available in X minutes"

### Step 3: Join the Lesson (Time-Gated)
**Option A: Test with Real Time**
- Wait until 15 minutes before your lesson time
- The "Join Lesson" button will become enabled
- Click it to start the video call

**Option B: Test with Modified Time (Quick Testing)**
- Book a lesson for a time that's within 15 minutes from now
- Or temporarily modify the time window in the backend

### Step 4: Video Call Experience
- **Automatic redirect** to `/video-call` page
- **Secure Agora token** generated just-in-time
- **Video/audio** should work with your existing setup

## 🔧 Quick Testing Modifications

### Test with Shorter Time Window (Optional)
Edit `/Users/phillipdacosta/language-app/backend/routes/lessons.js`:

```javascript
// Change these lines for testing:
const JOIN_EARLY_MINUTES = 1; // Instead of 15 minutes
const END_GRACE_MINUTES = 1;   // Instead of 5 minutes
```

### Test Lesson Creation Directly
You can also test lesson creation via the browser console:

```javascript
// In browser console on your app:
fetch('http://localhost:3000/api/lessons', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + localStorage.getItem('auth0_token') // or however you store the token
  },
  body: JSON.stringify({
    tutorId: '68ffaa55138f5b90d2a9e5d6', // Use a real tutor ID from your database
    studentId: 'your-student-id-here',
    startTime: new Date(Date.now() + 5 * 60000).toISOString(), // 5 minutes from now
    endTime: new Date(Date.now() + 65 * 60000).toISOString(),   // 1 hour 5 minutes from now
    subject: 'Test Lesson',
    price: 25,
    duration: 60
  })
})
.then(res => res.json())
.then(data => console.log('Lesson created:', data));
```

## 🎬 What Happens Behind the Scenes

### When You Book a Lesson:
1. **Checkout page** calls `POST /api/lessons`
2. **Lesson record** created in MongoDB with unique channel name
3. **Success message** and redirect to home/lessons page

### When You Try to Join:
1. **Frontend** calls `POST /api/lessons/:id/join`
2. **Backend checks**:
   - Is it the right time? (15 min before to 5 min after)
   - Are you authorized? (tutor or student of this lesson)
3. **If valid**: Generates fresh Agora token with lesson-specific channel
4. **Frontend** gets token and starts video call

### Security Features:
- ✅ **No permanent video links** - tokens generated just-in-time
- ✅ **Time-gated access** - can't join too early or too late  
- ✅ **User authorization** - only lesson participants can join
- ✅ **Short-lived tokens** - expire with lesson window

## 🐛 Troubleshooting

### "401 Unauthorized" Error
- **Check**: Are you logged in with Auth0?
- **Check**: Is the backend running with the updated lesson routes?
- **Fix**: Make sure you're authenticated before booking

### "User not found" Error
- **Check**: Does your user exist in the database?
- **Fix**: Complete onboarding if you haven't

### "Too early to join" Error
- **Expected**: This means the security is working!
- **Fix**: Wait until 15 minutes before lesson time, or modify the time window for testing

### No Lessons Showing
- **Check**: Navigate directly to `/lessons`
- **Check**: Are you logged in as the same user who booked?
- **Debug**: Check browser network tab for API errors

### Video Call Not Working
- **Check**: Is your Agora App ID and Certificate configured?
- **Check**: Browser permissions for camera/microphone
- **Check**: Are you on HTTPS or localhost (required for WebRTC)

## 🎯 Success Indicators

You'll know it's working when:
1. ✅ Checkout creates lesson successfully
2. ✅ `/lessons` page shows your booked lesson
3. ✅ Join button enables at the right time
4. ✅ Clicking join redirects to video call
5. ✅ Video/audio works in the call

## 📱 Mobile Testing

The system works on mobile too:
- **iOS Safari**: Full support
- **Android Chrome**: Full support
- **Responsive design**: Optimized for mobile screens

## 🔄 Next Steps After Testing

Once basic flow works:
1. **Add Agora App Certificate** to backend config
2. **Test with real tutors** and students
3. **Set up notifications** for lesson reminders
4. **Add lesson history** and feedback system
5. **Deploy to production** with proper SSL certificates

---

**Need help?** Check the terminal logs for detailed error messages, or modify the time windows for easier testing!
