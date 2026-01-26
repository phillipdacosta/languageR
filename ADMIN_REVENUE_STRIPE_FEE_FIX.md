# Admin Revenue Stripe Fee Missing - Hybrid Payment Bug Fix

## Issue
The admin revenue dashboard (`/admin/revenue`) was showing **$0.00 Stripe fee** for saved card payments, even though Stripe was actually charging processing fees (visible in Stripe dashboard as $0.66).

---

## Root Cause

The issue occurred specifically for **hybrid payments** (wallet + saved card).

### Payment Flow for Hybrid Payments

1. **Booking**: Two payment records created
   - Wallet payment (linked to lesson via `lesson.paymentId`)
   - Card payment (NOT linked to lesson, just stored separately)

2. **Capture**: `deductLessonFunds()` is called when lesson starts
   - Only captures the payment linked to `lesson.paymentId` (wallet payment)
   - **Card payment was never captured**, so Stripe fee never retrieved

3. **Revenue Recognition**: `completeLessonPayment()` marks revenue as recognized
   - Only processes the linked payment (wallet)
   - **Card payment revenue never recognized**, so not included in admin dashboard

### The Bug

From `paymentService.js` line 157:
```javascript
stripeFee: 0, // Will be calculated when captured
```

This comment indicates the fee should be calculated during capture, but the hybrid card payment never went through the capture process because:
- Line 176: Only the wallet payment is linked to the lesson
- `deductLessonFunds()` only operates on `lesson.paymentId`
- The card payment record existed but was orphaned

---

## Fix Applied

### 1. Updated `deductLessonFunds()` (Line 357)

Added logic to detect and capture hybrid card payments:

```javascript
// 🔍 Check for hybrid payment - find any related card payment for this lesson
const hybridCardPayment = await Payment.findOne({
  lessonId,
  status: 'authorized',
  paymentMethod: { $in: ['saved-card', 'card', 'apple_pay', 'google_pay'] },
  'metadata.isHybridPayment': true
});

// ... after main payment capture ...

// 🔀 HYBRID PAYMENT: Also capture the card portion if exists
if (hybridCardPayment && hybridCardPayment.stripePaymentIntentId) {
  // Capture the payment
  const capturedIntent = await stripe.paymentIntents.capture(...);
  
  // Extract Stripe fees from balance transaction
  if (charge.balance_transaction) {
    const balanceTx = await stripe.balanceTransactions.retrieve(...);
    hybridCardPayment.stripeFee = (balanceTx.fee || 0) / 100;
  }
  
  hybridCardPayment.status = 'succeeded';
  hybridCardPayment.chargedAt = new Date();
  await hybridCardPayment.save();
}
```

**Key changes:**
- Query for any hybrid card payment for the lesson
- Capture it alongside the main payment
- Retrieve and store Stripe processing fee
- Mark as succeeded with timestamp

---

### 2. Updated `completeLessonPayment()` (Line 790)

Added logic to recognize revenue for hybrid card payments:

```javascript
// 🔀 HYBRID PAYMENT: Also mark hybrid card payment revenue as recognized
const hybridCardPayment = await Payment.findOne({
  lessonId,
  paymentMethod: { $in: ['saved-card', 'card', 'apple_pay', 'google_pay'] },
  'metadata.isHybridPayment': true
});

if (hybridCardPayment && !hybridCardPayment.revenueRecognized) {
  const hybridPlatformFee = hybridCardPayment.amount * (this.PLATFORM_FEE_PERCENTAGE / 100);
  const hybridTutorPayout = hybridCardPayment.amount - hybridPlatformFee;
  
  hybridCardPayment.platformFee = hybridPlatformFee;
  hybridCardPayment.tutorPayout = hybridTutorPayout;
  hybridCardPayment.revenueRecognized = true;
  hybridCardPayment.revenueRecognizedAt = new Date();
  await hybridCardPayment.save();
  
  console.log(`✅ [HYBRID] Hybrid card payment revenue recognized`);
}
```

**Key changes:**
- Find hybrid card payment after main payment processing
- Calculate platform fee and tutor payout
- Mark revenue as recognized with timestamp
- This makes it appear in admin revenue dashboard

---

## How It Works Now

### Hybrid Payment Flow (Fixed)

**Before Lesson:**
1. Student books with $2.50 wallet + $10.00 saved card
2. Two payments created:
   - Wallet payment: `status: 'authorized'`, linked to lesson
   - Card payment: `status: 'authorized'`, `stripeFee: 0`

**Lesson Starts:**
1. `deductLessonFunds()` called
2. Wallet funds deducted: $2.50
3. **NEW**: Hybrid card payment detected and captured
4. Stripe returns balance transaction with fee: $0.66
5. Card payment updated: `status: 'succeeded'`, `stripeFee: 0.66`

