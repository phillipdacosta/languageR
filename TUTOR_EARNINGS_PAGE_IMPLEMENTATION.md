# Tutor Earnings Page Implementation

## Overview
Created a dedicated earnings page for tutors to view detailed breakdown of their earnings from completed lessons.

## Page Structure

### Route
- **Path**: `/tabs/earnings`
- **Component**: `EarningsPage` (standalone)
- **Access**: Tutors only

### Navigation
Tutors can access the earnings page by clicking the **Earnings** metric on the home page.

## Features

### 1. Summary Cards
Two prominent cards at the top showing:

#### Transferred Card (Green)
- **Icon**: Checkmark circle
- **Amount**: Total earnings that have been transferred to bank
- **Sublabel**: "In your bank account"
- **Color**: Green gradient

#### Pending Card (Orange)
- **Icon**: Clock/time
- **Amount**: Earnings awaiting transfer (tutor not onboarded or transfer pending)
- **Sublabel**: "Awaiting transfer"
- **Color**: Orange gradient

### 2. Total Earnings Display
Large centered display showing:
- **Total**: Sum of transferred + pending earnings
- **Format**: `$XX.XX`
- **Style**: Bold, 3em font size

### 3. Recent Lessons Breakdown
List of recent completed lessons with payment details:

#### Each Lesson Card Shows:
- **Student Name**: "FirstName L." format
- **Transfer Status**: 
  - 🟢 "Transferred" (green) - Money in bank
  - 🟠 "Pending Transfer" (orange) - Awaiting Stripe
- **Date**: "MMM d, y" format (e.g., "Dec 31, 2024")
- **Payment Breakdown**:
  - Your Earnings: `$6.00` (green, emphasized)
  - Platform Fee (20%): `-$1.50` (gray)
  - Lesson Price: `$7.50` (bold total)

#### Interactions:
- **Clickable**: Tapping any lesson navigates to lesson analysis page
- **Chevron icon**: Right arrow to indicate it's clickable

### 4. Help Text
Informational banner at bottom:
- **Icon**: Information circle
- **Text**: "Earnings are transferred to your bank account within 2-7 business days after lesson completion."

### 5. Empty State
If no completed lessons:
- Document icon
- "No completed lessons yet"
- "Earnings from completed lessons will appear here"

## Technical Implementation

### Frontend Files

#### 1. `earnings.page.ts`
```typescript
interface PaymentBreakdown {
  id: string;
  studentName: string;
  date: Date;
  tutorPayout: number;
  platformFee: number;
  status: 'paid' | 'pending';
  lessonId: string;
}

- loadEarnings(): Fetches data from backend
- viewLesson(lessonId): Navigates to lesson analysis
- getStatusColor/Icon/Text(): Helper methods for status display
```

#### 2. `earnings.page.html`
- Loading skeleton
- Error state with retry button
- Summary cards (transferred/pending)
- Total earnings display
- Payment breakdown list
- Help text banner

#### 3. `earnings.page.scss`
- Responsive grid layout for summary cards
- Card styling with gradients
- Payment item styling
- Status badges
- Mobile-responsive breakpoints

### Navigation Updates

#### Home Page (`tab1.page.html`)
**Before**: Clicking earnings navigated to profile page
```html
(click)="router.navigate(['/tabs/profile'])"
```

**After**: Now navigates to earnings page
```html
(click)="navigateToEarnings()"
```

**Also Updated**: Display shows total + pending instead of just total
```html
${{ (tutorTotalEarnings + tutorPendingEarnings).toFixed(2) }}
```

#### Home Page Logic (`tab1.page.ts`)
Added navigation method:
```typescript
navigateToEarnings() {
  this.router.navigate(['/tabs/earnings']);
}
```

### Backend API

Uses existing endpoint:
```
GET /api/payments/tutor/earnings
```

