# Earnings Page - All Lessons Update

## Summary
Updated the `/tabs/earnings` page to show **ALL lessons** (not just completed ones), with status badges, informative notes, and real-time WebSocket updates.

---

## Changes Made

### 1. Backend API Updates (`backend/routes/payments.js`)

**Modified `/api/payments/tutor/earnings` endpoint:**
- ✅ Now returns ALL lessons with payments (not just `revenueRecognized: true`)
- ✅ Includes lesson status in the response (`scheduled`, `in_progress`, `ended_early`, `completed`, `cancelled`)
- ✅ Maps lesson status to payment status for frontend display
- ✅ Only counts completed lessons in `totalEarnings` and `pendingEarnings` totals

**Payment Status Mapping:**
```javascript
- completed + transferred → 'paid'
- completed + pending → 'pending'
- in_progress → 'in_progress'
- ended_early → 'processing'
- scheduled → 'scheduled'
```

---

### 2. Frontend Component Updates (`language-learning-app/src/app/earnings/`)

#### **TypeScript (`earnings.page.ts`)**
- ✅ Added `lessonStatus` field to `PaymentBreakdown` interface
- ✅ Expanded payment status to include: `'paid' | 'pending' | 'in_progress' | 'processing' | 'scheduled'`
- ✅ Added WebSocket subscriptions for real-time updates:
  - `lessonStatusChanged$` - Reloads when lesson status changes
  - `paymentStatusChanged$` - Reloads when payment status changes
- ✅ Added status helper methods:
  - `getStatusColor()` - Returns appropriate color for each status
  - `getStatusIcon()` - Returns appropriate icon for each status
  - `getStatusText()` - Returns human-readable status text
  - `getStatusNote()` - Returns informative notes for certain statuses

**Status Notes:**
- **In Progress**: "Lesson currently in progress"
- **Processing**: "Payment amount will update momentarily"
- **Scheduled**: "Payment will be authorized at lesson start"
- **Ended Early**: "Payment amount will update momentarily"

#### **HTML Template (`earnings.page.html`)**
- ✅ Updated to show status badges with appropriate colors
- ✅ Added status note section for informative messages
- ✅ Added visual indicators (left border) for active lessons
- ✅ Added `(updating)` label for processing payments
- ✅ Changed "No completed lessons" to "No lessons yet"

#### **Styles (`earnings.page.scss`)**
- ✅ Added styling for all status types:
  - `in_progress` - Blue/Primary color with left border
  - `processing` - Orange/Warning color with left border
  - `scheduled` - Gray/Medium color
  - `paid` - Green/Success color
  - `pending` - Orange/Warning color
- ✅ Added `status-note` component styling
- ✅ Added `tentative` styling for payment amounts being updated
- ✅ Added `tentative-label` for "(updating)" text

---

### 3. WebSocket Service Updates (`language-learning-app/src/app/services/websocket.service.ts`)

**Added new observables:**
```typescript
lessonStatusChanged$ - Emits when lesson status changes
paymentStatusChanged$ - Emits when payment status changes
```

**Added event listeners:**
```typescript
socket.on('lesson_status_changed', ...) // Listen for lesson updates
socket.on('payment_status_changed', ...) // Listen for payment updates
```

---

### 4. Backend WebSocket Emissions

**Updated cron jobs to emit WebSocket events:**

#### **`backend/jobs/autoFinalizeLessons.js`**
- ✅ Added `emitStatusChange()` helper function
- ✅ Emits `lesson_status_changed` event when lesson is finalized
- ✅ Sends to both tutor and student sockets

#### **`backend/jobs/autoCompleteTranscripts.js`**
- ✅ Added `emitStatusChange()` helper function
- ✅ Emits `lesson_status_changed` event when transcript is completed
- ✅ Sends to both tutor and student sockets

**WebSocket Payload:**
```javascript
{
  lessonId: string,
  status: 'scheduled' | 'in_progress' | 'ended_early' | 'completed' | 'cancelled',
  updatedAt: Date
}
```

---

## User Experience

### Before
- Only showed **completed lessons**
- No indication of active or upcoming lessons
- No real-time updates
- Static page that required manual refresh

### After
- Shows **ALL lessons** (scheduled, in progress, ended early, completed)
- Clear status badges with colors and icons
- Informative notes for lessons in progress or being processed
- **Real-time updates** when lesson status changes
- Visual indicators (left border) for active lessons
- Payment amounts marked as "(updating)" when processing

---

## Status Badge Examples

| Status | Badge | Color | Icon | Note |
|--------|-------|-------|------|------|
| **Paid** | ✅ Transferred | Green | checkmark-circle | - |
| **Pending** | ⏱️ Pending Transfer | Orange | time | - |
| **In Progress** | 🎥 In Progress | Blue | videocam | "Lesson currently in progress" |
| **Processing** | ⏳ Processing Payment | Orange | hourglass | "Payment amount will update momentarily" |
| **Scheduled** | 📅 Scheduled | Gray | calendar | "Payment will be authorized at lesson start" |

---

## Real-Time Behavior

1. **Tutor starts a lesson** → Status changes from `scheduled` to `in_progress`
   - WebSocket event fires: `lesson_status_changed`
   - Earnings page automatically reloads
   - Status badge updates to "In Progress" with blue color
   - Left border appears to highlight active lesson

2. **Lesson ends** → Status changes to `ended_early` or `completed`
   - WebSocket event fires: `lesson_status_changed`
   - Earnings page automatically reloads
   - Status badge updates to "Processing Payment"
   - Note appears: "Payment amount will update momentarily"

3. **Payment captured** → Payment status changes
   - WebSocket event fires: `payment_status_changed`
   - Earnings page automatically reloads
   - Status badge updates to "Pending Transfer"
   - Payment amount finalized (no more "updating" label)

4. **Payout processed** → Transfer status changes to `succeeded`
   - Earnings page shows final "Transferred" status
   - Amount moves from "Pending" to "Transferred" totals

---

## Technical Notes

- Backend emits WebSocket events to both tutor and student MongoDB IDs
- Uses `global.userSockets` map to find active socket connections
- Gracefully handles missing WebSocket instances (no crashes)
- Earnings page automatically reloads data on any lesson/payment status change
- Only **completed lessons** count toward total/pending earnings
- In-progress and scheduled lessons are shown for visibility but don't affect totals yet

---

## Testing

1. **View scheduled lesson**: Should appear with "Scheduled" badge
2. **Start lesson**: Badge should update to "In Progress" in real-time
3. **End lesson**: Badge should update to "Processing Payment" with note
4. **Wait for payment capture**: Status should update to "Pending Transfer"
5. **Wait for payout**: Status should update to "Transferred"

All updates should happen **automatically without page refresh**! 🎉

