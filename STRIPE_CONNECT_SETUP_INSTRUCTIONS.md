# Stripe Connect Setup - INSTRUCTIONS

## ⚠️ Important: Enable Stripe Connect First

Before tutors can set up payouts, you need to **enable Stripe Connect** in your Stripe dashboard:

### Steps to Enable Stripe Connect:

1. **Go to Stripe Dashboard**: https://dashboard.stripe.com/test/connect/accounts/overview
   
2. **Click "Get Started" or "Settings"** in the Connect section

3. **Choose "Platform or Marketplace"** account type

4. **Enable Express Accounts** (recommended for tutors)

5. **Configure settings**:
   - Brand name: "Language Learning Platform" (or your app name)
   - Support email: Your support email
   - Return URL: `http://localhost:8100/tabs/profile`
   - Refresh URL: `http://localhost:8100/tabs/profile`

6. **Save settings**

### After Enabling Connect:

The "Set Up Payouts" button on the tutor's profile page (`/tabs/profile`) will work correctly.

---

## For Tutors - How to Set Up Payouts:

1. **Log in as tutor**
2. **Go to Profile page** (`/tabs/profile`)
3. **See "Connect Bank Account" card**
4. **Click "Set Up Payouts"** button
5. **Stripe onboarding opens** in new window
6. **Enter information**:
   - Business/personal details
   - Bank account (use test: Routing `110000000`, Account `000123456789`)
   - Tax information
7. **Complete setup** → Refresh profile page
8. **See success message**: "Payouts Enabled"

---

## Payment Flow After Setup:

```
Student completes lesson
    ↓
Platform calculates payout:
  - Lesson price: $7.50
  - Platform fee (15%): $1.13
  - Tutor payout (85%): $6.37
    ↓
Stripe transfers $6.37 to tutor's bank
    ↓
Tutor receives funds in 1-2 business days
```

---

## Test Mode vs. Production:

**Test Mode** (current):
- Use test bank account numbers
- No real money transferred
- Instant setup approval

**Production**:
- Real bank account required
- Real money transfers
- May require identity verification

---

**Button Location**: `/tabs/profile` (tutor profile page)
**Status**: Moved from home page ✅


