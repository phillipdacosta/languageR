# Pending Video System - Implementation Complete

## Overview
When a tutor changes their introduction video, the new video is stored as "pending" while the old video remains visible to students. Admin reviews the new video and approves/rejects it.

---

## Database Schema

### User Model - onboardingData Fields

```javascript
onboardingData: {
  // Current active video (visible to students)
  introductionVideo: String,
  videoThumbnail: String,
  videoType: 'upload' | 'youtube' | 'vimeo',
  
  // Pending video (under review, NOT visible to students)
  pendingVideo: String,           // NEW
  pendingVideoThumbnail: String,  // NEW
  pendingVideoType: String,       // NEW
  
  // Other fields...
}

tutorOnboarding: {
  videoApproved: Boolean,  // false when pending video exists
  videoRejected: Boolean,
  videoUploaded: Boolean,
  // Other fields...
}
```

---

## Flow Diagram

```
┌─────────────────────────────────────────────┐
│ TUTOR CHANGES VIDEO                         │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│ Backend: PUT /api/users/tutor-video         │
│                                             │
│ • Store new video in pendingVideo fields    │
│ • Keep old video in introductionVideo       │
│ • Set videoApproved = false                 │
│ • Set videoUploaded = true                  │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│ STUDENTS SEE OLD VIDEO                      │
│ • introductionVideo (current)               │
│ • Profile remains visible                   │
│ • Bookings still work                       │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│ ADMIN REVIEWS NEW VIDEO                     │
│ • Sees pendingVideo at /admin/tutor-review  │
│ • "New Video Pending Review" badge          │
└─────────────────────────────────────────────┘
                    ↓
        ┌───────────┴───────────┐
        ↓                       ↓
┌───────────────┐       ┌───────────────┐
│ ADMIN APPROVES│       │ ADMIN REJECTS │
└───────────────┘       └───────────────┘
        ↓                       ↓
┌───────────────┐       ┌───────────────┐
│ Move pending  │       │ Clear pending │
│ to active:    │       │ video fields  │
│               │       │               │
│ intro = pend  │       │ Keep old vid  │
│ Clear pending │       │ Notify tutor  │
└───────────────┘       └───────────────┘
```

---

## Backend Implementation

### 1. Video Update Endpoint
**Route**: `PUT /api/users/tutor-video`

```javascript
// Store new video as pending
user.onboardingData.pendingVideo = newVideoUrl;
user.onboardingData.pendingVideoThumbnail = newThumbnail;
user.onboardingData.pendingVideoType = newType;

// Keep old video unchanged
// user.onboardingData.introductionVideo stays the same

// Mark for review
user.tutorOnboarding.videoApproved = false;
user.tutorOnboarding.videoUploaded = true;
```

### 2. Admin Approval Endpoint
**Route**: `POST /api/admin/approve-tutor/:tutorId`

```javascript
// Move pending to active
if (tutor.onboardingData?.pendingVideo) {
  tutor.onboardingData.introductionVideo = tutor.onboardingData.pendingVideo;
  tutor.onboardingData.videoThumbnail = tutor.onboardingData.pendingVideoThumbnail;
  tutor.onboardingData.videoType = tutor.onboardingData.pendingVideoType;
  
  // Clear pending fields
  tutor.onboardingData.pendingVideo = undefined;
  tutor.onboardingData.pendingVideoThumbnail = undefined;
  tutor.onboardingData.pendingVideoType = undefined;
}

tutor.tutorOnboarding.videoApproved = true;
```

### 3. Admin Rejection Endpoint
**Route**: `POST /api/admin/reject-tutor/:tutorId`

```javascript
// Clear pending video (keep old video)
if (tutor.onboardingData?.pendingVideo) {
  tutor.onboardingData.pendingVideo = undefined;
  tutor.onboardingData.pendingVideoThumbnail = undefined;
  tutor.onboardingData.pendingVideoType = undefined;
}

tutor.tutorOnboarding.videoApproved = false;
tutor.tutorOnboarding.videoRejected = true;
```

### 4. Admin Pending Query
**Route**: `GET /api/admin/pending-tutors`

