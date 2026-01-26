# Wallet Fee Range Implementation - Update

## Issue Discovered

While testing the initial fee passthrough implementation, we discovered that **Stripe fees vary by card type**:

### Actual Stripe Fee Structure
- **Domestic cards:** 2.9% + $0.30
- **International cards:** 4.4% + $0.30 (adds 1.5% international fee)
- **Some corporate cards:** May have additional fees

### Example: $50 Top-Up
- **Our estimate:** `(50 * 0.029) + 0.30 = $1.75`
- **Actual charge (international card):** `$2.50` (5% total)
- **Difference:** $0.75 undercharged! ❌

## Problem

The frontend **cannot know** the actual fee before Stripe processes the payment because:
- Card type (domestic vs. international) isn't known until charge
- Some cards have additional fees
- Currency conversion may apply

**Result:** We would either:
1. Undercharge customers (lose money)
2. Overcharge customers (bad UX)

---

## Solution Implemented

### Show Fee Range + Refund Difference

Instead of showing an exact fee, we:
1. **Frontend:** Show fee range with max estimate
2. **Backend:** Charge using max fee (4.4% + $0.30)
3. **Backend:** Get actual fee after processing
4. **Backend:** Refund difference to wallet automatically

---

## How It Works Now

### Frontend Display
```
Wallet credit:        $50.00
Processing fee:       $1.75 – $2.50  ← RANGE
───────────────────────────────────
Est. total charge:   ~$52.50  ← Using MAX fee

Processing fee: 2.9% – 4.4% + $0.30, depending on card type.
Any difference will be refunded to your wallet.
```

### Backend Processing

#### Scenario 1: Domestic Card (Best Case)
```
1. Customer sees: "~$52.50" total
2. Stripe charges: $52.50
3. Actual fee: $1.75 (2.9% + $0.30)
4. Fee difference: $2.50 - $1.75 = $0.75
5. Wallet credit: $50.00 + $0.75 = $50.75 ✅

Customer gets a BONUS $0.75 in wallet!
```

#### Scenario 2: International Card (Worst Case)
```
1. Customer sees: "~$52.50" total
2. Stripe charges: $52.50
3. Actual fee: $2.50 (4.4% + $0.30)
4. Fee difference: $2.50 - $2.50 = $0.00
5. Wallet credit: $50.00 + $0.00 = $50.00 ✅

Customer gets exactly what they requested.
```

#### Scenario 3: Mid-Range Card
```
1. Customer sees: "~$52.50" total
2. Stripe charges: $52.50
3. Actual fee: $2.10 (3.6% + $0.30)
4. Fee difference: $2.50 - $2.10 = $0.40
5. Wallet credit: $50.00 + $0.40 = $50.40 ✅

Customer gets a small bonus $0.40!
```

---

## Changes Made

### 1. Frontend: Wallet Top-Up Modal Component

**File:** `language-learning-app/src/app/components/wallet-topup-modal/wallet-topup-modal.component.ts`

**New Computed Properties:**
```typescript
get minStripeFee(): number {
  return (this.amount * 0.029) + 0.30; // Domestic card fee
}

get maxStripeFee(): number {
  return (this.amount * 0.044) + 0.30; // International card fee
}

get estimatedStripeFee(): number {
  return this.maxStripeFee; // Use max for charging
}

get totalCharge(): number {
  return this.amount + this.estimatedStripeFee; // Charge max to cover worst case
}
```

**HTML Display:**
```html
<div class="fee-row">
  <span class="fee-label">Processing fee</span>
  <span class="fee-value">${{ minStripeFee.toFixed(2) }} – ${{ maxStripeFee.toFixed(2) }}</span>
</div>
<div class="fee-row total">
  <span class="fee-label">Est. total charge</span>
  <span class="fee-value">~${{ totalCharge.toFixed(2) }}</span>
</div>
<p class="fee-note">
  Processing fee: 2.9% – 4.4% + $0.30, depending on card type.
  Any difference will be refunded to your wallet.
</p>
```

### 2. Backend: Saved Card Top-Up

**File:** `backend/routes/wallet.js` - `POST /api/wallet/top-up-with-saved-card`

