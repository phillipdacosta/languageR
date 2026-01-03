# Payment & Wallet System - Implementation Complete

## 🎉 Overview

A comprehensive payment system for the language learning platform featuring:
- **Wallet System**: Prepaid credits for lessons and office hours
- **Direct Payments**: Card and Apple Pay support via Stripe
- **Stripe Connect**: Automated tutor payouts
- **Per-Minute Billing**: For office hours sessions
- **Platform Fee**: 15% commission with revenue recognition
- **Refund System**: Wallet-preferred refunds with card fallback

---

## 📦 What Was Implemented

### ✅ Core Components

#### Models
1. **`Wallet.js`** - Ledger-based wallet system
   - Balance tracking (total, reserved, available)
   - Transaction history
   - Not transferable, not withdrawable

2. **`Payment.js`** - Payment transaction records
   - Tracks all monetary transactions
   - Stripe integration fields
   - Platform fee and tutor payout tracking
   - Revenue recognition

3. **User Model Updates** - Stripe integration
   - `stripeCustomerId` - For students
   - `stripeConnectAccountId` - For tutors
   - `defaultPaymentMethod` - Preference tracking

4. **Lesson Model Updates** - Payment linking
   - `paymentId` - Links to Payment record
   - `paymentMethod` - How student paid
   - `revenueRecognized` - Revenue recognition flag
   - `platformFee` & `tutorPayout` - Fee breakdown

#### Services

1. **`stripeService.js`** - Stripe API wrapper
   - Payment Intent creation
   - Stripe Connect management
   - Transfers to tutors
   - Refunds

2. **`walletService.js`** - Wallet operations
   - Top-up initiation & confirmation
   - Fund reservation & deduction
   - Refunds to wallet
   - Transaction history

3. **`paymentService.js`** - Payment orchestration
   - Lesson booking (wallet or card)
   - Payment completion & tutor payout
   - Refund processing
   - Payment history

#### API Routes

1. **`/api/wallet`** - Wallet management
   - `GET /balance` - Get wallet balance
   - `POST /top-up` - Initiate wallet top-up
   - `POST /confirm-top-up` - Confirm top-up
   - `GET /transactions` - Transaction history

2. **`/api/payments`** - Payment operations
   - `POST /create-payment-intent` - For direct payments
   - `POST /book-lesson` - Book with wallet/card
   - `POST /complete-lesson` - Complete payment
   - `POST /refund-lesson` - Process refund
   - `GET /history` - Payment history
   - `GET /lesson/:id` - Payment details
   - `POST /stripe-connect/onboard` - Tutor onboarding
   - `GET /stripe-connect/status` - Onboarding status

#### Integrations

- **Lesson Flow Integration**: Payment completion triggers automatically when lessons end
- **Browser Close Handling**: Payments complete even if user closes tab
- **Office Hours Support**: Per-minute billing calculated correctly

---

## 🔧 Setup Instructions

### 1. Install Dependencies

Already done:
```bash
npm install stripe
```

### 2. Environment Variables

Add to `/Users/phillipdacosta/language-app/backend/.env`:

```bash
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_your_test_key_here
STRIPE_PUBLISHABLE_KEY=pk_test_your_test_key_here

# Frontend URL (for Stripe Connect redirects)
FRONTEND_URL=http://localhost:8100
```

### 3. Get Stripe Keys

1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Sign up/login
3. Get **Test Mode** API keys:
   - Click "Developers" → "API keys"
   - Copy "Publishable key" and "Secret key"
4. Enable **Stripe Connect**:
   - Go to "Connect" → "Settings"
   - Enable Express accounts

### 4. Restart Backend

```bash
cd /Users/phillipdacosta/language-app/backend
npm start
```

---

## 🧪 Testing Guide

### Test Wallet Operations

#### 1. Top-Up Wallet

```bash
# Get wallet balance
curl -X GET http://localhost:3000/api/wallet/balance \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN"

# Initiate top-up ($50)
curl -X POST http://localhost:3000/api/wallet/top-up \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 50}'

# Returns: { clientSecret, paymentIntentId }
# Use clientSecret in frontend Stripe.js to complete payment

# Confirm top-up (after Stripe payment succeeds)
curl -X POST http://localhost:3000/api/wallet/confirm-top-up \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paymentIntentId": "pi_xxx"}'
```

#### 2. Test Cards

