# Payment Monitoring & Reconciliation System

## Overview
This system ensures all payments are properly captured, tracked, and reconciled with Stripe. It provides real-time monitoring, automated checks, and admin tools to resolve any payment issues.

---

## 🛡️ Protection Layers

### 1. **Prevention** (Fixed Auto-Finalize No-Show Bug)
**File**: `backend/jobs/autoFinalizeLessons.js` → `finalizeLesson()`

**What was wrong**:
- Auto-finalize job was marking ALL lessons as `status: 'completed'`, even no-shows
- When nobody joined (`actualCallStartTime` was null), it should have:
  - Set lesson status to `'cancelled'` (not `'completed'`)
  - Cancelled the Stripe PaymentIntent to release the hold
  - Updated payment status to `'refunded'`
- Instead, it just logged "no capture or payout" but left the lesson as "completed"
- This caused the lesson to appear finished, and later processes tried to capture payment
- The sync issue happened because payment was marked in DB but Stripe was never called

**What's fixed**:
```javascript
// ✅ NOW: Check if lesson actually happened
if (!lesson.actualCallStartTime) {
  // NO-SHOW: Set to cancelled, not completed
  lesson.status = 'cancelled';
  lesson.cancelledBy = 'system';
  lesson.cancelReason = 'No-show by both parties';
  
  // Cancel the Stripe PaymentIntent
  await stripe.paymentIntents.cancel(payment.stripePaymentIntentId);
  payment.status = 'refunded';
  await payment.save();
}
```

**Result**: No-show lessons are properly cancelled and payments are released automatically.

---

### 2. **Secondary Prevention** (Database/Stripe Sync)
**File**: `backend/services/paymentService.js` → `deductLessonFunds()`

**Additional protection**:
```javascript
// ✅ Update DB ONLY after Stripe confirms capture
const capturedIntent = await stripe.paymentIntents.capture(piId);

if (capturedIntent.status !== 'succeeded') {
  throw new Error('Capture failed');
}

// Only update DB after Stripe confirms success
payment.status = 'succeeded';
payment.chargedAt = new Date();
await payment.save();
```

**Result**: Even if auto-finalize has bugs, payment capture won't create sync issues.

---

### 3. **Real-Time Detection** (Webhook Alerts)
**File**: `backend/routes/webhooks.js`

Stripe sends instant webhooks when:
- ❌ `payment_intent.payment_failed`
- 🚫 `payment_intent.canceled`
- 💸 `charge.refunded`
- ⚠️ `charge.dispute.created`
- 💰 `payout.failed` / `payout.canceled`

Each event:
1. Creates an Alert in the database
2. Sends WebSocket notification to admin dashboard (if online)
3. (Optional) Sends email alert to admin

**Admin sees these instantly** if they have the dashboard open.

---

### 4. **Automated Reconciliation** (Nightly Job)
**File**: `backend/jobs/reconcilePayments.js`

Runs every night at **2:00 AM** to check:

#### Check #1: Database vs Stripe Sync
- Finds payments marked "succeeded" in DB
- Verifies they're actually captured in Stripe
- Creates alerts for mismatches

#### Check #2: Stuck Authorizations
- Finds payments in "authorized" status for > 7 days
- These should have been captured or released
- Creates alerts for manual review

#### Check #3: Failed Payouts
- Finds tutor payouts that failed to send
- Checks Stripe Transfer status
- Creates alerts with error details

#### Check #4: Missing Payments
- Finds completed lessons with no payment record
- Critical issue: lesson happened but no money collected
- Creates alerts for investigation

#### Check #5: No-Show Auto-Release (NEW!)
- Finds lessons where:
  - End time > 1 hour ago
  - Nobody joined (`actualCallStartTime` is null)
  - DB shows "succeeded" but Stripe shows "requires_capture"
- **Automatically**:
  - Cancels the payment intent in Stripe
  - Updates DB status to "refunded"
  - Updates lesson status to "cancelled"
  - Creates an alert for record-keeping

#### Check #6: Stripe Payout Status Updates
- Checks Stripe for payout status changes
- Updates DB with latest status
- Creates alerts if payouts failed

---

### 5. **Admin Dashboard** (Manual Resolution Tools)
**URL**: `http://localhost:8100/admin/payment-review`

#### Summary Cards
- 🔴 Critical Alerts
- 🟡 High Priority Alerts
- 🟠 Medium Priority Alerts
- ⚪ Out of Sync Payments Count