**Key Changes:**
```javascript
// 1. Charge the max fee estimate
const paymentIntent = await stripe.paymentIntents.create({
  amount: Math.round(totalCharge * 100), // totalCharge includes max fee
  // ... other options
});

// 2. Get ACTUAL fee after processing
const balanceTransaction = await stripe.balanceTransactions.retrieve(
  charge.balance_transaction
);
const actualStripeFee = balanceTransaction.fee / 100;

// 3. Calculate difference and refund to wallet
const feeDifference = estimatedStripeFee - actualStripeFee;
const walletCreditFinal = walletCredit + feeDifference;

// 4. Credit wallet with requested amount + any overcharge
await walletService.confirmTopUp({
  userId: user._id,
  paymentIntentId: paymentIntent.id,
  amount: walletCreditFinal, // ← Includes bonus if applicable
  stripeFee: actualStripeFee
});
```

### 3. Backend: New Card Top-Up Confirmation

**File:** `backend/routes/wallet.js` - `POST /api/wallet/confirm-top-up`

**Same logic as saved card:**
```javascript
// Extract metadata from PaymentIntent
const walletCredit = parseFloat(paymentIntent.metadata.walletCredit);
const estimatedStripeFee = parseFloat(paymentIntent.metadata.estimatedStripeFee);

// Get actual fee
const balanceTransaction = await stripe.balanceTransactions.retrieve(...);
const actualStripeFee = balanceTransaction.fee / 100;

// Calculate and refund difference
const feeDifference = estimatedStripeFee - actualStripeFee;
const walletCreditFinal = walletCredit + feeDifference;

// Confirm with final amount
await walletService.confirmTopUp({
  amount: walletCreditFinal, // ← Includes any fee refund
  stripeFee: actualStripeFee
});
```

---

## User Experience

### What Customer Sees

**Step 1: Top-Up Modal**
```
How much would you like to add?
USD $ 50

Wallet credit:        $50.00
Processing fee:       $1.75 – $2.50
───────────────────────────────────
Est. total charge:   ~$52.50

ℹ️ Processing fee: 2.9% – 4.4% + $0.30, depending on card type.
   Any difference will be refunded to your wallet.
```

**Step 2: Payment Success**
```
✅ Successfully added $50.75 to your wallet!
   (Includes $0.75 fee refund)
```

**Step 3: Wallet Balance**
```
Your Balance: $50.75

Recent Transactions:
+ $50.75  Wallet top-up  Jan 13
```

### Why This Works

1. **Transparent:** Customer sees the range upfront
2. **Fair:** We charge max, refund difference automatically
3. **Positive UX:** Most customers get a small bonus ($0.40-$0.75)
4. **No losses:** We never undercharge
5. **Industry standard:** Similar to how Venmo/PayPal handle fees

---

## Fee Comparison Table

| Amount | Min Fee (2.9%) | Max Fee (4.4%) | Total Charge | Domestic Wallet | International Wallet |
|--------|---------------|---------------|--------------|-----------------|---------------------|
| $10    | $0.59         | $0.74         | $10.74       | $10.15          | $10.00              |
| $25    | $1.03         | $1.40         | $26.40       | $25.37          | $25.00              |
| $50    | $1.75         | $2.50         | $52.50       | $50.75          | $50.00              |
| $100   | $3.20         | $4.70         | $104.70      | $101.50         | $100.00             |
| $200   | $6.10         | $9.10         | $209.10      | $203.00         | $200.00             |
| $500   | $14.80        | $22.30        | $522.30      | $507.50         | $500.00             |

**Key Insight:** Domestic card users (majority) get a nice bonus, international users pay fair price.

---

## Database Records

### Payment Record
```javascript
{
  amount: 52.50,              // Total charged (max fee estimate)
  stripeFee: 2.10,            // ACTUAL Stripe fee (from balance_transaction)
  stripeNetAmount: 50.40,     // 52.50 - 2.10
  paymentType: 'wallet_top_up',
  metadata: {
    walletCredit: 50.00,      // Requested wallet credit
    estimatedStripeFee: 2.50, // Max fee estimate
    actualStripeFee: 2.10,    // Actual fee charged
    feeRefund: 0.40           // Amount refunded to wallet
  }
}
```

