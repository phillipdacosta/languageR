# Tutor Earnings Calculation Bug Fix

## 🐛 The Bug

**Issue**: Tutors were seeing earnings for **future lessons** that hadn't happened yet.

**Example**:
- Tutor completes 1 lesson → earns $6.00
- Student books another lesson (not yet started) → tutor sees $12.38
- **Problem**: The $6.38 from the future lesson shouldn't be counted yet!

## 🔍 Root Cause

The `GET /api/payments/tutor/earnings` endpoint was counting **ALL payments** associated with the tutor, including:

1. ✅ **Completed lessons** (revenue recognized)
2. ❌ **Future lessons** (only authorized, not yet started)
3. ❌ **In-progress lessons** (started but not completed)

### Old (Buggy) Query
```javascript
const payments = await Payment.find({ tutorId: user._id })
  .populate('lessonId', 'startTime endTime duration')
  .sort({ createdAt: -1 })
  .limit(10);
```

This query found **all payments** for the tutor, regardless of lesson status.

## ✅ The Fix

Now the endpoint **only counts payments where revenue has been recognized** (i.e., the lesson has been completed).

### New (Correct) Query
```javascript
const payments = await Payment.find({ 
  tutorId: user._id,
  revenueRecognized: true // ONLY count completed lessons
})
  .populate('lessonId', 'startTime endTime duration status')
  .sort({ revenueRecognizedAt: -1 }) // Sort by completion date
  .limit(10);
```

### Key Changes
1. **Added filter**: `revenueRecognized: true`
   - This field is set to `true` only when the lesson completes
   - Set by `completeLessonPayment()` in `paymentService.js`
2. **Updated sort**: Changed from `createdAt` to `revenueRecognizedAt`
   - Shows most recently completed lessons first
3. **Added logging**: Logs `revenueRecognized` status for debugging

## 💰 Payment Lifecycle (Preply Model)

### 1. **Booking** (Student books lesson)
```javascript
Payment {
  status: 'succeeded',         // Stripe authorization succeeded
  revenueRecognized: false,    // Lesson hasn't happened yet
  chargedAt: null,             // Funds not yet deducted
  tutorPayout: 8.00,           // Calculated, but not earned yet
  platformFee: 2.00,           // Calculated, but not earned yet
  transferStatus: null         // No transfer yet
}
```
**Tutor earnings**: $0.00 (not counted)

### 2. **Lesson Starts** (Video call begins)
```javascript
// deductLessonFunds() is called
Payment {
  status: 'succeeded',
  revenueRecognized: false,    // Still false until lesson completes
  chargedAt: Date(),           // ✅ Funds deducted from student
  tutorPayout: 8.00,
  platformFee: 2.00,
  transferStatus: null
}
```
**Tutor earnings**: $0.00 (still not counted - lesson not complete)

### 3. **Lesson Completes** (Video call ends)
```javascript
// completeLessonPayment() is called
Payment {
  status: 'succeeded',
  revenueRecognized: true,     // ✅ Revenue recognized!
  revenueRecognizedAt: Date(), // ✅ Timestamp of completion
  chargedAt: Date(),
  tutorPayout: 8.00,
  platformFee: 2.00,
  transferStatus: 'pending'    // Pending Stripe transfer
}
```
**Tutor earnings**: $8.00 **pending** (✅ now counted!)

### 4. **Payout Transferred** (Stripe Connect transfer succeeds)
```javascript
Payment {
  status: 'succeeded',
  revenueRecognized: true,
  revenueRecognizedAt: Date(),
  chargedAt: Date(),
  tutorPayout: 8.00,
  platformFee: 2.00,
  transferStatus: 'succeeded', // ✅ Transfer complete
  stripeTransferId: 'po_xxx',
  transferredAt: Date()
}
```
**Tutor earnings**: $8.00 **paid** (✅ moved from pending to total)

## 📊 Earnings Display Logic

```typescript
// Frontend: tab1.page.ts
if (payment.transferStatus === 'succeeded') {
  totalEarnings += tutorPayout;      // Money in bank account
} else {
  pendingEarnings += tutorPayout;    // Money owed, not yet transferred
}

// Display: Total earnings + Pending earnings
walletBalance = totalEarnings + pendingEarnings;
```

### Example Scenario
- Lesson 1: Completed, transferred → **$6.00 paid** (totalEarnings)
- Lesson 2: Completed, not yet transferred → **$6.38 pending** (pendingEarnings)
- Lesson 3: Booked, not yet started → **$0.00** (not counted)

**Display**: $12.38 (= $6.00 + $6.38) ✅ Correct!

## 🧪 Testing Checklist

- [x] **Future lesson booked**: $0.00 added to earnings
- [x] **Lesson starts**: $0.00 added to earnings (still not complete)
- [x] **Lesson completes**: Tutor payout added to **pending** earnings
- [x] **Stripe transfer succeeds**: Tutor payout moved from **pending** to **total** earnings
- [ ] **Multiple scenarios**: Test with 3+ lessons in different states

## 🔧 Related Files Modified

### Backend
- `backend/routes/payments.js`: Fixed query in `GET /api/payments/tutor/earnings`

### No Frontend Changes Needed
- Frontend already correctly distinguishes between `totalEarnings` and `pendingEarnings`
- Frontend already correctly sums them for display

## 📝 Notes

- This fix aligns with the **Preply model** we implemented
- Tutors only see earnings for **completed** lessons
- Future/in-progress lessons are excluded
- Platform fees are also only recognized when lessons complete
- The `revenueRecognized` flag is the single source of truth for "has the tutor earned this money?"

## 🚀 Result

**Before**: Tutor sees $12.38 (includes future lesson)
**After**: Tutor sees $6.00 (only completed lesson) ✅



