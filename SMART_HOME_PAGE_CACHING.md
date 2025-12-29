# Smart Home Page Caching & Websocket Updates

## Overview

This document describes the implementation of smart caching and websocket-only updates for the tutor home page (Tab1). The goal is to eliminate unnecessary skeleton loaders and provide a seamless user experience when navigating between tabs or receiving real-time updates.

## Problem Statement

Previously, the home page would:
1. Show skeleton loaders every time the user switched tabs
2. Reload all data when receiving websocket notifications (e.g., class cancellation)
3. Cause jarring UI refreshes with skeleton animations repeatedly

This created a poor user experience, especially for tutors who frequently navigate between tabs.

## Solution Architecture

### 1. Smart Caching System

#### Cache State Variables
```typescript
private _hasInitiallyLoaded = false;  // Track if data has been loaded at least once
private _lastDataFetch = 0;            // Timestamp of last data fetch
private _cacheValidityMs = 30000;      // Cache valid for 30 seconds
```

#### Cache Logic
- **Initial Load**: Shows skeleton loader only on the first page load
- **Tab Switching**: Uses cached data if within validity period (30 seconds)
- **Stale Data**: Refreshes in background if cache is older than 30 seconds
- **No Skeleton**: Subsequent loads don't show skeleton loaders

### 2. Optimized `loadLessons()` Method

The method now accepts a parameter to control skeleton display:

```typescript
async loadLessons(showSkeleton = true)
```

**When skeleton is shown:**
- Initial page load (`!this._hasInitiallyLoaded`)
- Explicit refresh requested by user

**When skeleton is NOT shown:**
- Tab switches (with valid cache)
- Background data sync
- Websocket-triggered updates
- Post-action refreshes (cancel, reschedule, etc.)

### 3. Websocket-Only Updates

#### New Methods for Smart Updates

**`handleClassCancellation(classId, cancelReason?)`**
- Finds the class in the `lessons` array
- Updates its status to 'cancelled'
- Moves it from `lessons` to `cancelledLessons` array
- Updates UI state without full reload
- Only does background refresh if class not found locally

**`handleLessonCancellation(lessonId)`**
- Finds the lesson in the `lessons` array
- Updates its status to 'cancelled'
- Moves it from `lessons` to `cancelledLessons` array
- Updates UI state without full reload
- Only does background refresh if lesson not found locally

#### Websocket Event Handlers

Updated notification handlers to use smart cancellation methods:

```typescript
// Class cancellation
if (notification?.type === 'class_auto_cancelled' || 
    notification?.type === 'class_invitation_cancelled') {
  await this.handleClassCancellation(notification.data.classId, 
                                    notification.data.cancelReason);
  this.cdr.detectChanges();
  // Show toast notification
}

// Lesson cancellation
if (notification?.type === 'lesson_cancelled') {
  await this.handleLessonCancellation(notification.data.lessonId);
  this.cdr.detectChanges();
  // Show toast notification
}
```

### 4. Lifecycle Management

#### `ionViewWillEnter()`
The page entrance lifecycle now implements smart refresh logic:

```typescript
ionViewWillEnter() {
  // ... presence and notification checks ...
  
  // Smart refresh: only reload if cache is stale or initial load
  const now = Date.now();
  const cacheAge = now - this._lastDataFetch;
  const isCacheStale = cacheAge > this._cacheValidityMs;
  
  if (!this._hasInitiallyLoaded || isCacheStale) {
    // Only show skeleton on initial load, not on subsequent visits
    this.loadLessons(!this._hasInitiallyLoaded);
  }
}
```

## Key Benefits

### 1. Better User Experience
- ✅ Skeleton loader appears only once (initial page load)
- ✅ Smooth tab switching with no flickering
- ✅ Instant updates via websockets
- ✅ No jarring UI refreshes

### 2. Performance Improvements
- ✅ Reduced API calls (smart caching)
- ✅ Faster UI updates (local state manipulation)
- ✅ Better perceived performance

### 3. Real-time Feel
- ✅ Websocket updates are instant and seamless
- ✅ UI updates without full page reload
- ✅ Professional, app-like experience

## Updated Call Sites

All `loadLessons()` calls have been updated to pass the appropriate flag:

| Location | Skeleton? | Reason |
|----------|-----------|--------|
| `constructor` (initial user load) | ✅ Yes | First data load |
| `ionViewWillEnter()` | ✅ Yes (if initial) | Conditional based on cache |
| `openClassInvitation()` callback | ❌ No | Post-action refresh |
| `testAutoCancelClass()` callback | ❌ No | Post-test refresh |
| `openInviteStudentModal()` callback | ❌ No | Post-invitation refresh |
| `openCancelLessonModal()` callback | ❌ No | Post-cancellation refresh |
| `openRescheduleModal()` callback | ❌ No | Post-reschedule refresh |
| Websocket handlers | ❌ No | Real-time updates |

## Testing Guide

### Test Scenario 1: Initial Load
1. Open the app (home page)
2. **Expected**: Skeleton loader appears briefly
3. **Expected**: Data loads and displays

### Test Scenario 2: Tab Switching (Fresh Cache)
1. Load home page (cache fresh)
2. Switch to another tab (e.g., Messages)
3. Switch back to home page within 30 seconds
4. **Expected**: No skeleton loader, instant display of cached data

### Test Scenario 3: Tab Switching (Stale Cache)
1. Load home page
2. Wait 35+ seconds
3. Switch to another tab and back
4. **Expected**: No skeleton loader, but data refreshes in background

### Test Scenario 4: Class Cancellation
1. Be on home page with an upcoming class
2. Trigger class cancellation (or use TEST button)
3. **Expected**: 
   - No skeleton loader
   - Class moves from "Upcoming" to "Cancelled" seamlessly
   - Toast notification appears
   - No page refresh or flicker

### Test Scenario 5: Lesson Cancellation
1. Be on home page with an upcoming lesson
2. Cancel the lesson
3. **Expected**:
   - No skeleton loader after cancellation
   - Lesson moves to cancelled list smoothly
   - UI updates instantly

### Test Scenario 6: Multiple Tab Switches
1. Switch between Home → Messages → Calendar → Home (repeat 3x)
2. **Expected**:
   - First load: skeleton shows
   - All subsequent loads: no skeleton, instant display

## Technical Details

### Cache Invalidation
Cache is invalidated and triggers a refresh when:
- More than 30 seconds have passed since last fetch
- It's the initial page load
- Manual user action explicitly requires fresh data

### State Management
- Uses local array manipulation for instant UI updates
- Maintains data consistency with server via fallback refresh
- Clears computed caches when data changes to ensure UI consistency

### Change Detection
- Manual change detection trigger after websocket updates: `this.cdr.detectChanges()`
- Ensures Angular picks up array mutations immediately
- Prevents stale view syndrome

## Future Enhancements

### Potential Improvements
1. **Cache expiration per data type**: Different cache times for lessons vs invitations
2. **Background sync**: Periodic sync in background without UI indication
3. **Optimistic updates**: Update UI before server confirms, rollback on error
4. **Partial updates**: Only fetch changed data rather than full reload
5. **Service worker**: Cache data in service worker for offline support

### Monitoring
Consider adding:
- Cache hit/miss metrics
- Websocket update success rate
- User experience metrics (time to interactive, skeleton show frequency)

## Conclusion

This implementation significantly improves the tutor home page experience by:
- Showing skeleton loader only once per session
- Using websockets for real-time updates without full reloads
- Smart caching to reduce API calls and improve perceived performance
- Maintaining data consistency while providing instant UI feedback

The result is a smooth, professional, real-time experience that feels responsive and modern.