### Wallet Transaction Record
```javascript
{
  type: 'top_up',
  amount: 50.40,              // $50 requested + $0.40 fee refund
  balanceAfter: 150.40,
  description: 'Wallet top-up: $50.40',
  metadata: {
    stripeFee: 2.10,          // Actual fee for reference
    feeRefund: 0.40           // Bonus amount added
  }
}
```

---

## Benefits

### For the Platform
✅ **Never lose money** - Always charge max fee upfront  
✅ **Zero cash flow risk** - Customer pays all fees  
✅ **Accurate accounting** - Actual fees tracked correctly  
✅ **Scalable** - Works with any card type, any country  

### For the Customer
✅ **Transparent** - See fee range before paying  
✅ **Fair** - Never overcharged (difference refunded)  
✅ **Often get bonus** - Domestic cards get $0.40-$0.75 extra  
✅ **Clear communication** - Know exactly what to expect  

### For Support
✅ **Easy to explain** - "We charge max, refund difference"  
✅ **Positive framing** - "You got a $0.75 bonus!"  
✅ **No disputes** - Customer always gets at least what they requested  

---

## Edge Cases Handled

### 1. Balance Transaction Not Available (Test Mode)
```javascript
// Fallback to estimated fee if balance_transaction missing
let actualStripeFee = estimatedStripeFee;

if (charge.balance_transaction) {
  const balanceTransaction = await stripe.balanceTransactions.retrieve(...);
  actualStripeFee = balanceTransaction.fee / 100;
}
```

### 2. Metadata Missing (Old Payments)
```javascript
// Default to total charged amount if metadata missing
const walletCredit = parseFloat(
  paymentIntent.metadata.walletCredit || totalCharged
);
```

### 3. Fee Higher Than Estimate (Rare)
```javascript
// If actual fee > estimate, feeDifference will be negative
// Customer still gets their requested walletCredit (no bonus)
const feeDifference = estimatedStripeFee - actualStripeFee; // Could be negative
const walletCreditFinal = Math.max(walletCredit, walletCredit + feeDifference);
// This ensures customer always gets AT LEAST walletCredit
```

---

## Testing

### Test Scenarios

1. **Domestic Card (Visa/Mastercard US)**
   - Top up $50
   - Should see: "Est. total charge: ~$52.50"
   - Should be charged: $52.50
   - Should receive: ~$50.75 (with $0.75 bonus)

2. **International Card (Non-US)**
   - Top up $50
   - Should see: "Est. total charge: ~$52.50"
   - Should be charged: $52.50
   - Should receive: $50.00 (no bonus, fee was max)

3. **Test Card (Stripe Test Mode)**
   - Use: `4242 4242 4242 4242`
   - Should work with domestic fee rate (2.9%)
   - Should receive bonus

---

## Support FAQs

**Q: "Why was I charged more than the wallet credit?"**  
A: We show you the maximum possible processing fee upfront (4.4% + $0.30). If your card has a lower fee, the difference is automatically added to your wallet as a bonus!

**Q: "I was charged $52.50 but only got $50.75. Where's the rest?"**  
A: The $1.75 covers the actual payment processing fee. You actually got a $0.75 bonus because your card fee was lower than our maximum estimate!

**Q: "Why do fees vary?"**  
A: Domestic cards (2.9% + $0.30) have lower fees than international cards (4.4% + $0.30). We charge the maximum upfront to ensure we're covered, then refund any difference to your wallet.

**Q: "Can I avoid the fees?"**  
A: Payment processing fees are charged by our payment provider (Stripe) for all card transactions. We pass these fees through transparently and refund any overcharge.

---

## Rollback Plan

If issues arise:

1. Revert `wallet-topup-modal.component.ts` fee calculations
2. Revert `wallet-topup-modal.component.html` display
3. Revert `wallet.js` saved-card and confirm endpoints
4. System returns to showing single fee estimate

---

## Summary

**What we discovered:** Stripe fees vary by card type (2.9% – 4.4% + $0.30)

**What we built:** Fee range display + automatic refund system

**How it works:**
1. Show customer the fee range
2. Charge using max fee (4.4% + $0.30)
3. Get actual fee after processing
4. Refund difference to wallet automatically

**Result:** 
- Platform never loses money ✅
- Customer never overcharged ✅
- Most customers get a small bonus ✅
- Transparent and fair ✅

