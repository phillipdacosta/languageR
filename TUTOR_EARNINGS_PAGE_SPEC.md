# Tutor Earnings/Wallet Page Specification

## Overview
The tutor earnings page shows tutors their payment history, upcoming payouts, and financial summary. This is distinct from the student wallet, which is for prepaid lesson credits.

---

## Page Location
- **Route**: `/tabs/home/earnings` (tutor-only)
- **Guard**: `TutorOnlyGuard` (similar to `StudentOnlyGuard`)
- **Accessed from**: Home page wallet/earnings insight metric (for tutors)

---

## UI Components

### 1. Earnings Summary Card
Shows tutor's key financial metrics at a glance.

**Fields**:
- **Total Earnings**: Sum of all completed lesson payouts
- **Pending Earnings**: Lessons completed but not yet paid out (within 24-48h hold period)
- **This Month**: Earnings for current calendar month
- **Last Payout**: Date and amount of most recent Stripe transfer

**Style**: Gradient card similar to student wallet balance display

---

### 2. Quick Stats
- **Lessons Completed**: Count of all completed lessons
- **Average Lesson Rate**: Total earnings / lessons completed
- **Platform Fee Rate**: Display "25%" or actual percentage

---

### 3. Payment History List
Scrollable list of all completed lesson payments.

**Each Item Shows**:
- Student name (e.g., "Emily S.")
- Lesson date & time
- Lesson duration (e.g., "50 min")
- **Lesson Price**: What student paid (e.g., "$25.00")
- **Platform Fee**: Amount kept by platform (e.g., "-$6.25")
- **Your Payout**: Amount tutor received (e.g., "$18.75")
- **Payout Status**: 
  - ⏳ "Pending" (lesson complete, funds reserved)
  - ✅ "Paid" (transferred to Stripe Connect account)
  - ⚠️ "Failed" (payout failed, needs attention)
- **Payout Date**: When transfer occurred (if paid)

**Filters**:
- All / Paid / Pending / Failed
- Date range picker

---

### 4. Stripe Connect Status Banner
If tutor hasn't completed Stripe Connect onboarding:

```
⚠️ Complete Your Payout Setup
You need to connect your bank account to receive payments.
[Complete Setup] button → redirects to Stripe Connect onboarding
```

If onboarded:
```
✅ Payouts Enabled
Funds are automatically transferred to your connected account.
[View Stripe Dashboard] button
```

---

### 5. Office Hours Billing Details (if applicable)
Separate section showing per-minute billing history:
- List of office hours sessions
- Start/end time
- Actual duration billed
- Rate per minute
- Total charged

---

## Data Sources

### Backend Endpoints Needed
1. `GET /api/payments/tutor/earnings-summary`
   - Returns: `{ totalEarnings, pendingEarnings, thisMonthEarnings, lastPayout }`

2. `GET /api/payments/tutor/payment-history`
   - Query params: `?status=all&limit=50&offset=0`
   - Returns: Array of payment records with lesson details

3. `GET /api/payments/stripe-connect/status`
   - Already exists
   - Returns: `{ onboarded, chargesEnabled, payoutsEnabled }`

4. `GET /api/payments/tutor/payout-history`
   - Returns: List of Stripe transfers (actual bank payouts)

---

## Database Queries
From `Payment` model:
- Filter by `tutorId`
- Include `lessonId` populated with lesson details
- Include `studentId` populated for student name
- Sort by `revenueRecognizedAt` descending

---

## Business Rules
1. **Payout Timing**: Funds are transferred 24-48 hours after lesson completion
2. **Failed Payouts**: If transfer fails, show alert and allow retry
3. **Refunded Lessons**: Show with strikethrough and "Refunded" badge
4. **Office Hours**: Show actual duration and per-minute calculation

---

## Design Notes
- **Color Scheme**: Use success/green theme (vs. student wallet's purple)
- **Icons**: 
  - 💰 for earnings
  - 📊 for stats
  - 🏦 for Stripe/bank info
- **Mobile-first**: Ensure card layout works on small screens
- **Loading States**: Skeleton loaders for earnings summary and payment history

---

## Future Enhancements
- **Export to CSV**: Download payment history for tax purposes
- **Tax Documents**: Link to year-end tax summaries
- **Analytics**: Earnings trends, peak booking times, student retention
- **Instant Payout**: Optional fast payout (with fee) via Stripe Express

---

## Implementation Priority
**Phase 1** (MVP):
- Earnings summary card
- Payment history list
- Stripe Connect status banner

**Phase 2**:
- Filters and date range
- Payout history
- Office hours billing breakdown

**Phase 3**:
- Analytics and charts
- CSV export
- Tax documents

---

## Testing Scenarios
1. **New tutor (no earnings)**: Show empty state with onboarding prompt
2. **Tutor with pending earnings**: Display pending amount prominently
3. **Tutor with failed payout**: Show error banner with retry button
4. **Tutor not onboarded**: Block access until Stripe Connect complete
5. **Office hours tutor**: Show both fixed-price and per-minute billing

---

## Related Files
- **Component**: `language-learning-app/src/app/earnings/earnings.page.ts`
- **Service**: `language-learning-app/src/app/services/earnings.service.ts`
- **Guard**: `language-learning-app/src/app/guards/tutor-only.guard.ts`
- **Backend Route**: `backend/routes/payments.js` (add tutor-specific endpoints)
- **Backend Service**: `backend/services/paymentService.js` (add tutor earnings methods)

---

## Key Differences from Student Wallet
| Feature | Student Wallet | Tutor Earnings |
|---------|----------------|----------------|
| Purpose | Prepay for lessons | View payment history |
| Actions | Top up, view balance | View payouts, connect bank |
| Balance | Available + Reserved | Pending + Paid |
| Payment Method | Wallet or card | Stripe Connect only |
| Top-up | Yes | No |

---

**Status**: Specification Complete ✅  
**Implementation**: Pending user approval


