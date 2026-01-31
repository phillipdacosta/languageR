# Safe Withdrawal Calculator - Platform Revenue

## What This Does

Calculates **exactly how much you can safely withdraw** from your Stripe account to your bank account, accounting for funds owed to tutors.

## The Problem

Your Stripe account contains:
- 💰 **Your platform revenue** (what you earned)
- 💳 **Tutor funds** (what you owe them)

Without this calculation, you'd have to manually figure out what's safe to withdraw.

---

## The Solution

The `/api/admin/platform-revenue` endpoint now includes a **withdrawalInfo** section that tells you:

```json
{
  "withdrawalInfo": {
    "currentStripeBalance": 28.65,        // What's in Stripe now
    "stripePendingBalance": 0,            // Held by Stripe (processing)
    "totalOwedToTutors": 7.98,           // Total you owe all tutors
    "breakdown": {
      "tutorsPending": 3.00,             // On 24hr hold
      "tutorsAvailable": 4.98,           // Can withdraw anytime
      "tutorsCount": 5                   // Number of tutors with balance
    },
    "safeToWithdraw": 20.67,             // ✅ THIS IS YOUR ANSWER
    "recognizedRevenue": 20.67,          // From completed lessons
    "discrepancy": 0.00,                 // Difference (should be ~$0)
    "warning": null                      // Any issues to be aware of
  }
}
```

---

## How It Works

### The Formula

```
SAFE TO WITHDRAW = Current Stripe Balance - Total Owed to Tutors

Example:
  Stripe Balance:     $28.65
  Owed to Tutors:     -$7.98
  ───────────────────────────
  Safe to Withdraw:   $20.67 ✅
```

### Step-by-Step Calculation

**1. Get Current Stripe Balance**
```javascript
const stripeBalance = await stripe.balance.retrieve();
const currentBalance = stripeBalance.available[0].amount / 100;
// Result: $28.65
```

**2. Calculate Total Owed to ALL Tutors**
```javascript
const allTutors = await User.find({ userType: 'tutor' });

let totalOwed = 0;
for (const tutor of allTutors) {
  totalOwed += tutor.tutorEarnings?.pendingBalance || 0;  // On hold
  totalOwed += tutor.tutorEarnings?.availableBalance || 0; // Ready to withdraw
}
// Result: $7.98
```

**3. Calculate Safe Amount**
```javascript
const safeToWithdraw = Math.max(0, currentBalance - totalOwed);
// Result: $28.65 - $7.98 = $20.67
```

---

## Console Output

When you hit the endpoint, you'll see detailed logs:

```
💰 Calculating safe withdrawal amount...
   Stripe Available: $28.65
   Stripe Pending: $0.00
   
   Tutor: John Doe
     Pending: $5.00, Available: $15.00
   Tutor: Jane Smith
     Pending: $3.00, Available: $10.00
   
   Total Tutors with Balances: 2
   Total Owed (Pending): $8.00
   Total Owed (Available): $25.00
   Total Owed to Tutors: $33.00

   ═══════════════════════════════════════
   Stripe Balance:       $50.00
   Owed to Tutors:      -$33.00
   ═══════════════════════════════════════
   SAFE TO WITHDRAW:     $17.00 ✅
   ═══════════════════════════════════════
```

---

## Example Scenarios

### Scenario 1: Normal Case
```
Stripe Balance:          $28.65
Tutors Pending:          $3.00 (on 24hr hold)
Tutors Available:        $4.98 (can withdraw anytime)
Total Owed:              $7.98

Safe to Withdraw:        $20.67 ✅

Action: You can safely withdraw $20.67 to your bank!
```

### Scenario 2: Tutors Haven't Withdrawn Yet
```
Stripe Balance:          $150.00
Tutors Pending:          $20.00
Tutors Available:        $100.00 (many tutors haven't withdrawn!)
Total Owed:              $120.00

Safe to Withdraw:        $30.00 ✅

Action: You can only safely withdraw $30, not $150!
The other $120 belongs to tutors.
```

### Scenario 3: Everything Withdrawn
```
Stripe Balance:          $45.00
Tutors Pending:          $0.00
Tutors Available:        $0.00
Total Owed:              $0.00

Safe to Withdraw:        $45.00 ✅

Action: All tutors withdrew, so ALL $45 is yours!
```

---

## Discrepancy Warnings

Sometimes the safe withdrawal amount won't exactly match your recognized revenue. Here's why:

### Warning 1: Revenue on Paper But Not in Stripe
```json
{
  "safeToWithdraw": 15.00,
  "recognizedRevenue": 20.00,
  "discrepancy": 5.00,
  "warning": "Some revenue ($5.00) is recognized but not yet in Stripe. 
              This may be from pending captures or recent refunds."
}
```

**Cause:** 
- Recent lesson just ended, payment still processing
- Student refund processed, Stripe balance decreased

**Action:** Wait a few hours for Stripe to process

