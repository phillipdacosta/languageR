# Platform Revenue Admin Dashboard

## Overview
A comprehensive admin dashboard to track platform earnings, breaking down revenue by lessons, payment methods, and time periods.

## Access
**URL:** `/admin/revenue`  
**Auth:** Requires admin access (enforced by `requireAdmin` middleware)

## Features

### 1. Summary Cards
- **Net Platform Revenue** - Your actual profit (highlighted in blue)
- **Total Lessons** - Number of completed lessons
- **Gross Revenue** - Total from all lessons
- **Platform Fee (20%)** - Before Stripe fees
- **Stripe Fees** - Processing costs you pay
- **Effective Fee** - Real percentage after Stripe fees

### 2. Date Range Filters
- Week
- Month
- Quarter
- Year
- All Time

### 3. Averages Section
- Average lesson price
- Average platform fee per lesson
- Average net revenue per lesson

### 4. Pending Revenue
Shows lessons that haven't been finalized yet, with estimated platform fees and Stripe fees.

### 5. Payment Method Breakdown
Displays revenue grouped by:
- Wallet
- Card
- Saved Card
- Apple Pay
- Google Pay

### 6. Recent Payments Table
Shows the last 20 payments with:
- Date
- Student name
- Tutor name
- Subject
- Payment method
- Gross amount
- Platform fee
- Stripe fee
- **Net revenue** (your actual profit per lesson)

### 7. Export to CSV
Download all payment data for accounting purposes.

## API Endpoint
`GET /api/admin/platform-revenue`

**Query Parameters:**
- `startDate` (ISO date, optional) - Default: 30 days ago
- `endDate` (ISO date, optional) - Default: now
- `groupBy` (optional) - 'day' | 'week' | 'month' - Default: 'day'

## Key Metrics Explained

### Net Platform Revenue
This is your **actual profit** per lesson:
```
Net Platform Revenue = Platform Fee - Stripe Fee
```

Example:
- Lesson price: $17.50
- Platform fee (20%): $3.50
- Stripe fee: $0.81
- **Net platform revenue: $2.69**

### Effective Fee After Stripe
Your real commission percentage after Stripe takes their cut:
```
Effective Fee = (Net Platform Revenue / Gross Revenue) × 100
```

Example:
- Platform fee: 20%
- Stripe fee: ~3.61%
- **Effective fee: ~16.39%**

## Design
- Clean, Apple-inspired design
- Responsive grid layout
- Color-coded cards
- Hover effects
- Mobile-friendly tables with horizontal scroll

## Next Steps
1. ✅ Backend endpoint created
2. ✅ Admin dashboard UI built
3. ✅ CSV export functionality
4. ⏳ Add charts/graphs for timeline visualization
5. ⏳ Compare with Stripe dashboard for verification
6. ⏳ Add filters for specific tutors/students
7. ⏳ Email reports (daily/weekly/monthly)

## Files Created/Modified
- `backend/routes/admin.js` - Added platform revenue endpoint
- `language-learning-app/src/app/admin/admin.page.ts` - Dashboard component
- `language-learning-app/src/app/admin/admin.page.html` - Dashboard template
- `language-learning-app/src/app/admin/admin.page.scss` - Dashboard styles
- `language-learning-app/src/app/app-routing.module.ts` - Added `/admin/revenue` route




