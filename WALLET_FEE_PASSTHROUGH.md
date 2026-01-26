# Wallet Fee Passthrough Implementation

## Problem Solved

### Cash Flow Issue
Previously, when students topped up their wallets, the platform absorbed the Stripe processing fees immediately:
- Student tops up $50 → Stripe takes $2.50 → Platform out of pocket **$2.50 NOW**
- Platform only recoups fee when student books lessons (could be days/weeks/never)
- At scale: 1,000 students = **$2,500** out of pocket in upfront costs

### Solution
Pass Stripe fees to customers during wallet top-up, following industry standard (Venmo, PayPal, Cash App).

---

## Changes Implemented

### 1. Frontend: Wallet Top-Up Modal
**Files Modified:**
- `language-learning-app/src/app/components/wallet-topup-modal/wallet-topup-modal.component.ts`
- `language-learning-app/src/app/components/wallet-topup-modal/wallet-topup-modal.component.html`
- `language-learning-app/src/app/components/wallet-topup-modal/wallet-topup-modal.component.scss`

**What Changed:**
- Added `stripeFee` and `totalCharge` computed properties
- Displays clear fee breakdown before payment:
  ```
  Wallet credit:     $50.00
  Processing fee:    $2.50  (2.9% + $0.30)
  ─────────────────────────
  Total charge:      $52.50
  ```
- Modal now passes 3 values: `walletCredit`, `totalCharge`, `stripeFee`

### 2. Frontend: Wallet Page
**Files Modified:**
- `language-learning-app/src/app/wallet/wallet.page.ts`

**What Changed:**
- Updated `processTopUpWithSavedCard()` to accept 3 parameters
- Updated `initiateTopUp()` to accept 3 parameters
- Changed API calls to send:
  - `walletCredit` - Amount to credit to wallet
  - `totalCharge` - Amount to charge customer (including fee)
  - `stripeFee` - Fee breakdown for records

### 3. Backend: Wallet Routes
**Files Modified:**
- `backend/routes/wallet.js`

**What Changed:**
- **`POST /api/wallet/top-up`** (new card flow):
  - Now accepts `walletCredit`, `totalCharge`, `stripeFee`
  - Validates that `totalCharge > walletCredit`
  - Creates PaymentIntent for `totalCharge` amount
  - Stores all values in metadata

- **`POST /api/wallet/top-up-with-saved-card`** (saved card flow):
  - Now accepts `walletCredit`, `totalCharge`, `stripeFee`
  - Charges customer the TOTAL amount (`totalCharge`)
  - Credits wallet with only `walletCredit` amount
  - Records actual Stripe fee for accounting

### 4. Backend: Wallet Service
**Files Modified:**
- `backend/services/walletService.js`

**What Changed:**
- **`initiateTopUp()`**:
  - Updated to accept `walletCredit`, `totalCharge`, `stripeFee`
  - Creates PaymentIntent for `totalCharge` (not `walletCredit`)
  - Stores all values in metadata for webhook processing

- **`confirmTopUp()`**:
  - No changes needed - already credits `amount` parameter
  - When called, `amount` will be `walletCredit` (not `totalCharge`)

---

## How It Works

### New Card Flow
```
1. User enters $50 in modal
2. Frontend calculates:
   - stripeFee = (50 * 0.029) + 0.30 = $2.50
   - totalCharge = 50 + 2.50 = $52.50
3. Frontend displays breakdown to user
4. User clicks "Continue"
5. Backend creates PaymentIntent for $52.50
6. User enters card details
7. Stripe charges $52.50 from card
8. Backend credits wallet with $50.00
9. Stripe fee recorded as $2.50 for accounting
```

### Saved Card Flow
```
1. User enters $50 in modal
2. Frontend calculates fee ($2.50) and total ($52.50)
3. User selects saved card and clicks "Continue"
4. Backend immediately charges $52.50
5. Backend credits wallet with $50.00
6. User sees: "Successfully added $50.00 to your wallet!"
```

---

## Economic Impact

### Before (Absorbing Fees)
```
Customer action:     Top up $50
Stripe charge:       $50.00
Stripe fee:          -$2.50 (paid by platform)
Platform out:        -$2.50 NOW
Wallet credit:       +$50.00
Platform recovery:   When student books lessons
```

### After (Passing Fees)
```
Customer action:     Top up $50
Customer sees:       "Total: $52.50"
Stripe charge:       $52.50
Stripe fee:          -$2.50 (paid from customer's $52.50)
Platform out:        $0.00 ✅
Wallet credit:       +$50.00
Platform profit:     Immediate (from lesson bookings)
```

---

## Benefits