Use Stripe test cards:
- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **3D Secure**: `4000 0025 0000 3155`
- Expiry: Any future date (e.g., 12/34)
- CVC: Any 3 digits

### Test Lesson Booking

#### Book with Wallet

```bash
curl -X POST http://localhost:3000/api/payments/book-lesson \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "lessonId": "LESSON_ID_HERE",
    "paymentMethod": "wallet"
  }'
```

#### Book with Card

```bash
# Step 1: Create Payment Intent
curl -X POST http://localhost:3000/api/payments/create-payment-intent \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 25,
    "lessonId": "LESSON_ID_HERE"
  }'

# Step 2: Complete payment in frontend with Stripe.js

# Step 3: Book lesson
curl -X POST http://localhost:3000/api/payments/book-lesson \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "lessonId": "LESSON_ID_HERE",
    "paymentMethod": "card",
    "stripePaymentIntentId": "pi_xxx"
  }'
```

### Test Tutor Onboarding

```bash
# Start Stripe Connect onboarding
curl -X POST http://localhost:3000/api/payments/stripe-connect/onboard \
  -H "Authorization: Bearer TUTOR_AUTH_TOKEN"

# Returns: { onboardingUrl }
# Tutor visits URL to complete onboarding

# Check status
curl -X GET http://localhost:3000/api/payments/stripe-connect/status \
  -H "Authorization: Bearer TUTOR_AUTH_TOKEN"
```

### Test Lesson Completion

Lessons automatically complete payments when:
1. Call ends normally (via `/api/lessons/:id/call-end`)
2. Browser closes (via `/api/lessons/:id/leave-beacon`)

To manually trigger:
```bash
curl -X POST http://localhost:3000/api/payments/complete-lesson \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"lessonId": "LESSON_ID_HERE"}'
```

### Test Refunds

```bash
# Refund to wallet (preferred)
curl -X POST http://localhost:3000/api/payments/refund-lesson \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "lessonId": "LESSON_ID_HERE",
    "reason": "Tutor no-show",
    "refundMethod": "wallet"
  }'

# Refund to card (Stripe fees NOT refunded)
curl -X POST http://localhost:3000/api/payments/refund-lesson \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "lessonId": "LESSON_ID_HERE",
    "reason": "Cancelled within 24h",
    "refundMethod": "card"
  }'
```

---

## 💰 Payment Flows

### Flow 1: Wallet Top-Up

```
Student → Frontend: "Add $50 to wallet"
Frontend → Backend: POST /api/wallet/top-up
Backend → Stripe: Create PaymentIntent
Stripe → Frontend: client_secret
Frontend → Stripe.js: Complete payment
Stripe → Backend: payment_intent.succeeded webhook
Backend → Database: Add $50 to wallet balance
Backend → Student: Updated balance
```

### Flow 2: Book Lesson with Wallet

```
Student → Frontend: "Book lesson ($25)"
Frontend → Backend: POST /api/payments/book-lesson (wallet)
Backend → WalletService: Reserve $25
WalletService → Database: reservedBalance += 25
Backend → Database: Create Payment record (status: succeeded)
Backend → Database: Update lesson (paymentId, billingStatus: authorized)
Backend → Student: "Lesson booked!"
```

### Flow 3: Lesson Completion

```
Lesson Ends → Backend: POST /api/lessons/:id/call-end
Backend → Database: Mark lesson completed
Backend → PaymentService: completeLessonPayment()
PaymentService → WalletService: Deduct $25 from wallet
WalletService → Database: balance -= 25, reservedBalance -= 25
PaymentService → Stripe: Transfer $21.25 to tutor (85% of $25)
Stripe → Tutor Stripe Account: $21.25
PaymentService → Database: Mark revenueRecognized = true (platform fee: $3.75)
Backend → Student: "Analysis ready!"
```

### Flow 4: Refund

```
Support/System → Backend: POST /api/payments/refund-lesson
Backend → PaymentService: refundLesson()
PaymentService → WalletService: Add $25 to wallet
WalletService → Database: balance += 25
PaymentService → Database: payment.status = 'refunded'
PaymentService → Database: lesson.billingStatus = 'refunded'
Backend → Student: "Refunded $25 to wallet"
```

---

## 🏗️ Architecture

### Principle: Separation of Concerns

```
Routes (API Layer)
  ↓
Services (Business Logic)
  ↓
Models (Data Layer)
  ↓
Database (MongoDB)
  ↓
Stripe (External Payment Provider)
```