#### Out of Sync Payments Section
Shows payments where DB ≠ Stripe status

**Resolution Actions**:
- **"Capture Payment"**: Manually capture in Stripe + update DB to "succeeded"
- **"Sync Database"**: Update DB to match Stripe's actual status

#### Stuck Authorizations Section
Shows payments authorized > 7 days ago

**Resolution Actions**:
- **"Manual Capture"**: Force capture the payment now

#### Failed Payouts Section
Shows tutor payouts that failed to send

**Info Displayed**:
- Tutor email
- Amount
- Error message
- Stripe Transfer ID
- PayPal Batch ID (if applicable)

#### Active Alerts Section
All unresolved alerts from webhooks and reconciliation

**Resolution Actions**:
- **"Resolve"**: Mark alert as handled (logs who resolved it and when)

---

## 🚨 Common Issues & How to Resolve

### Issue 1: "Out of Sync" Payment
**Symptom**: DB shows "succeeded", Stripe shows "requires_capture" (or vice versa)

**Cause**: 
- For OLD payments: Bug before the fix
- For NEW payments: Network error during capture (rare)

**Resolution**:
1. Go to Admin Dashboard → Out of Sync Payments
2. Check Stripe dashboard to see actual status
3. If Stripe is uncaptured:
   - Click **"Capture Payment"** to capture it now
   - OR cancel in Stripe if it's a no-show/cancelled lesson
4. If Stripe is succeeded:
   - Click **"Sync Database"** to update the DB

### Issue 2: No-Show Lesson with Uncaptured Payment
**Symptom**: Lesson ended, nobody joined, but payment still authorized in Stripe

**Auto-Fixed**: The nightly reconciliation job will:
- Detect these automatically
- Cancel the payment intent
- Update lesson to "cancelled"
- Create an alert for your records

**Manual Fix** (if you want to do it immediately):
1. Find the payment in Stripe dashboard
2. Click "Cancel" to release the hold
3. In your DB, update payment status to "refunded"
4. Update lesson status to "cancelled"

### Issue 3: Stuck Authorization (> 7 days)
**Symptom**: Payment has been "authorized" for over a week

**Cause**: Lesson was never finalized (bug in lesson flow)

**Resolution**:
1. Go to Admin Dashboard → Stuck Authorizations
2. Check the lesson status
3. If lesson happened:
   - Click **"Manual Capture"** to collect payment
4. If lesson didn't happen:
   - Cancel the payment in Stripe to release the hold

### Issue 4: Failed Payout to Tutor
**Symptom**: Payment was captured from student, but tutor didn't get paid

**Causes**:
- Stripe: Invalid bank account, insufficient Connect balance, account issues
- PayPal: Invalid email, account restricted, API error

**Resolution**:
1. Go to Admin Dashboard → Failed Payouts
2. Check the error message
3. Contact the tutor to verify their payout details
4. Fix their Stripe Connect account or PayPal email
5. Retry the payout manually from Stripe dashboard (Transfers section)

---

## 🔧 Admin Access

### How to Access Admin Dashboard
1. Navigate to: `http://localhost:8100/admin/payment-review`
2. You must be logged in as an admin user
3. Admin emails are defined in `backend/config.env`:
   ```env
   ADMIN_EMAIL=phillip.dacosta@gmail.com
   ```

### How Admin Authentication Works
The app uses "dev tokens" (e.g., `dev-token-phillip-dacosta-gmail-com`)

**Backend**: `backend/middleware/videoUploadMiddleware.js` → `verifyToken()`
- Checks for dev tokens in development
- Checks for JWT tokens in production
- Verifies user email matches `ADMIN_EMAIL` or `userType === 'admin'`

---

## 📊 Alert Types