✅ **Zero upfront cost** - No cash flow impact on platform  
✅ **Industry standard** - All major payment apps (Venmo, PayPal, Cash App) do this  
✅ **Transparent** - Clear fee breakdown shown before payment  
✅ **Scalable** - Works with 1 user or 100,000 users  
✅ **Accounting** - Stripe fees properly tracked in Payment records

---

## Testing Checklist

### New Card Top-Up
- [ ] Open wallet page
- [ ] Click "Top Up"
- [ ] Enter $50
- [ ] Verify fee breakdown shows:
  - Wallet credit: $50.00
  - Processing fee: $2.50
  - Total charge: $52.50
- [ ] Click "Continue"
- [ ] Click "Add new card"
- [ ] Enter test card: `4242 4242 4242 4242`
- [ ] Complete payment
- [ ] Verify wallet credited with $50.00 (not $52.50)
- [ ] Check Stripe dashboard: charge should be $52.50

### Saved Card Top-Up
- [ ] Open wallet page
- [ ] Click "Top Up"
- [ ] Enter $100
- [ ] Verify fee breakdown shows:
  - Wallet credit: $100.00
  - Processing fee: $3.20
  - Total charge: $103.20
- [ ] Select saved card
- [ ] Click "Continue"
- [ ] Verify wallet credited with $100.00 (not $103.20)
- [ ] Check Stripe dashboard: charge should be $103.20

### Edge Cases
- [ ] Try minimum amount ($1) → Should charge $1.59
- [ ] Try maximum amount ($500) → Should charge $514.80
- [ ] Try amount below $1 → Should show validation error
- [ ] Try amount above $500 → Should show validation error

---

## Database Impact

### Payment Records
All wallet top-up Payment records now include:
```javascript
{
  amount: 52.50,              // Total charged (NEW: was 50.00)
  stripeFee: 2.50,            // Actual Stripe fee
  stripeNetAmount: 50.00,     // Amount after Stripe fee
  paymentType: 'wallet_top_up',
  metadata: {
    walletCredit: 50.00,      // NEW: Amount credited to wallet
    stripeFee: 2.50,          // NEW: Fee passed to customer
    type: 'wallet_top_up'
  }
}
```

### Wallet Transactions
Wallet transaction records show the wallet credit amount:
```javascript
{
  type: 'top_up',
  amount: 50.00,              // Amount credited to wallet
  balanceAfter: 150.00,       // New wallet balance
  stripePaymentIntentId: 'pi_xxx',
  description: 'Wallet top-up: $50.00',
  metadata: {
    stripeFee: 2.50           // Fee for reference
  }
}
```

---

## Migration Notes

### Existing Top-Ups
Old wallet top-ups (before this change) will have:
- `amount` = wallet credit amount
- `stripeFee` = absorbed by platform

New wallet top-ups (after this change) will have:
- `amount` = total charge (including fee)
- `stripeFee` = passed to customer
- `metadata.walletCredit` = actual wallet credit

No database migration needed - the system handles both formats.

---

## Support Impact

### Customer Questions
**Q: "Why am I being charged $52.50 for a $50 top-up?"**  
A: The additional $2.50 covers the payment processing fee. This is standard across the industry (Venmo, PayPal, Cash App all do this). It ensures you receive the full $50.00 in your wallet.

**Q: "Other platforms don't charge fees!"**  
A: Most platforms either charge fees or build them into their pricing. We show fees transparently rather than hiding them in increased lesson prices.

**Q: "Can I avoid the fee?"**  
A: The fee is a standard payment processing cost from our payment provider (Stripe). It applies to all card transactions to ensure secure, reliable payments.

---

## Rollback Plan

If issues arise, rollback is straightforward:

1. **Frontend**: Revert changes to wallet-topup-modal component
2. **Frontend**: Revert changes to wallet.page.ts
3. **Backend**: Revert routes/wallet.js to pass `amount` instead of `totalCharge`
4. **Backend**: Revert services/walletService.js to accept `amount` parameter

System will immediately return to absorbing fees.

---

## Future Enhancements

### Potential Improvements
1. **Bulk Discount** - Reduce fee % for large top-ups ($200+)
2. **Subscription Model** - Offer fee-free top-ups for premium members
3. **ACH/Bank Transfer** - Lower fee option (1% instead of 2.9%)
4. **Promotional Credits** - Platform covers fee for first top-up

---

## Summary

**What we fixed**: Platform was paying Stripe fees upfront for wallet top-ups, creating cash flow problems.

**How we fixed it**: Pass Stripe fees to customers with transparent breakdown before payment.

**Impact**: Zero upfront cost, infinitely scalable, industry-standard approach.

**Result**: Platform only makes money when lessons are booked, not losing money on wallet top-ups.

