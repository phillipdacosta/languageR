# Transfer Status Mapping Fix

## Problem
Payment showing "Pending Transfer" even after being released to "available" status.

## Root Cause
**Backend-Frontend Mismatch**: The backend endpoint `/api/payments/tutor/earnings` was mapping `transferStatus` values to a computed `status` field, but it was missing cases for the new withdrawal system statuses (`'available'`, `'on_hold'`, etc.).

### Database Reality
```
Payment {
  status: 'succeeded'          // Stripe payment status
  transferStatus: 'available'  // Withdrawal system status (NEW)
}
```

### What Was Happening
```javascript
// backend/routes/payments.js (OLD CODE)
} else if (payment.transferStatus === 'succeeded') {
  paymentStatus = 'paid';
} else if (payment.revenueRecognized && lessonStatus === 'completed') {
  paymentStatus = 'pending';  // ❌ Fell through to here
```

The payment with `transferStatus: 'available'` didn't match any case, so it defaulted to `'pending'`, causing "Pending Transfer" to display.

## The Fix

### 1. Backend: Added New Transfer Status Cases
**File**: `backend/routes/payments.js` (lines 918-938)

```javascript
// OLD: Only checked for 'succeeded'
} else if (payment.transferStatus === 'succeeded') {
  paymentStatus = 'paid';
}

// NEW: Handle all withdrawal system statuses
} else if (payment.transferStatus === 'succeeded' || payment.transferStatus === 'withdrawn') {
  paymentStatus = 'paid';
} else if (payment.transferStatus === 'available') {
  // Released from 24hr hold, ready for withdrawal
  paymentStatus = 'succeeded'; // Frontend shows "Available"
} else if (payment.transferStatus === 'on_hold') {
  // During 24hr hold period
  paymentStatus = 'pending'; // Frontend shows "Pending Transfer"
}
```

### 2. Frontend: Added 'succeeded' Status Handling
**Files**: 
- `language-learning-app/src/app/earnings/earnings.page.ts`

```typescript
// getStatusText
case 'succeeded':
  return 'Available'; // Earnings ready for withdrawal

// getStatusColor
case 'succeeded':
  return 'success'; // Green badge
```

### 3. Frontend: Added Image Protection
**File**: `language-learning-app/src/app/earnings/earnings.page.html`

```html
<img 
  [src]="payment.studentPicture" 
  referrerpolicy="no-referrer"  <!-- Prevents CORS issues -->
  loading="lazy"                 <!-- Reduces concurrent requests -->
  (error)="onImageError($event)"> <!-- Graceful fallback -->
```

## Transfer Status Flow

```
Payment Created → 'pending'
     ↓
Lesson Completed → 'on_hold' (24hr hold)
     ↓
24 Hours Pass → releaseEarnings() cron job
     ↓
'available' (ready for withdrawal)
     ↓
Tutor Requests Withdrawal → 'pending_withdrawal'
     ↓
Payout Processed → 'withdrawn'/'succeeded'
```

## Status Mapping Reference

| transferStatus | Computed status | Frontend Display | Badge Color |
|----------------|----------------|------------------|-------------|
| `null` or `'pending'` | `'scheduled'` | "Scheduled" | Medium (gray) |
| `'on_hold'` | `'pending'` | "Pending Transfer" | Medium (gray) |
| **`'available'`** | **`'succeeded'`** | **"Available"** | **Success (green)** |
| `'pending_withdrawal'` | `'processing'` | "Processing" | Warning (orange) |
| `'withdrawn'` | `'paid'` | "Transferred" | Success (green) |
| `'succeeded'` | `'paid'` | "Transferred" | Success (green) |

## How to Prevent This in the Future

### ✅ When Adding New Transfer Statuses
1. **Update the mapping in `backend/routes/payments.js`** (lines 904-932)
2. **Add case to `getStatusText()` in frontend** if new display text is needed
3. **Add case to `getStatusColor()` in frontend** if new color is needed
4. **Test the full flow**: Create payment → Complete lesson → Wait 24hrs (or trigger manually) → Check frontend

### ✅ Testing Checklist
- [ ] Create a test payment
- [ ] Complete the lesson
- [ ] Trigger `releaseEarnings` job manually: `node manual-release.js`
- [ ] Check database: `transferStatus` should be `'available'`
- [ ] Check frontend: Should show **"Available"** with **green badge**
- [ ] Hard refresh browser to clear cache

### ✅ Common Pitfalls
1. **Don't forget both backend AND frontend** - They must stay in sync
2. **Always handle undefined/null cases** - Use `$or` conditions in queries
3. **Test with real data** - Mock data might not catch edge cases
4. **Clear browser cache** - Old API responses can mask issues

## Files Modified
- ✅ `backend/routes/payments.js` - Added `'available'` and `'on_hold'` cases
- ✅ `language-learning-app/src/app/earnings/earnings.page.ts` - Added `'succeeded'` handling
- ✅ `language-learning-app/src/app/earnings/earnings.page.html` - Added image protection

## Date
January 20, 2026