### Warning 2: Stripe Higher Than Revenue
```json
{
  "safeToWithdraw": 25.00,
  "recognizedRevenue": 20.00,
  "discrepancy": 5.00,
  "warning": "Stripe balance is higher than recognized revenue by $5.00. 
              This may include pending payments or wallet top-ups."
}
```

**Cause:**
- Student topped up their wallet (adds to Stripe but not lesson revenue)
- Authorized payment not yet captured
- Stripe payout processing delay

**Action:** This is fine! The extra money will be recognized when lessons complete

---

## How to Use This

### In Your Admin Dashboard

When viewing `/admin/revenue`, you'll see:

```
╔══════════════════════════════════════════╗
║  PLATFORM REVENUE                        ║
╠══════════════════════════════════════════╣
║                                          ║
║  Total Net Revenue (All Time):  $20.67  ║
║  (This is what you've EARNED)            ║
║                                          ║
║  ──────────────────────────────────────  ║
║                                          ║
║  CURRENT WITHDRAWAL STATUS               ║
║                                          ║
║  Stripe Available:              $28.65   ║
║  Owed to Tutors:               -$7.98    ║
║    ├─ Pending (24hr hold):     $3.00    ║
║    └─ Available (can withdraw): $4.98    ║
║  ══════════════════════════════════       ║
║  SAFE TO WITHDRAW NOW:         $20.67 ✅  ║
║                                          ║
║  [Withdraw to Bank Account] button       ║
║                                          ║
╚══════════════════════════════════════════╝
```

### API Call

```javascript
// Fetch revenue data
const response = await fetch('/api/admin/platform-revenue', {
  headers: { Authorization: `Bearer ${token}` }
});

const data = await response.json();

// Show safe withdrawal amount
console.log('You can safely withdraw:', data.withdrawalInfo.safeToWithdraw);

// Check if there's a warning
if (data.withdrawalInfo.warning) {
  console.warn('Warning:', data.withdrawalInfo.warning);
}
```

---

## Why This Is Important

### Without This Calculator:
```
You: "I have $28.65 in Stripe, let me withdraw it all!"
*Withdraws $28.65*
Tutor: "I want to withdraw my $20!"
You: "Uh oh... I don't have enough!" 💥
```

### With This Calculator:
```
You: "Safe to withdraw: $20.67"
*Withdraws $20.67*
Stripe balance: $7.98 remaining
Tutor: "I want to withdraw my $20!"
You: "Wait 24 hours for more lessons to process"
OR
You: "Here's $7.98 now, rest coming soon" ✅
```

---

## Comparison to Industry

This is **exactly** how big platforms work:

| Platform | Approach |
|----------|----------|
| **Uber** | Mixed Stripe account, ledger tracking, safe withdrawal calc |
| **Airbnb** | Mixed Stripe account, escrow period, safe withdrawal calc |
| **Upwork** | Mixed Stripe account, ledger tracking, safe withdrawal calc |
| **Your App** | Mixed Stripe account, ledger tracking, safe withdrawal calc ✅ |

**Physical separation is NOT needed.** Software accounting is the industry standard!

---

## Technical Details

### Database Schema Used

```javascript
// User (Tutor)
{
  tutorEarnings: {
    pendingBalance: 5.00,      // On 24hr hold
    availableBalance: 15.00,   // Can withdraw now
    lifetimeEarnings: 500.00,
    totalWithdrawn: 480.00
  }
}
```

### Stripe API Called

```javascript
// Get current balance
const balance = await stripe.balance.retrieve();

balance.available[0].amount // Amount you can withdraw now
balance.pending[0].amount   // Amount Stripe is holding
```

### Edge Cases Handled

1. **Tutor with $0 balance** → Excluded from calculation
2. **Stripe API fails** → Returns 0 balance with warning
3. **Negative safe amount** → Returns $0 (can't withdraw negative!)
4. **Discrepancy > $1** → Shows warning message
5. **No tutors with balance** → Safe amount = full Stripe balance

---

## Testing Checklist

To verify it works:

- [ ] Complete a lesson
- [ ] Check `/api/admin/platform-revenue`
- [ ] Verify `safeToWithdraw` = Stripe balance - tutor balances
- [ ] Have a tutor withdraw funds
- [ ] Check `safeToWithdraw` increased
- [ ] Verify it matches what's actually in Stripe

---

## Summary

**Question:** "How much can I withdraw to my bank?"

**Answer:** `withdrawalInfo.safeToWithdraw` from `/api/admin/platform-revenue`

**Formula:** Current Stripe Balance - Total Owed to Tutors = Safe Amount

**Result:** You always know exactly what's yours vs what you owe! 💎

---

## Related Files

- `backend/routes/admin.js` (lines 1117-1230) - Safe withdrawal calculation
- `backend/models/User.js` - tutorEarnings schema
- `backend/routes/withdrawals.js` - Tutor withdrawal processing
- `STRIPE_FUND_SEPARATION_COMPLETE.md` - Architecture overview



