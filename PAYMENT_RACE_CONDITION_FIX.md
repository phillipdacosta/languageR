# Payment Race Condition Fix

## Issue Summary

**Problem:** Lesson payment remained in `authorized` status and was never captured, even though the lesson completed successfully.

**Lesson Details:**
- Lesson ID: `6961879af3b9523857fdde58`
- Student: phillip.dacosta@gmail.com
- Tutor: travelbuggler2@gmail.com
- Price: $4.50
- Duration: 1 minute (ended early)
- Scheduled: 2026-01-09 23:00 - 23:25
- Actual: 2026-01-09 23:02:24 - 23:03:21

## Root Cause Analysis

### The Race Condition

When a lesson is ended early, there's a potential race condition where both users can trigger lesson completion:

1. **User A clicks "End Call"** 
   - Frontend calls `POST /api/lessons/:id/call-end`
   - Backend sets `status = 'ended_early'`
   - Payment remains `authorized` (correct)
   - Waits for cron job to capture payment after scheduled end time

2. **User B receives "Lesson Ended" notification**
   - May not see the modal immediately (e.g., navigating away)
   - Later dismisses the lesson page
   - Frontend calls `POST /api/lessons/:id/end`

3. **The `/end` endpoint had a bug:**
   - It blindly set `status = 'completed'` 
   - Did NOT capture payment
   - Did NOT check if lesson was already `ended_early`

4. **Cron job skips the lesson:**
   - `autoFinalizeLessons` only processes lessons with status: `['scheduled', 'in_progress', 'ended_early']`
   - Since status is now `completed`, it gets skipped
   - Payment never captured ❌

### Code Location of Bug

**File:** `backend/routes/lessons.js`

**Endpoint:** `POST /api/lessons/:id/end` (line ~1450)

**Bug:** Always set `lesson.status = 'completed'` without:
- Checking if lesson is already `ended_early`
- Capturing the payment
- Updating billing status

## The Fix

### 1. Fixed the `/end` Endpoint (Race Condition Prevention)

**File:** `backend/routes/lessons.js`

**Changes:**
- Added check: if lesson is `ended_early`, preserve that status
- Added check: if lesson is `completed`, don't change it
- Only mark as `completed` if status is `scheduled` or `in_progress`
- Added logging to track when this happens

**Code:**
```javascript
// ⚠️ IMPORTANT: Do NOT change status if lesson is already 'ended_early'
// The cron job needs to process it to capture payment properly
if (lesson.status === 'ended_early') {
  console.log(`⚠️ Lesson ${lesson._id} already marked as 'ended_early' - preserving status for cron job`);
  console.log(`💳 Payment will be captured by autoFinalizeLessons cron after scheduled end time`);
  await lesson.save(); // Save participant left time only
  
  return res.json({ 
    success: true, 
    message: 'Lesson already ended early, awaiting finalization' 
  });
}
```

### 2. Added Safety Net in Cron Job (Recovery)

**File:** `backend/jobs/autoFinalizeLessons.js`

**Changes:**
- Added second query to find `completed` lessons with uncaptured payments
- Checks for lessons completed within the last hour
- Filters to only those with `payment.status === 'authorized'` and no `chargedAt`
- Captures payment for these "orphaned" lessons

**Code:**
```javascript
// 🆕 SAFETY NET: Also find 'completed' lessons with uncaptured payments
// This catches race conditions where status changed to 'completed' without payment capture
const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
const completedWithUncapturedPayment = await Lesson.find({
  status: 'completed',
  endTime: { $lt: now, $gt: oneHourAgo }, // Completed within last hour
  paymentId: { $exists: true, $ne: null }
}).populate('paymentId').limit(50);

// Filter to only those with uncaptured payments
const needsPaymentCapture = completedWithUncapturedPayment.filter(lesson => {
  const payment = lesson.paymentId;
  return payment && 
         payment.status === 'authorized' && 
         !payment.chargedAt && 
         lesson.actualCallStartTime; // Only if lesson actually happened
});
```

## Resolution

### Manual Fix Applied

The payment for lesson `6961879af3b9523857fdde58` was manually captured using:

```bash
node backend/manual-capture-lesson.js 6961879af3b9523857fdde58
```

**Result:**
- ✅ Payment captured: $4.50
- ✅ Platform fee: $0.90 (20%)
- ✅ Tutor payout: $3.60
- ✅ Stripe payout created: `po_1SnrziBTdLfPQZ49Cx3SfUqK`
- ✅ PayPal payout will be sent in 2-3 business days

### Automatic Fix for Future

With the code changes:

1. **Prevention:** The `/end` endpoint will no longer overwrite `ended_early` status
2. **Recovery:** The cron job will catch any lessons that slip through and capture their payments within 1 hour
3. **Monitoring:** Better logging to track when this race condition occurs

## Testing

To test the fix:

1. **Scenario A: Normal early end**
   - User A clicks "End Call" → `ended_early`
   - User B dismisses page → tries to call `/end` → preserves `ended_early` ✅
   - Cron job captures payment after scheduled end time ✅

2. **Scenario B: Race condition recovery**
   - If somehow a lesson becomes `completed` with uncaptured payment
   - Cron job detects it within 1 hour ✅
   - Captures payment automatically ✅

## Related Files

- `backend/routes/lessons.js` - Fixed `/end` endpoint
- `backend/jobs/autoFinalizeLessons.js` - Added safety net
- `backend/manual-capture-lesson.js` - Manual recovery tool (for emergencies)
- `backend/check-last-payment.js` - Diagnostic tool

## Date

- Issue discovered: 2026-01-10
- Fix applied: 2026-01-10
- Manual payment capture: 2026-01-10 02:33:37 UTC

