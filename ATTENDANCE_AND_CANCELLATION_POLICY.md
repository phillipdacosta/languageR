# Attendance Tracking & Cancellation Policy

## Overview
The system now tracks **individual attendance** (who showed up) and applies fair cancellation policies when lessons don't proceed as planned.

---

## 🎯 How Attendance Tracking Works

### Individual Attendance Fields
**Lesson Model** now tracks:
- `tutorJoinedAt`: Timestamp when tutor first joined the call
- `studentJoinedAt`: Timestamp when student first joined the call
- `actualCallStartTime`: Timestamp when **BOTH** tutor and student were present (lesson actually started)

### When Attendance is Recorded
**File**: `backend/routes/lessons.js` → `POST /api/lessons/:id/token`

When a user requests an Agora token to join a lesson:
1. System records their individual join time (`tutorJoinedAt` or `studentJoinedAt`)
2. If **both** participants are now present:
   - Sets `actualCallStartTime` (with 4-second grace period)
   - Changes lesson status to `in_progress`
   - Payment will be captured after lesson ends

```javascript
// Tracking individual attendance
if (userId === tutorId && !lesson.tutorJoinedAt) {
  lesson.tutorJoinedAt = now;
}

if (userId === studentId && !lesson.studentJoinedAt) {
  lesson.studentJoinedAt = now;
}

// Only set actualCallStartTime when BOTH are present
if (!lesson.actualCallStartTime && activeParticipants >= 2) {
  lesson.actualCallStartTime = now;
  lesson.status = 'in_progress';
}
```

---

## 📋 Cancellation Policies

### Policy Summary

| Scenario | Tutor Showed | Student Showed | Student Charged | Tutor Paid | Lesson Status |
|----------|-------------|----------------|-----------------|------------|---------------|
| **Both showed** | ✅ | ✅ | 100% | 85% (after platform fee) | `completed` |
| **Both no-show** | ❌ | ❌ | 0% (full refund) | $0 | `cancelled` (by system) |
| **Student no-show** | ✅ | ❌ | **50% cancellation fee** | 42.5% (85% of fee) | `cancelled` (by student) |
| **Tutor no-show** | ❌ | ✅ | 0% (full refund) | $0 | `cancelled` (by tutor) |

---

## 💰 Payment Processing by Scenario

### Scenario 1: Both Showed Up (Successful Lesson)
**Outcome**: Full payment captured and processed

**Flow**:
1. Lesson ends
2. Auto-finalize job runs (within 1 minute)
3. Detects `actualCallStartTime` is set
4. Captures **100%** of authorized payment
5. Platform takes 15% fee
6. Tutor receives 85% payout
7. Lesson status → `completed`

**Example**:
- Lesson price: $25.00
- Student charged: **$25.00**
- Platform fee (15%): $3.75
- Tutor receives: **$21.25**

---

### Scenario 2: Both No-Show
**Outcome**: Full refund to student

**Flow**:
1. Lesson end time passes
2. Auto-finalize job checks attendance
3. Detects neither `tutorJoinedAt` nor `studentJoinedAt` is set
4. Cancels Stripe PaymentIntent (releases authorization hold)
5. Student is **not charged**
6. Lesson status → `cancelled` (by system)
7. Cancel reason: "No-show by both parties"

**Example**:
- Lesson price: $25.00
- Student charged: **$0.00** ✅
- Tutor receives: **$0.00**

---

### Scenario 3: Student No-Show (Tutor Waited)
**Outcome**: 50% cancellation fee charged, paid to tutor as compensation

**Flow**:
1. Lesson end time passes
2. Auto-finalize job checks attendance
3. Detects `tutorJoinedAt` is set, but `studentJoinedAt` is NOT set
4. Captures **50%** of authorized payment (cancellation fee)
5. Platform takes 15% of the cancellation fee
6. Tutor receives 85% of the cancellation fee (as compensation for wasted time)
7. Lesson status → `cancelled` (by student)
8. Cancel reason: "Student no-show (tutor waited)"
9. Admin alert created for record-keeping

**Example**:
- Lesson price: $25.00
- Cancellation fee (50%): **$12.50**
- Student charged: **$12.50** ⚠️
- Platform fee (15%): $1.88
- Tutor receives: **$10.62** (compensation for waiting)

**Why This Policy?**
- Tutors block out time in their schedule
- If they show up and wait, they deserve compensation
- 50% is fair: less than full price, but not zero
- Discourages student no-shows

---