| Type | Severity | Trigger | Auto-Fixed? |
|------|----------|---------|-------------|
| `PAYMENT_OUT_OF_SYNC` | HIGH | DB ≠ Stripe status | ❌ Manual |
| `STUCK_AUTHORIZATION` | MEDIUM | Authorized > 7 days | ❌ Manual |
| `FAILED_PAYOUT` | HIGH | Stripe/PayPal payout failed | ❌ Manual |
| `MISSING_PAYMENT` | CRITICAL | Completed lesson, no payment | ❌ Manual |
| `NO_SHOW_AUTO_RELEASED` | MEDIUM | No-show uncaptured payment | ✅ Auto |
| `PAYMENT_FAILED` | HIGH | Stripe webhook: payment failed | ❌ Manual |
| `PAYMENT_CANCELED` | MEDIUM | Stripe webhook: payment canceled | ℹ️ Info |
| `CHARGE_REFUNDED` | MEDIUM | Stripe webhook: charge refunded | ℹ️ Info |
| `CHARGE_DISPUTE` | CRITICAL | Stripe webhook: dispute created | ❌ Manual |
| `PAYOUT_FAILED` | HIGH | Stripe webhook: payout failed | ❌ Manual |
| `PAYOUT_CANCELED` | MEDIUM | Stripe webhook: payout canceled | ❌ Manual |

---

## 🔄 Testing the System

### Test 1: Check Current Payment Health
```bash
cd backend
node -e "
const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });
const { reconcilePayments } = require('./jobs/reconcilePayments');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  await reconcilePayments();
  await mongoose.disconnect();
  process.exit(0);
});
"
```

### Test 2: Verify a Specific Payment
```bash
cd backend
node -e "
require('dotenv').config({ path: './config.env' });
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

(async () => {
  const pi = await stripe.paymentIntents.retrieve('pi_XXXXX');
  console.log('Status:', pi.status);
  console.log('Amount Capturable:', pi.amount_capturable);
})();
"
```

### Test 3: Check Admin Dashboard
1. Open browser: `http://localhost:8100/admin/payment-review`
2. Should see summary cards with alert counts
3. Should see expandable sections for each issue type
4. WebSocket connection should be established (check browser console)

---

## 🚀 Production Readiness

✅ **Preventative Measures**
- Database only updates after Stripe confirms success
- All payment operations have error handling
- Logs all payment actions for audit trail

✅ **Real-Time Monitoring**
- Webhook handlers for all critical Stripe events
- WebSocket notifications to admin dashboard
- (Optional) Email alerts for critical issues

✅ **Automated Reconciliation**
- Nightly job checks all payments
- Auto-fixes no-show uncaptured payments
- Creates alerts for manual review items

✅ **Admin Tools**
- Full visibility into payment health
- One-click resolution for common issues
- Detailed error messages and context

✅ **Audit Trail**
- All alerts logged with timestamps
- Resolution tracked (who, when)
- Payment status changes logged

---

## 📝 Future Enhancements (Optional)

1. **Email Alerts**
   - Install `nodemailer`: `npm install nodemailer`
   - Add SMTP credentials to `config.env`
   - Get instant email notifications for critical alerts

2. **Slack/Discord Integration**
   - Add webhook to send alerts to team chat
   - Real-time notifications without checking dashboard

3. **Payment Analytics Dashboard**
   - Total revenue charts
   - Success rate tracking
   - Common failure patterns

4. **Automated Refunds**
   - Auto-refund if lesson cancelled within policy
   - Currently requires manual refund via Stripe

5. **Student Notification**
   - Auto-email student when payment fails
   - Request to update payment method

---

## 🐛 Debugging

### Check Backend Logs
```bash
tail -f /tmp/backend.log
```

### Check Reconciliation Job Status
Backend logs show:
```
🔍 [RECONCILE] Starting payment reconciliation job...
📊 [RECONCILE] Checking database vs Stripe sync...
...
✅ [RECONCILE] Payment reconciliation complete
📊 [RECONCILE] Issues found: 0
```

### Check WebSocket Connection
Open browser console on admin dashboard:
```javascript
// Should see:
"WebSocket connected"
```

### Check Alert Database
```bash
cd backend
node -e "
const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });
const Alert = require('./models/Alert');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const alerts = await Alert.find({ resolved: false }).sort({ createdAt: -1 });
  console.log('Unresolved Alerts:', alerts.length);
  alerts.forEach(a => console.log('-', a.type, ':', a.title));
  await mongoose.disconnect();
  process.exit(0);
});
"
```

---

## 📞 Support

For payment issues in production:
1. Check admin dashboard first
2. Review Stripe dashboard for actual payment status
3. Check backend logs for error messages
4. Use resolution tools to fix sync issues
5. For complex issues, manually investigate in Stripe + DB

**Remember**: The API is the source of truth, not the Stripe UI dashboard (it can cache).

---

**Last Updated**: January 8, 2026
**Status**: ✅ Production Ready

