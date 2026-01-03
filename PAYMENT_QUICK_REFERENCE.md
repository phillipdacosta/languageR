# Payment & Wallet System - Quick Reference

## 🚀 Quick Start

### 1. Add Stripe Keys to .env

```bash
STRIPE_SECRET_KEY=sk_test_51...
STRIPE_PUBLISHABLE_KEY=pk_test_...
FRONTEND_URL=http://localhost:8100
```

### 2. Restart Backend

```bash
cd /Users/phillipdacosta/language-app/backend
npm start
```

### 3. Test Endpoints

```bash
# Check wallet balance
curl http://localhost:3000/api/wallet/balance \
  -H "Authorization: Bearer YOUR_TOKEN"

# Initiate wallet top-up
curl -X POST http://localhost:3000/api/wallet/top-up \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 50}'
```

---

## 📡 API Endpoints

### Wallet Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/wallet/balance` | Get wallet balance |
| POST | `/api/wallet/top-up` | Initiate top-up |
| POST | `/api/wallet/confirm-top-up` | Confirm after Stripe payment |
| GET | `/api/wallet/transactions` | Transaction history |

### Payment Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/payments/create-payment-intent` | For card payments |
| POST | `/api/payments/book-lesson` | Book with wallet/card |
| POST | `/api/payments/complete-lesson` | Complete after lesson |
| POST | `/api/payments/refund-lesson` | Refund a lesson |
| GET | `/api/payments/history` | Payment history |
| GET | `/api/payments/lesson/:id` | Payment details |
| POST | `/api/payments/stripe-connect/onboard` | Tutor onboarding |
| GET | `/api/payments/stripe-connect/status` | Check onboarding |

---

## 💳 Stripe Test Cards

- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **3D Secure**: `4000 0025 0000 3155`
- **Expiry**: Any future date (12/34)
- **CVC**: Any 3 digits

---

## 🔄 Payment Flows

### Wallet Top-Up Flow

```
1. POST /api/wallet/top-up { amount: 50 }
   → Returns: { clientSecret, paymentIntentId }

2. Frontend: Use Stripe.js to complete payment

3. POST /api/wallet/confirm-top-up { paymentIntentId }
   → Wallet credited with $50
```

### Book Lesson Flow

```
Option A: Wallet Payment
POST /api/payments/book-lesson {
  lessonId: "...",
  paymentMethod: "wallet"
}

Option B: Card Payment
1. POST /api/payments/create-payment-intent { amount: 25 }
2. Frontend: Complete with Stripe.js
3. POST /api/payments/book-lesson {
     lessonId: "...",
     paymentMethod: "card",
     stripePaymentIntentId: "pi_..."
   }
```

### Lesson Completion (Automatic)

```
When lesson ends:
→ /api/lessons/:id/call-end
→ Triggers paymentService.completeLessonPayment()
→ Deducts from wallet (if applicable)
→ Transfers 85% to tutor via Stripe Connect
→ Recognizes 15% platform fee as revenue
```

---

## 💰 Money Flow

```
Student Payment: $25
├─ Stripe Fee: ~$1 (absorbed by platform)
├─ Platform Fee: $3.75 (15%)
└─ Tutor Payout: $21.25 (85%)
```

---

## 🎯 Key Features

✅ **Wallet System** - Prepaid credits (not withdrawable)  
✅ **Direct Payments** - Card & Apple Pay via Stripe  
✅ **Tutor Payouts** - Automated via Stripe Connect  
✅ **Per-Minute Billing** - For office hours  
✅ **Refunds** - Wallet preferred, card fallback  
✅ **Revenue Recognition** - Deferred until lesson completion  
✅ **Transaction History** - Full audit trail  
✅ **Platform Fee** - 15% commission  

---

## 🔧 Frontend Integration Tasks

### 1. Wallet Page

```typescript
// Get balance
const balance = await fetch('/api/wallet/balance');

// Top-up
const { clientSecret } = await fetch('/api/wallet/top-up', {
  method: 'POST',
  body: JSON.stringify({ amount: 50 })
});

// Use Stripe Elements to complete payment
const stripe = await loadStripe('pk_test_...');
await stripe.confirmPayment({ clientSecret, ... });

// Confirm top-up
await fetch('/api/wallet/confirm-top-up', {
  method: 'POST',
  body: JSON.stringify({ paymentIntentId })
});
```

### 2. Booking Flow

```typescript
// Check balance first
const { availableBalance } = await fetch('/api/wallet/balance');

if (availableBalance >= lessonPrice) {
  // Book with wallet
  await fetch('/api/payments/book-lesson', {
    method: 'POST',
    body: JSON.stringify({
      lessonId,
      paymentMethod: 'wallet'
    })
  });
} else {
  // Book with card
  const { clientSecret } = await fetch('/api/payments/create-payment-intent', {
    method: 'POST',
    body: JSON.stringify({ amount: lessonPrice, lessonId })
  });
  
  // Complete payment with Stripe
  const { paymentIntent } = await stripe.confirmPayment({ clientSecret });
  
  // Book lesson
  await fetch('/api/payments/book-lesson', {
    method: 'POST',
    body: JSON.stringify({
      lessonId,
      paymentMethod: 'card',
      stripePaymentIntentId: paymentIntent.id
    })
  });
}
```

### 3. Tutor Dashboard

```typescript
// Start onboarding
const { onboardingUrl } = await fetch('/api/payments/stripe-connect/onboard', {
  method: 'POST'
});
window.location.href = onboardingUrl;

// Check status
const { onboarded, chargesEnabled, payoutsEnabled } = 
  await fetch('/api/payments/stripe-connect/status');
```

---

## 🚨 Common Issues

### "Insufficient wallet balance"
- Check `availableBalance` (not just `balance`)
- Reserved funds are locked until lesson completes

### "Payment failed"
- Verify Stripe test cards
- Check Stripe Dashboard logs
- Ensure test mode keys are set

### "Transfer to tutor failed"
- Tutor must complete Stripe Connect onboarding
- Check `stripeConnectOnboarded` status

---

## 📚 File Locations

### Models
- `/backend/models/Wallet.js`
- `/backend/models/Payment.js`
- `/backend/models/User.js` (updated)
- `/backend/models/Lesson.js` (updated)

### Services
- `/backend/services/stripeService.js`
- `/backend/services/walletService.js`
- `/backend/services/paymentService.js`

### Routes
- `/backend/routes/wallet.js`
- `/backend/routes/payments.js`

### Integration
- `/backend/routes/lessons.js` (updated with payment completion)
- `/backend/server.js` (routes registered)

---

**Full documentation**: See `PAYMENT_WALLET_SYSTEM_COMPLETE.md`