### Scenario 4: Tutor No-Show (Student Waited)
**Outcome**: Full refund to student + tutor penalty

**Flow**:
1. Lesson end time passes
2. Auto-finalize job checks attendance
3. Detects `studentJoinedAt` is set, but `tutorJoinedAt` is NOT set
4. Cancels Stripe PaymentIntent (releases authorization hold)
5. Student is **not charged**
6. Lesson status → `cancelled` (by tutor)
7. Cancel reason: "Tutor no-show (student waited)"
8. **HIGH severity** admin alert created for manual review

**Example**:
- Lesson price: $25.00
- Student charged: **$0.00** ✅
- Tutor receives: **$0.00**
- Admin notified for potential tutor penalty/review

**Why This Policy?**
- Tutors are professionals and must honor commitments
- Students should never pay for a lesson the tutor didn't attend
- Tutor no-shows are tracked and may result in:
  - Account warnings
  - Reduced profile visibility
  - Account suspension (repeated offenses)

---

## 🚨 Admin Alerts

### STUDENT_NO_SHOW
**Severity**: MEDIUM

**Triggered When**: Student didn't attend, tutor waited

**Info Provided**:
- Lesson ID
- Student name and email
- Tutor name
- Cancellation fee charged ($X.XX)
- Original lesson price

**Action Required**: None (automatically handled)

**Purpose**: Record-keeping and pattern detection

---

### TUTOR_NO_SHOW
**Severity**: HIGH

**Triggered When**: Tutor didn't attend, student waited

**Info Provided**:
- Lesson ID
- Tutor name and email
- Student name
- Lesson price (fully refunded to student)

**Action Required**: Manual review of tutor

**Recommended Actions**:
1. Contact tutor to understand what happened
2. First offense: Warning
3. Second offense: Temporary suspension
4. Third offense: Permanent ban

**Purpose**: Quality control and tutor accountability

---

### NO_SHOW_AUTO_RELEASED
**Severity**: MEDIUM

**Triggered When**: Both no-show, payment auto-released by reconciliation job

**Info Provided**:
- Lesson ID
- Payment ID
- Stripe PaymentIntent ID
- Time elapsed since lesson ended

**Action Required**: None (automatically handled)

**Purpose**: Confirmation that stuck payments were released

---

## 🔧 Technical Implementation

### Database Changes

**Lesson Model** (backend/models/Lesson.js):
```javascript
// New fields
tutorJoinedAt: Date
studentJoinedAt: Date
cancelledBy: String (enum: ['tutor', 'student', 'system', 'admin'])
cancelReason: String
cancelledAt: Date
cancellationFeeCharged: Number
```

**Billing Status** enum updated:
```javascript
billingStatus: ['pending', 'authorized', 'charged', 'refunded', 'partially_refunded', 'no_show']
```

---

### Auto-Finalize Job Logic

**File**: `backend/jobs/autoFinalizeLessons.js`

**Runs**: Every minute

**Process**:
1. Finds lessons past their end time
2. Checks individual attendance:
   ```javascript
   const tutorShowed = !!lesson.tutorJoinedAt;
   const studentShowed = !!lesson.studentJoinedAt;
   ```
3. Applies appropriate cancellation policy
4. Handles payment (capture full, capture partial, or release)
5. Updates lesson status and cancellation details
6. Creates admin alerts as needed

---

### Partial Payment Capture

**Function**: `capturePartialPayment(payment, lesson, percentage)`

**Stripe API Call**:
```javascript
await stripe.paymentIntents.capture(paymentIntentId, {
  amount_to_capture: Math.round(partialAmount * 100) // in cents
});
```

**Fallback**: If partial capture fails, falls back to full refund

---

### Payment Release

**Function**: `releasePayment(payment, lesson)`

**For Stripe Payments**:
```javascript
await stripe.paymentIntents.cancel(paymentIntentId);
```

**For Wallet Payments**:
```javascript
await walletService.releaseFunds({
  userId: studentId,
  lessonId,
  amount
});
```

---

## 📊 Reconciliation Job Updates

**File**: `backend/jobs/reconcilePayments.js`

**Enhancement**: Now checks individual attendance when reconciling no-show lessons

**Process**:
1. Finds lessons > 1 hour past end time with no `actualCallStartTime`
2. Checks `tutorJoinedAt` and `studentJoinedAt`
3. Applies same cancellation policies as auto-finalize
4. Catches edge cases where auto-finalize didn't run or failed

---

## 🧪 Testing Scenarios

