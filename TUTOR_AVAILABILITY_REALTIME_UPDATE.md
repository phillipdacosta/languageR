# Dynamic Card - Tutor Availability Refresh System

**Date:** January 16, 2026  
**Issue:** Student didn't see tutor availability update in dynamic card when tutor added new availability

## Problem

When a tutor adds new availability, students who have previously worked with that tutor didn't see the "Tutor Added New Times!" card appear in their dynamic card rotation. The system only checked for new availability on initial page load.

## Root Cause

1. **Backend**: The `/api/users/availability` PUT endpoint updated tutor availability but didn't update the `lastAvailabilityUpdate` timestamp
2. **Frontend**: Dynamic cards were only loaded once on initial page load, with no refresh mechanism

## The Solution: Hybrid Refresh Approach

Instead of using WebSockets (which adds complexity for a non-urgent feature), we implemented a **hybrid refresh strategy** that balances responsiveness with efficiency:

### Strategy
- Refresh dynamic cards when student navigates to home page
- Only refresh if **5+ minutes** have passed since last refresh
- No polling or WebSocket overhead

### Why This Approach?
✅ **Efficient**: Only refreshes when user actually views the page  
✅ **Simple**: No WebSocket event management needed  
✅ **Responsive**: Students see updates within 5 minutes of viewing home  
✅ **Battery-friendly**: No background polling  
✅ **Perfect for availability**: Not urgent like messages, but timely enough

## Implementation

### 1. Backend Changes (`backend/routes/users.js`)

Updated the PUT `/availability` endpoint to track when availability is updated:

**Lines ~1370-1381:**
```javascript
// Merge: kept blocks + new blocks
user.availability = [...blocksToKeep, ...availabilityBlocks];
user.lastAvailabilityUpdate = new Date(); // Track when availability was last updated
await user.save();

console.log('Final availability count:', user.availability.length);

res.json({ 
  success: true, 
  message: 'Availability updated successfully',
  availability: user.availability 
});
```

**What it does:**
- Updates `user.lastAvailabilityUpdate` timestamp
- This timestamp is used by `/tutors-with-new-availability` to filter tutors who updated in last 4 hours

### 2. Frontend Changes (`language-learning-app/src/app/tab1/tab1.page.ts`)

#### A. Added Tracking Variables (lines ~87-91)

```typescript
private _lastDynamicCardRefresh = 0; // Track last dynamic card refresh
private readonly DYNAMIC_CARD_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
```

#### B. Updated `ionViewWillEnter()` Method (lines ~1114-1130)

```typescript
// Smart refresh: only reload if cache is stale or this is the initial load
const now = Date.now();
const cacheAge = now - this._lastDataFetch;
const isCacheStale = cacheAge > this._cacheValidityMs;

// Refresh dynamic cards if enough time has passed (students only)
if (this.currentUser?.userType === 'student') {
  const timeSinceLastRefresh = now - this._lastDynamicCardRefresh;
  const shouldRefreshCards = timeSinceLastRefresh > this.DYNAMIC_CARD_REFRESH_INTERVAL;
  
  if (shouldRefreshCards || !this._hasInitiallyLoaded) {
    console.log('🎴 [TAB1] Refreshing dynamic cards (age:', Math.round(timeSinceLastRefresh / 1000), 'seconds)');
    this.loadAdditionalDynamicCards();
    this._lastDynamicCardRefresh = now;
  } else {
    console.log('🎴 [TAB1] Skipping dynamic card refresh (age:', Math.round(timeSinceLastRefresh / 1000), 'seconds)');
  }
}
```

**What it does:**
- Checks if 5+ minutes have passed since last dynamic card refresh
- Refreshes if time threshold exceeded OR if initial load
- Only runs for students
- Logs refresh decisions for debugging

## How It Works Now

1. **Tutor adds availability** (via Calendar page or Availability Viewer)
2. **Backend updates** `availability` array and `lastAvailabilityUpdate` timestamp
3. **Student navigates to home page** (from any other tab or external link)
4. **Frontend checks** if 5+ minutes have passed since last card refresh
5. **If yes**: Calls `/tutors-with-new-availability` endpoint
6. **Backend returns tutors** who updated availability within last 4 hours
7. **Card appears in rotation**: "Tutor Added New Times!" or "3 Tutors Added New Times!"

## Timing Details

| Scenario | Behavior |
|----------|----------|
| **Initial page load** | Always fetches dynamic cards |
| **Navigate to home within 5 min** | Uses cached cards (no API call) |
| **Navigate to home after 5+ min** | Refreshes cards from API |
| **Tutor updates availability** | Timestamp updated, visible to students within 4 hours |
| **Student stays on home page** | No refresh (cards rotate but don't fetch new data) |

## Card Display

- **Single tutor**: "John Added New Times! - Book a lesson now"
- **Multiple tutors**: "3 Tutors Added New Times! - Your tutors added new availability"
- Shows tutor avatar(s)
- CTA button: "Book Now" → redirects to tutor search
- **Priority**: High (appears frequently in rotation)

## Benefits Over WebSocket Approach

| Feature | WebSocket | Hybrid Refresh |
|---------|-----------|----------------|
| **Real-time** | Instant | Within 5 min of viewing home |
| **Complexity** | High (event management) | Low (simple timer check) |
| **Server load** | Medium (maintain connections) | Low (only on navigation) |
| **Battery impact** | Medium (persistent connection) | None (no background activity) |
| **Failure mode** | Silent failures, reconnection logic | Simple retry on next visit |
| **Debugging** | Complex (WebSocket events) | Easy (just timestamp checks) |

## Testing

To test the refresh behavior:

1. **Setup**: Have a student complete a lesson with a tutor
2. **Add availability**: As tutor, add new availability blocks
3. **Wait or navigate**: 
   - Student already on home → Navigate away and back after 5+ minutes
   - Student on other page → Navigate to home anytime
4. **Verify**: "Tutor Added New Times!" card should appear in rotation

## Related Files

- **Backend**: `backend/routes/users.js` (PUT `/availability` endpoint, lines ~1370-1381)
- **Frontend**: `language-learning-app/src/app/tab1/tab1.page.ts` 
  - Tracking variables (lines ~87-91)
  - Refresh logic (lines ~1114-1130)
- **Service**: `language-learning-app/src/app/services/smart-island.service.ts` (Card management)
- **Existing API**: `/api/users/tutors-with-new-availability` (filters tutors by 4-hour window)

## Future Enhancements (Optional)

If more real-time behavior is needed:
- Add Page Visibility API listener (refresh when tab becomes visible)
- Reduce refresh interval to 2-3 minutes
- Add manual "Refresh" button in dynamic card
- Implement Service Worker for background sync