Returns:
```json
{
  "success": true,
  "totalEarnings": 6.00,
  "pendingEarnings": 6.375,
  "recentPayments": [
    {
      "id": "...",
      "studentName": "Jason G.",
      "date": "2024-12-31T...",
      "tutorPayout": 6.00,
      "platformFee": 1.50,
      "status": "pending",
      "lessonId": "..."
    }
  ]
}
```

## UI/UX Design

### Color Scheme
- **Transferred**: Green (`--ion-color-success`)
- **Pending**: Orange (`--ion-color-warning`)
- **Primary**: Blue (`--ion-color-primary`)
- **Background**: Light gray (`--ion-color-light`)

### Typography
- **Summary cards**: 2em bold amounts
- **Total earnings**: 3em bold amount
- **Payment items**: 1.1em for amounts, 0.9em for labels

### Spacing
- **Cards**: 16px gap
- **Sections**: 30-40px margin bottom
- **Padding**: 20px inside cards
- **Border radius**: 16px for main cards, 12px for inner elements

### Mobile Responsiveness
- Summary cards stack vertically on mobile (<768px)
- Payment status badge moves below student name on mobile
- Total earnings font size reduces to 2.5em on mobile

## User Flow

1. **Tutor logs in** → Sees home page
2. **Clicks "Earnings"** metric → Opens earnings page
3. **Views summary** → Sees transferred vs pending breakdown
4. **Scrolls down** → Sees list of recent lessons
5. **Clicks a lesson** → Opens lesson analysis page
6. **Clicks back** → Returns to earnings page

## Status Meanings

### "Transferred" (Green)
- ✅ Stripe Connect transfer succeeded
- ✅ Money is in tutor's bank account
- ✅ `transferStatus === 'succeeded'`

### "Pending Transfer" (Orange)
- ⏳ Tutor hasn't completed Stripe Connect onboarding, OR
- ⏳ Stripe transfer hasn't processed yet
- ⏳ `transferStatus === 'pending' || 'failed' || null`

## Error Handling

### Loading State
- Shows spinner
- "Loading earnings..." message

### Error State
- Red alert icon
- Error message
- "Retry" button to reload

### Empty State
- Document icon
- Friendly message
- Explanation of what will appear

## Future Enhancements

### 1. Filters
- Date range picker
- Status filter (all, transferred, pending)
- Search by student name

### 2. Export
- Export earnings report as CSV/PDF
- Email monthly statements

### 3. Charts
- Earnings over time (line chart)
- Breakdown by month (bar chart)
- Top students by earnings

### 4. Additional Details
- Show lesson duration
- Link to student profile
- Show original lesson price vs actual (for office hours)

### 5. Pagination
- Currently shows last 10 lessons
- Add "Load more" button
- Infinite scroll

## Files Created

```
language-learning-app/src/app/earnings/
├── earnings.page.ts       # Component logic
├── earnings.page.html     # Template
└── earnings.page.scss     # Styles
```

## Files Modified

```
language-learning-app/src/app/
├── tabs/tabs-routing.module.ts  # Added earnings route
├── tab1/tab1.page.html          # Updated earnings click handler
└── tab1/tab1.page.ts            # Added navigateToEarnings() method
```

## Testing Checklist

- [ ] Page loads without errors
- [ ] Summary cards show correct totals
- [ ] Payment list displays all recent lessons
- [ ] Status badges show correct color/icon
- [ ] Clicking a lesson opens lesson analysis
- [ ] Back button returns to home page
- [ ] Empty state shows when no lessons
- [ ] Error state shows on API failure
- [ ] Loading state shows while fetching
- [ ] Mobile layout is responsive
- [ ] Wallet visibility toggle still works on home page
- [ ] Total earnings includes both transferred and pending

## Notes

- Earnings page is accessible to all tutors, even if not onboarded to Stripe
- Pending earnings will show until tutor completes Stripe Connect
- Platform fee is always 20% (configured in backend)
- Lesson prices are calculated including office hours adjustments
- Payment breakdown includes original lesson price reconstruction