### Test 1: Both Show Up
**Setup**:
1. Book a lesson
2. Both tutor and student join the call
3. Wait for lesson to end

**Expected Result**:
- `tutorJoinedAt` and `studentJoinedAt` both set
- `actualCallStartTime` set when second person joins
- After lesson ends: full payment captured
- Tutor receives payout
- Lesson status: `completed`

---

### Test 2: Both No-Show
**Setup**:
1. Book a lesson
2. Neither tutor nor student joins
3. Wait for lesson end time to pass

**Expected Result**:
- `tutorJoinedAt` and `studentJoinedAt` both null
- `actualCallStartTime` remains null
- Auto-finalize (within 1 minute): payment released
- Lesson status: `cancelled` (by system)
- Cancel reason: "No-show by both parties"

---

### Test 3: Student No-Show
**Setup**:
1. Book a lesson
2. Tutor joins, student doesn't
3. Wait for lesson end time to pass

**Expected Result**:
- `tutorJoinedAt` set
- `studentJoinedAt` null
- `actualCallStartTime` remains null
- Auto-finalize: 50% payment captured
- Lesson status: `cancelled` (by student)
- Cancel reason: "Student no-show (tutor waited)"
- `cancellationFeeCharged` = 50% of price
- Admin alert created (MEDIUM severity)

---

### Test 4: Tutor No-Show
**Setup**:
1. Book a lesson
2. Student joins, tutor doesn't
3. Wait for lesson end time to pass

**Expected Result**:
- `tutorJoinedAt` null
- `studentJoinedAt` set
- `actualCallStartTime` remains null
- Auto-finalize: payment fully released
- Lesson status: `cancelled` (by tutor)
- Cancel reason: "Tutor no-show (student waited)"
- Admin alert created (HIGH severity)

---

## 🎓 Best Practices

### For Students
- Join lessons on time
- If you can't attend, cancel at least 24 hours in advance (manual cancellation flow)
- Understand that no-shows result in 50% cancellation fee

### For Tutors
- Join lessons on time (your reputation depends on it!)
- Understand that no-shows are tracked and penalized
- If you can't attend, contact student and admin ASAP

### For Admins
- Monitor HIGH severity "TUTOR_NO_SHOW" alerts
- Review tutor accounts with repeated no-shows
- Consider implementing:
  - Automatic penalties after N strikes
  - Required re-onboarding for offending tutors
  - Compensation policies for affected students

---

## 🔄 Future Enhancements

### 1. Grace Period for Late Arrivals
Currently: If you join 1 second after lesson ends, it counts as no-show

**Proposed**: Allow 5-10 minute grace period:
```javascript
const graceMinutes = 10;
const gracePeriodEnd = new Date(lesson.endTime.getTime() + graceMinutes * 60 * 1000);

if (now < gracePeriodEnd) {
  // Still allow attendance tracking
}
```

### 2. Graduated Cancellation Fees
Currently: Fixed 50% fee for student no-show

**Proposed**: Scale based on how late they cancel:
- >24 hours: 0% fee
- 12-24 hours: 25% fee
- <12 hours: 50% fee
- No-show: 50% fee

### 3. Tutor Strike System
Currently: Manual review of tutor no-shows

**Proposed**: Automated penalties:
```javascript
tutorStrikes: {
  noShowCount: Number,
  lastNoShowDate: Date,
  warningsIssued: Number,
  suspensionHistory: [Date]
}
```

Automatic actions:
- 1st no-show: Warning email
- 2nd no-show: 7-day suspension
- 3rd no-show: Permanent ban

### 4. Student Protection
Track patterns of tutors who frequently have "student no-shows"
- Might indicate tutor isn't actually waiting
- Requires video/photo proof of attendance

---

## 📞 Support

### Dispute Resolution
If a student or tutor disputes an attendance decision:

1. Check backend logs:
   ```bash
   grep "lessonId" /tmp/backend.log | grep "joined"
   ```

2. Check database:
   ```javascript
   const lesson = await Lesson.findById(lessonId);
   console.log('Tutor joined:', lesson.tutorJoinedAt);
   console.log('Student joined:', lesson.studentJoinedAt);
   console.log('Call started:', lesson.actualCallStartTime);
   ```

3. Check Agora logs (if available):
   - Who requested tokens
   - When tokens were issued
   - Connection logs

4. Make fair decision:
   - If attendance unclear: Refund student, don't penalize tutor
   - If evidence is clear: Apply policy as written

---

**Last Updated**: January 8, 2026  
**Status**: ✅ Production Ready  
**Version**: 2.0

