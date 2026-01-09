# Testing Stripe Connect Payouts - Quick Guide

## Option 1: Enable Stripe Connect (Recommended for Full Testing)

### Step 1: Enable Connect in Stripe Dashboard
1. Go to: https://dashboard.stripe.com/test/connect/accounts/overview
2. Click **"Get started with Connect"** or **"Activate your account"**
3. Fill out the platform information:
   - **Platform name**: Language Learning App
   - **Support email**: Your email
   - **Platform type**: Marketplace or Platform
4. Click **"Activate"**

### Step 2: Test the Onboarding Flow
1. In your app, go to Profile page as a tutor
2. Click **"SET UP PAYOUTS"**
3. Stripe will open a new window
4. Use **Stripe test data**:
   - **Routing number**: `110000000`
   - **Account number**: `000123456789`
   - **SSN**: `000000000` (for test mode)
5. Complete the form
6. You'll be redirected back to your app
7. The card will change to show ✓ "Payouts Enabled"

### Step 3: Complete a Lesson
1. Book a lesson as a student
2. Start and complete the lesson
3. Tutor will receive a notification: "You earned $X from your lesson..."
4. Check the earnings page to see the breakdown

---

## Option 2: Manual Database Update (Quick Test)

If you just want to test the UI without going through Stripe:

### MongoDB Shell Commands:
```javascript
// Connect to your database
use languageLearningDB

// Update the tutor to mark them as onboarded
db.users.updateOne(
  { email: "travelbuggler2@gmail.com" },
  { 
    $set: { 
      stripeConnectAccountId: "acct_test_123456789",
      stripeConnectOnboarded: true 
    } 
  }
)

// Verify the update
db.users.findOne(
  { email: "travelbuggler2@gmail.com" },
  { email: 1, stripeConnectOnboarded: 1, stripeConnectAccountId: 1 }
)

// Update existing payments to show as "transferred"
db.payments.updateMany(
  { tutorId: ObjectId("691a73483717945967bff353") },
  { 
    $set: { 
      transferStatus: "succeeded",
      transferredAt: new Date(),
      stripeTransferId: "tr_test_123456789"
    } 
  }
)
```

After running these commands:
1. Refresh your profile page → Will show green ✓ "Payouts Enabled"
2. Go to earnings page → Will show "$12.38 Transferred" (green)
3. Complete another lesson → Will receive notification immediately

---

## Option 3: Use Stripe CLI (Most Realistic Testing)

### Install Stripe CLI:
```bash
# Mac
brew install stripe/stripe-cli/stripe

# Login
stripe login
```

### Forward Webhooks:
```bash
stripe listen --forward-to localhost:3000/api/payments/webhook
```

### Trigger Test Events:
```bash
# Simulate a successful payout
stripe trigger payout.paid
```

---

## Recommended Approach

**For your first test**, I recommend **Option 2 (Manual Database Update)** to quickly see:
- ✅ "Payouts Enabled" success state on profile
- ✅ Earnings breakdown on earnings page
- ✅ Payment notification when lesson completes
- ✅ "Transferred" status (green) vs "Pending" (orange)

**Then**, enable Stripe Connect (Option 1) for real testing with actual Stripe flows.

---

## Current State Debug

Your current payments:
```
Payment 1: $6.00 (pending)
Payment 2: $6.375 (pending)
Total: $12.375 pending
```

These are showing as "pending" because:
1. Tutor hasn't completed Stripe Connect onboarding, OR
2. Stripe Connect isn't enabled in your dashboard

To fix: Use Option 2 to test the UI, then Option 1 for full integration.