**Lesson Ends:**
1. `completeLessonPayment()` called
2. Main payment revenue recognized
3. **NEW**: Hybrid card payment revenue recognized
4. Both payments now have `revenueRecognized: true`

**Admin Dashboard:**
1. Queries all payments with `revenueRecognized: true`
2. **NEW**: Includes both wallet AND card payments
3. Stripe fee correctly shows: $0.66 (from card payment)
4. Revenue calculations accurate

---

## Testing

### Test Case: Hybrid Payment with Saved Card

**Setup:**
- Student wallet: $2.50
- Lesson price: $12.50
- Payment: $2.50 wallet + $10.00 saved card

**Expected Results:**
- ✅ Two payment records created
- ✅ Both captured when lesson starts
- ✅ Card payment has `stripeFee: ~$0.60` (2.9% + $0.30)
- ✅ Both have `revenueRecognized: true` after lesson
- ✅ Admin dashboard shows correct Stripe fee
- ✅ Platform fee calculations accurate

**Verification:**
```javascript
// Check payment records
const payments = await Payment.find({ lessonId });
console.log(payments.map(p => ({
  method: p.paymentMethod,
  amount: p.amount,
  stripeFee: p.stripeFee,
  revenueRecognized: p.revenueRecognized
})));

// Should output:
// [
//   { method: 'wallet', amount: 2.50, stripeFee: 0, revenueRecognized: true },
//   { method: 'saved-card', amount: 10.00, stripeFee: 0.66, revenueRecognized: true }
// ]
```

---

## Impact

### ✅ Fixed Issues
- Stripe fees now correctly captured for hybrid card payments
- Admin revenue dashboard shows accurate Stripe fees
- Net platform revenue calculations correct
- No more $0.00 Stripe fee for saved card portions

### ✅ Backward Compatible
- Non-hybrid payments work exactly as before
- Only adds logic when hybrid payment detected
- Doesn't break existing payment flows

### ✅ Improved Logging
- Clear console logs for hybrid payment processing
- Easy to debug hybrid payment issues
- Separate logs for wallet vs card portions

---

## Related Files

- `backend/services/paymentService.js` - Main payment processing logic
- `backend/routes/admin.js` - Admin revenue dashboard endpoint
- `backend/models/Payment.js` - Payment schema with `stripeFee` field

---

## Console Output

When a hybrid payment is processed, you should now see:

```
🔀 [HYBRID] Found hybrid card payment: 6789abc...
💸 Deducted $2.50 from wallet at lesson start (lesson 1234...)
✅ [WALLET] Wallet payment captured: $2.50 (no Stripe fees)
💳 [HYBRID] Capturing hybrid card payment: pi_xyz...
💰 [HYBRID] Stripe fee for card portion: $0.66
✅ [HYBRID] Hybrid card payment captured: $10.00
✅ Funds captured for lesson 1234... at START (Preply model)
...
✅ [HYBRID] Hybrid card payment revenue recognized: $2.00 platform fee, Stripe fee: $0.66
```

---

## Before vs After

### Before (Bug)
```
Admin Revenue Dashboard:
- Lesson Price: $12.50
- Platform Fee: $2.50
- Stripe Fee: $0.00  ❌ WRONG
- Net Revenue: $2.50 ❌ WRONG

(Hybrid card payment not included)
```

### After (Fixed)
```
Admin Revenue Dashboard:
- Lesson Price: $12.50
- Platform Fee: $2.50
- Stripe Fee: $0.66  ✅ CORRECT
- Net Revenue: $1.84 ✅ CORRECT

(Both wallet and card payments included)
```

---

## Migration

**Existing Data:** Hybrid payments that occurred before this fix will still show `stripeFee: 0`. To fix historical data, run:

```javascript
// Find all hybrid card payments without Stripe fee
const orphanedPayments = await Payment.find({
  'metadata.isHybridPayment': true,
  paymentMethod: { $in: ['saved-card', 'card'] },
  stripeFee: 0,
  status: 'succeeded',
  stripePaymentIntentId: { $exists: true }
});

// Retroactively fetch Stripe fees from Stripe API
for (const payment of orphanedPayments) {
  const paymentIntent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
  const charge = paymentIntent.charges.data[0];
  if (charge?.balance_transaction) {
    const balanceTx = await stripe.balanceTransactions.retrieve(charge.balance_transaction);
    payment.stripeFee = (balanceTx.fee || 0) / 100;
    await payment.save();
    console.log(`Fixed payment ${payment._id}: Stripe fee = $${payment.stripeFee}`);
  }
}
```

---

## Documentation

Updated `paymentService.js` with comprehensive comments explaining:
- Hybrid payment detection
- Stripe fee retrieval process
- Revenue recognition for both payment portions
- Error handling for failed hybrid captures

This ensures future developers understand the hybrid payment flow.