### Wallet as Ledger

- **Wallet is NOT a bank account**
- Actual funds live in Stripe platform balance
- Wallet is just internal bookkeeping
- All transactions logged for audit trail

### Revenue Recognition

Platform fee (15%) is only recognized as revenue **after** lesson completion:
- `lesson.revenueRecognized = false` → **Deferred revenue** (liability)
- `lesson.revenueRecognized = true` → **Recognized revenue** (after lesson delivered)

---

## 🚨 Important Notes

### Security

1. **Never expose Stripe Secret Key** in frontend
2. **Always verify PaymentIntents** server-side
3. **Use webhooks** for production (not implemented yet)
4. **Validate user authorization** on all endpoints

### Compliance

- ✅ No peer-to-peer transfers (compliant)
- ✅ Credits only usable for platform services (compliant)
- ✅ No wallet withdrawals (compliant)
- ✅ Tutor payouts via Stripe Connect (compliant)

### Production Checklist

- [ ] Switch to Stripe Live Mode keys
- [ ] Implement Stripe webhooks for reliability
- [ ] Add transaction receipts/invoices
- [ ] Implement dispute handling
- [ ] Add KYC verification for tutors
- [ ] Set up proper error monitoring
- [ ] Test cancellation policies
- [ ] Implement tax reporting (1099 forms for tutors)

---

## 📊 Database Schema Summary

### Wallet
```javascript
{
  userId: ObjectId,
  balance: Number,           // Total balance
  reservedBalance: Number,   // Locked for pending lessons
  availableBalance: Number,  // balance - reservedBalance (virtual)
  transactions: [{
    type: 'top_up' | 'deduction' | 'refund' | 'reservation' | 'release',
    amount: Number,
    balanceAfter: Number,
    lessonId: ObjectId,
    createdAt: Date
  }]
}
```

### Payment
```javascript
{
  userId: ObjectId,
  lessonId: ObjectId,
  amount: Number,
  paymentMethod: 'wallet' | 'card' | 'apple_pay',
  paymentType: 'lesson_booking' | 'office_hours' | 'wallet_top_up',
  status: 'pending' | 'succeeded' | 'failed' | 'refunded',
  stripePaymentIntentId: String,
  stripeFee: Number,          // Stripe takes this
  platformFee: Number,        // Platform earns this (15%)
  tutorPayout: Number,        // Tutor receives this (85%)
  stripeTransferId: String,   // Payout to tutor
  transferredAt: Date,
  refundAmount: Number,
  refundMethod: 'wallet' | 'card'
}
```

### Lesson Updates
```javascript
{
  // ... existing fields ...
  paymentId: ObjectId,        // Link to Payment record
  paymentMethod: String,
  platformFee: Number,
  tutorPayout: Number,
  revenueRecognized: Boolean,
  revenueRecognizedAt: Date
}
```

### User Updates
```javascript
{
  // ... existing fields ...
  stripeCustomerId: String,           // For students
  stripeConnectAccountId: String,     // For tutors
  stripeConnectOnboarded: Boolean,
  defaultPaymentMethod: 'wallet' | 'card'
}
```

---

## 🎯 Next Steps

### Frontend Implementation Needed

1. **Wallet Page**
   - Display balance, reserved, available
   - Top-up button with Stripe Elements
   - Transaction history display

2. **Booking Flow**
   - Payment method selection (wallet vs card)
   - Stripe Payment Element integration
   - Balance check before wallet payment

3. **Tutor Dashboard**
   - Stripe Connect onboarding button
   - Payout history
   - Earnings summary

4. **Payment History**
   - List of all transactions
   - Lesson payment details
   - Refund status

### Backend Improvements

1. **Webhooks** - Critical for production
   - `payment_intent.succeeded`
   - `transfer.created`
   - `account.updated`

2. **Refund Policies** - Automated refunds based on cancellation time
3. **Email Notifications** - Payment confirmations, receipts
4. **Admin Dashboard** - Revenue tracking, dispute resolution

---

## 📞 Support

For questions or issues:
1. Check logs in `/Users/phillipdacosta/language-app/backend`
2. Review this documentation
3. Check Stripe Dashboard for payment details
4. Test with Stripe test cards first

---

**Implementation Date**: December 31, 2025  
**Status**: ✅ **CORE SYSTEM COMPLETE - READY FOR FRONTEND INTEGRATION**


