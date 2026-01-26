# Earnings Page - Cancelled Lessons Display Fix

## Issue
Cancelled lessons were showing as "Pending Transfer" instead of "Cancelled" on the `/tabs/earnings` page. These lessons never happened and should be clearly marked as cancelled with appropriate styling.

---

## Root Cause
The frontend code was missing the `'cancelled'` status handling even though the backend was correctly returning `status: 'cancelled'` for cancelled lessons (see `backend/routes/payments.js` line 912-913).

The frontend only had handlers for:
- `paid`
- `pending`
- `in_progress`
- `processing`
- `scheduled`

---

## Changes Made

### 1. TypeScript (`earnings.page.ts`)

#### Updated Interface
Added `'cancelled'` to the status union type and `cancelReason` field:

```typescript
interface PaymentBreakdown {
  id: string;
  studentName: string;
  date: Date;
  tutorPayout: number;
  platformFee: number;
  status: 'paid' | 'pending' | 'in_progress' | 'processing' | 'scheduled' | 'cancelled';
  lessonStatus: string;
  lessonId: string;
  cancelReason?: string;
}
```

#### Updated Helper Methods

**`getStatusColor()`** - Returns red/danger color for cancelled:
```typescript
case 'cancelled':
  return 'danger';
```

**`getStatusIcon()`** - Returns close-circle icon for cancelled:
```typescript
case 'cancelled':
  return 'close-circle';
```

**`getStatusText()`** - Returns "Cancelled" text:
```typescript
case 'cancelled':
  return 'Cancelled';
```

**`getStatusNote()`** - Shows cancel reason or default message:
```typescript
if (payment.status === 'cancelled') {
  return payment.cancelReason || 'Lesson was cancelled';
}
```

---

### 2. HTML Template (`earnings.page.html`)

#### Added Cancelled Class to Payment Items
```html
<ion-item 
  *ngFor="let payment of recentPayments" 
  class="payment-item"
  [class.in-progress]="payment.status === 'in_progress'"
  [class.processing]="payment.status === 'processing'"
  [class.cancelled]="payment.status === 'cancelled'"
  ...>
```

#### Added Cancelled Note Styling
```html
<div *ngIf="getStatusNote(payment)" 
     class="status-note" 
     [class.cancelled-note]="payment.status === 'cancelled'">
```

#### Updated Payment Amounts Display
Shows $0.00 earnings for cancelled lessons and "Refunded" label:

```html
<div class="amount-row tutor-payout" [class.cancelled-amount]="payment.status === 'cancelled'">
  <span class="amount-label">Your Earnings</span>
  <span class="amount-value">
    <ng-container *ngIf="payment.status === 'cancelled'">
      <span class="cancelled-label">$0.00</span>
    </ng-container>
    <ng-container *ngIf="payment.status !== 'cancelled'">
      ${{ payment.tutorPayout.toFixed(2) }}
    </ng-container>
  </span>
</div>

<!-- Platform Fee shows $0.00 -->
<div class="amount-row platform-fee">
  <span class="amount-label">Platform Fee (20%)</span>
  <span class="amount-value">
    <ng-container *ngIf="payment.status === 'cancelled'">$0.00</ng-container>
    <ng-container *ngIf="payment.status !== 'cancelled'">-${{ payment.platformFee.toFixed(2) }}</ng-container>
  </span>
</div>

<!-- Total shows strikethrough + "Refunded" -->
<div class="amount-row total">
  <span class="amount-label">Lesson Price</span>
  <span class="amount-value">
    <ng-container *ngIf="payment.status === 'cancelled'">
      <span class="strikethrough">${{ (payment.tutorPayout + payment.platformFee).toFixed(2) }}</span>
      <span class="cancelled-label">Refunded</span>
    </ng-container>
    <ng-container *ngIf="payment.status !== 'cancelled'">
      ${{ (payment.tutorPayout + payment.platformFee).toFixed(2) }}
    </ng-container>
  </span>
</div>
```

---

### 3. SCSS Styles (`earnings.page.scss`)

#### Added Cancelled Status Badge Styling
```scss
&[data-status='cancelled'] {
  background: rgba(var(--ion-color-danger-rgb), 0.1);
  color: var(--ion-color-danger-shade);
}
```

#### Existing Styles (Already Present)
- `.payment-item.cancelled` - Red left border and reduced opacity
- `.status-note.cancelled-note` - Red background tint with danger icon color
- `.amount-row.tutor-payout.cancelled-amount` - Strikethrough and cancelled label styling

---

## Backend Behavior (Unchanged)

The backend already correctly handles cancelled lessons in `backend/routes/payments.js`:

```javascript
// Line 912-913
if (lessonStatus === 'cancelled') {
  paymentStatus = 'cancelled';
}
```

The backend returns:
- `status: 'cancelled'`
- `lessonStatus: 'cancelled'`
- `cancelReason: string` (if available)
- `tutorPayout: 0` (or original amount before refund)

---

## Visual Changes

### Before ❌
- Cancelled lessons showed "⏱️ Pending Transfer" (yellow/warning)
- No indication that the lesson was cancelled
- Earnings amount showed as if money would be received
- Confusing for tutors who expected payment

### After ✅
- Cancelled lessons show "🚫 Cancelled" badge (red/danger)
- Red left border on cancelled items
- Status note shows cancel reason (e.g., "Cancelled by student" or "Auto-cancelled")
- Earnings show **$0.00** (clear indication no payment)
- Platform fee shows **$0.00**
- Lesson price shows **strikethrough + "Refunded"** label
- Reduced opacity (0.8) to visually de-emphasize cancelled items

---

## Testing Checklist

- [x] Cancelled lesson shows "Cancelled" badge with red color
- [x] Status note displays cancel reason or default message
- [x] Earnings amount shows $0.00 for cancelled lessons
- [x] Platform fee shows $0.00 for cancelled lessons
- [x] Total shows strikethrough original price + "Refunded"
- [x] Cancelled items have red left border
- [x] All other statuses still work correctly (paid, pending, in_progress, etc.)

---

## Impact

### No Breaking Changes
- All existing functionality preserved
- Only adds handling for cancelled status
- Backend was already returning correct data

### Improved User Experience
- Clear visual distinction for cancelled lessons
- No confusion about expected payments
- Accurate representation of earnings ($0.00 for cancelled)
- Informative cancel reasons displayed

---

## Example Display

**Cancelled Lesson:**
```
┌─────────────────────────────────────────┐
│ 🚫 Cancelled                            │
│ ───────────────────────────────────     │ ← Red left border
│ 👤 Jason H.                             │
│                                         │
│ ℹ️ Auto-cancelled - No one joined      │ ← Cancel reason
│                                         │
│ 📅 Jan 13, 2026                         │
│                                         │
│ Your Earnings           $0.00           │ ← No earnings
│ Platform Fee (20%)      $0.00           │
│ ─────────────────────────────────       │
│ Lesson Price      $12.50  Refunded      │ ← Strikethrough + label
└─────────────────────────────────────────┘
```

---

## Related Files

- `language-learning-app/src/app/earnings/earnings.page.ts`
- `language-learning-app/src/app/earnings/earnings.page.html`
- `language-learning-app/src/app/earnings/earnings.page.scss`
- `backend/routes/payments.js` (line 912-913, already correct)

---

## Previous Implementation

This fix restores and enhances the cancelled lesson handling that may have been partially implemented before. The styling infrastructure was already in place in the SCSS (lines 210-213, 347-353, 410-426), but the TypeScript and HTML were missing the cancelled status cases.