```javascript
// Find tutors with pending videos OR unapproved videos
const tutors = await User.find({
  userType: 'tutor',
  $or: [
    { 'onboardingData.introductionVideo': { $exists: true, $ne: '' } },
    { 'onboardingData.pendingVideo': { $exists: true, $ne: '' } }
  ]
});

// Filter for pending approval
const pending = tutors.filter(t => 
  !t.tutorOnboarding?.videoApproved && 
  !t.tutorOnboarding?.videoRejected
);
```

---

## Frontend Implementation

### Admin Review Page

**Template**: Shows pending video if exists, otherwise current video

```html
<div class="pending-badge" *ngIf="tutor.onboardingData?.pendingVideo">
  <ion-badge color="warning">New Video Pending Review</ion-badge>
</div>

<video [src]="getVideoUrl(tutor)"></video>
```

**Helper Methods**:
```typescript
getVideoUrl(tutor: any): string {
  // Show pending video for review
  return tutor.onboardingData?.pendingVideo || 
         tutor.onboardingData?.introductionVideo || '';
}

getVideoThumbnail(tutor: any): string {
  return tutor.onboardingData?.pendingVideoThumbnail || 
         tutor.onboardingData?.videoThumbnail || '';
}
```

---

## User Messages

### For Tutor (Warning Dialog)
```
⚠️ Change Introduction Video

Your new video will be sent for admin review. 
Your profile will remain visible to students 
while the review is in progress.

Are you sure you want to change your video?

[Cancel]  [Continue]
```

### For Tutor (Success Message)
```
Video updated! The new video has been sent for 
admin review. Your profile will remain active 
during the review process.
```

### For Admin (Badge)
```
[⚠️ New Video Pending Review]
```

---

## Benefits

1. **No Disruption**: Tutor profile stays visible
2. **Professional**: Old video shows until new one approved
3. **Safe**: Admin reviews before content goes live
4. **Clear**: Badge shows when reviewing updated video
5. **Simple**: One video active, one pending (max)

---

## Edge Cases

### Case 1: Tutor with No Video Changes Video
- No old video exists
- pendingVideo stores new video
- After approval → moves to introductionVideo

### Case 2: Admin Rejects Pending Video
- Pending video cleared
- Old video remains active
- Tutor can upload again

### Case 3: Tutor Changes Video Again Before Approval
- New pendingVideo replaces old pendingVideo
- Only latest pending video kept
- Admin sees most recent submission

### Case 4: First Time Upload (No Old Video)
- pendingVideo stores first video
- introductionVideo empty
- After approval → pendingVideo moves to introductionVideo

---

## Testing Checklist

### Backend
- [ ] Upload first video → stored as pending
- [ ] Approve → moves to active
- [ ] Change video → new stored as pending, old stays
- [ ] Approve change → new becomes active
- [ ] Reject change → pending cleared, old stays
- [ ] Change again → overwrites pending

### Frontend (Tutor)
- [ ] Change video shows warning
- [ ] Old video visible in profile
- [ ] Success message confirms pending status

### Frontend (Admin)
- [ ] Pending tutor appears in queue
- [ ] "New Video Pending Review" badge shows
- [ ] Correct video plays in modal
- [ ] Approve → tutor removed from queue
- [ ] Reject → tutor removed from queue

### Students
- [ ] See old video during review
- [ ] Can book tutor normally
- [ ] See new video after approval

---

## Database Queries

### Find Tutors with Pending Videos
```javascript
db.users.find({
  'onboardingData.pendingVideo': { $exists: true, $ne: '' }
})
```

### Find All Pending Approvals
```javascript
db.users.find({
  userType: 'tutor',
  'tutorOnboarding.videoApproved': false,
  'tutorOnboarding.videoRejected': false,
  $or: [
    { 'onboardingData.introductionVideo': { $exists: true, $ne: '' } },
    { 'onboardingData.pendingVideo': { $exists: true, $ne: '' } }
  ]
})
```

---

## API Response Example

### After Uploading Pending Video
```json
{
  "success": true,
  "message": "Introduction video updated successfully. Pending admin approval.",
  "introductionVideo": "https://old-video.mp4",  // Still active
  "pendingVideo": "https://new-video.mp4",        // Under review
  "videoThumbnail": "https://old-thumbnail.jpg",
  "videoType": "upload"
}
```

---

## Status: ✅ COMPLETE

**Last Updated**: January 3, 2026


