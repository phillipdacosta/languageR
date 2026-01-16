# Earnings Page - WebSocket Payment Status Update Fix

## Issue
The earnings page (`/tabs/earnings`) was not updating in real-time when payments moved from "Pending Transfer" to "Transferred". The frontend had WebSocket listeners set up, but the backend was never emitting `payment_status_changed` events when payment transfers succeeded.

---

## Root Cause

The backend was updating `payment.transferStatus = 'succeeded'` in multiple places, but **none of them were emitting WebSocket events** to notify the frontend of the change.

### Locations Where Payments Are Transferred

1. **Manual retry endpoint** (`/api/payments/retry-pending-transfers`) - Line 732
2. **Auto-retry after Stripe Connect onboarding** (`/api/payments/stripe-connect/status`) - Line 1166
3. **PayPal payout cron job** (`backend/jobs/processPayPalPayouts.js`) - Line 115
4. **PayPal payout webhook** (`backend/routes/webhooks.js`) - Line 179

None of these locations were emitting WebSocket events.

---

## Changes Made

### 1. Manual Retry Endpoint (`backend/routes/payments.js` - Line 732)

Added WebSocket emission after successful transfer:

```javascript
// Update payment record
payment.stripeTransferId = transfer.id;
payment.stripeTransferAmount = payment.tutorPayout;
payment.transferredAt = new Date();
payment.transferStatus = 'succeeded';
await payment.save();

// Emit WebSocket event for real-time update
if (global.io) {
  const tutorSocketRoom = `user:${user._id}`;
  global.io.to(tutorSocketRoom).emit('payment_status_changed', {
    paymentId: payment._id.toString(),
    lessonId: payment.lessonId?._id?.toString() || null,
    status: 'paid', // Frontend uses 'paid' status for transferred payments
    transferStatus: 'succeeded',
    updatedAt: new Date()
  });
  console.log(`📡 Emitted payment_status_changed to ${tutorSocketRoom}`);
}
```

---

### 2. Auto-Retry After Onboarding (`backend/routes/payments.js` - Line 1166)

Added WebSocket emission after auto-transferred payments:

```javascript
payment.stripeTransferId = transfer.id;
payment.stripeTransferAmount = payment.tutorPayout;
payment.transferredAt = new Date();
payment.transferStatus = 'succeeded';
await payment.save();

// Emit WebSocket event for real-time update
if (global.io) {
  const tutorSocketRoom = `user:${user._id}`;
  global.io.to(tutorSocketRoom).emit('payment_status_changed', {
    paymentId: payment._id.toString(),
    lessonId: payment.lessonId?.toString() || null,
    status: 'paid',
    transferStatus: 'succeeded',
    updatedAt: new Date()
  });
  console.log(`📡 Emitted payment_status_changed to ${tutorSocketRoom}`);
}
```

---

### 3. PayPal Payout Cron Job (`backend/jobs/processPayPalPayouts.js` - Line 115)

Added WebSocket emission after PayPal payout sent:

```javascript
payment.paypalBatchId = payoutResult.batchId;
payment.paypalPayoutItemId = payoutResult.payoutItemId;
payment.paypalPayoutStatus = 'success';
payment.transferredAt = new Date();
payment.transferStatus = 'succeeded';
payment.errorMessage = null;

await payment.save();

console.log(`✅ PayPal payout sent to ${paypalEmail} for $${payment.stripePayoutAmount}`);
paypalSent++;

// Emit WebSocket event for real-time update
if (global.io) {
  const tutorSocketRoom = `user:${tutor._id}`;
  global.io.to(tutorSocketRoom).emit('payment_status_changed', {
    paymentId: payment._id.toString(),
    lessonId: lessonId.toString(),
    status: 'paid',
    transferStatus: 'succeeded',
    updatedAt: new Date()
  });
  console.log(`📡 Emitted payment_status_changed to ${tutorSocketRoom}`);
}
```

---

### 4. PayPal Payout Webhook (`backend/routes/webhooks.js` - Line 179)

Added WebSocket emission in webhook handler:

```javascript
payment.paypalBatchId = payoutResult.batchId;
payment.paypalPayoutItemId = payoutResult.payoutItemId;
payment.paypalPayoutStatus = 'success';
payment.transferredAt = new Date();
payment.transferStatus = 'succeeded';
payment.errorMessage = null;

await payment.save();

console.log(`✅ [WEBHOOK] PayPal payout sent to ${paypalEmail} for $${payment.stripePayoutAmount}`);

// Emit WebSocket event for real-time update
if (global.io) {
  const tutorSocketRoom = `user:${tutor._id}`;
  global.io.to(tutorSocketRoom).emit('payment_status_changed', {
    paymentId: payment._id.toString(),
    lessonId: lesson._id.toString(),
    status: 'paid',
    transferStatus: 'succeeded',
    updatedAt: new Date()
  });
  console.log(`📡 [WEBHOOK] Emitted payment_status_changed to ${tutorSocketRoom}`);
}
```

---

## Frontend (Already Working)

The frontend WebSocket listener was already set up correctly in `websocket.service.ts` (lines 260-264):

```typescript
// Listen for payment status changes
this.socket.on('payment_status_changed', (data: { paymentId: string; lessonId: string; status: string; updatedAt: Date }) => {
  console.log('💳 Payment status changed:', data);
  this.paymentStatusChangedSubject.next(data);
});
```

And the earnings page was already subscribed (lines 65-69 in `earnings.page.ts`):

```typescript
// Listen for payment updates
const paymentUpdateSub = this.websocketService.paymentStatusChanged$.subscribe((data: any) => {
  console.log('📡 Payment status changed:', data);
  // Reload earnings when payment status changes
  this.loadEarnings();
});
```

---

## How It Works

### Payment Status Flow

1. **Lesson completes** → Payment captured → `status: 'succeeded'`, `transferStatus: 'pending'`
2. **Transfer initiated** → Stripe/PayPal transfer created
3. **Transfer succeeds** → `transferStatus: 'succeeded'` + **WebSocket event emitted** ✨
4. **Frontend receives event** → `paymentStatusChanged$` fires
5. **Earnings page reloads** → Status changes from "Pending Transfer" to "Transferred"

### WebSocket Event Payload

```javascript
{
  paymentId: "6789abc...",
  lessonId: "1234def...",
  status: "paid",              // Frontend status (what getStatusText() expects)
  transferStatus: "succeeded", // Backend database status
  updatedAt: "2026-01-15T..."
}
```

---

## Testing

### Manual Test (Development)

1. Complete a lesson as a tutor
2. Payment should show "Pending Transfer"
3. Admin triggers transfer via `/api/payments/retry-pending-transfers`
4. **Status should instantly change to "Transferred"** without refreshing the page

### Automatic Test (Production)

1. Complete a lesson
2. Wait for Stripe Connect auto-transfer (happens immediately after lesson completes)
3. Status should update from "Pending Transfer" to "Transferred" automatically

### PayPal Payout Test

1. Tutor with PayPal payout method completes lesson
2. Stripe payout processes (2-7 days)
3. When payout arrives, PayPal transfer initiated
4. Status updates in real-time via WebSocket

---

## Benefits

### ✅ Real-Time Updates
- No manual page refresh needed
- Instant feedback when transfers complete
- Better user experience

### ✅ Consistent Behavior
- All transfer pathways now emit WebSocket events
- Manual, automatic, and webhook-triggered transfers all work the same

### ✅ Production Ready
- Safe checks (`if (global.io)`) prevent crashes if WebSocket not available
- Detailed logging for debugging
- Works with both Stripe and PayPal payout methods

---

## Related Files

- `backend/routes/payments.js` (2 locations)
- `backend/jobs/processPayPalPayouts.js` (1 location)
- `backend/routes/webhooks.js` (1 location)
- `language-learning-app/src/app/services/websocket.service.ts` (already working)
- `language-learning-app/src/app/earnings/earnings.page.ts` (already working)

---

## Console Output

When a transfer succeeds, you should now see:

```
✅ Transferred $10.00 to tutor (payment 6789abc...)
📡 Emitted payment_status_changed to user:1234def...
💳 Payment status changed: { paymentId: '6789abc...', status: 'paid', ... }
📡 Payment status changed: { ... }
💰 Loaded 5 payments
```

The earnings page will automatically reload and show the updated status! 🎉

---

## Previous Implementation

The WebSocket infrastructure was already in place, but the backend was never using it for payment status updates. This fix completes the real-time payment tracking feature.

