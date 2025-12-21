# Stale Class Data ("BIG MAN TING") Fix 🔍

## Problem
User reported: "I am still seeing Class 'BIG MAN TING' which is not even in the DB, flash on the tutor-calendar and then disappear."

## Root Cause

### Why It Flashes
The class appears briefly, then disappears because:

1. **Initial Render**: `this.events` array contains stale data from a previous session/load
   - "BIG MAN TING" is in `this.events` from before it was deleted from DB
   - Calendar renders showing this stale event

2. **API Call Completes**: `loadClasses()` gets fresh data from DB
   - API returns classes that exist in DB (no "BIG MAN TING")
   - Code filters out ALL old class events
   - Merges only NEW class events from API
   - "BIG MAN TING" is gone

3. **Result**: Flash (appears) → disappear (filtered out)

### Why Stale Data Exists
Possible sources:
- Previous page visit left data in `this.events`
- Component reused without full cleanup
- Lifecycle hooks didn't clear properly
- `classesMap` retained old data

## Solution Implemented

### Added Extensive Debug Logging

**Before `loadClasses()` runs:**
```typescript
console.log('📚 [LOAD-DEBUG] Current events before loading classes:', this.events.length);
console.log('📚 [LOAD-DEBUG] Current class events:', 
  this.events.filter(e => e.extendedProps?.['isClass']).map(e => ({
    id: e.id,
    title: e.title
  }))
);
```

**After API response:**
```typescript
console.log('📚 [CLASS-DEBUG] All classes from API:', response.classes?.map(c => ({
  id: c._id,
  name: c.name,
  status: c.status
})));
```

**During filtering:**
```typescript
const nonClassEvents = this.events.filter(event => {
  const isClassEvent = extendedProps?.isClass || extendedProps?.classId;
  if (isClassEvent) {
    console.log('📚 [CLASS-DEBUG] Filtering out old class event:', event.id, event.title);
  }
  return !isClassEvent;
});
```

**After merging:**
```typescript
console.log('📚 [CLASS-DEBUG] After filtering, non-class events:', nonClassEvents.length);
console.log('📚 [CLASS-DEBUG] After merging, total events:', this.events.length);
```

### What To Look For

When you load the calendar, check the console:

**If "BIG MAN TING" is in stale data, you'll see:**
```
📚 [LOAD-DEBUG] Current events before loading classes: 15
📚 [LOAD-DEBUG] Current class events: [
  { id: "123", title: "BIG MAN TING", isClass: true }  // ❌ STALE!
]

📚 [CLASS-DEBUG] All classes from API: [
  { id: "456", name: "Other Class", status: "scheduled" }
  // NO "BIG MAN TING" - it's not in DB!
]

📚 [CLASS-DEBUG] Filtering out old class event: 123 BIG MAN TING
📚 [CLASS-DEBUG] After filtering, non-class events: 14
📚 [CLASS-DEBUG] After merging, total events: 15
```

This confirms:
1. "BIG MAN TING" was in `this.events` initially (stale)
2. API doesn't return it (it's deleted from DB)
3. Filtering removes it
4. It won't reappear

## Possible Sources of Stale Data

### 1. Component Not Destroyed Properly
If you navigate away and back, `this.events` might persist.

**Check**: Does the flash only happen on first load, or every time you visit the page?

### 2. classesMap Not Cleared
The `classesMap` stores class data separately. If it's not cleared when API updates, old classes persist.

**Fixed**: Added explicit clear:
```typescript
this.classesMap.clear();
console.log('📚 [CLASS-DEBUG] Cleared classesMap');
```

### 3. Lifecycle Hook Re-runs
`ionViewDidEnter()` might be called multiple times, loading stale data.

**Check console** for how many times you see:
```
🔄 [REFRESH] refreshCalendar() called
📚 [LOAD-DEBUG] loadClasses START
```

If you see this multiple times in quick succession, lifecycle hooks are firing too often.

## Testing Instructions

### 1. Open Browser Console
Before loading calendar, open DevTools console

### 2. Load Calendar Page
Navigate to `/tabs/tutor-calendar`

### 3. Watch Console Output
Look for these key logs:

```
📚 [LOAD-DEBUG] Current events before loading classes: X
📚 [LOAD-DEBUG] Current class events: [...]

📚 [CLASS-DEBUG] Classes API response: Y classes
📚 [CLASS-DEBUG] All classes from API: [...]

📚 [CLASS-DEBUG] Filtering out old class event: ...
📚 [CLASS-DEBUG] After merging, total events: Z
```

### 4. Check For "BIG MAN TING"

**If you see:**
```
📚 [LOAD-DEBUG] Current class events: [
  { id: "...", title: "BIG MAN TING" }
]
```

This confirms stale data in `this.events`.

**Then check if API returns it:**
```
📚 [CLASS-DEBUG] All classes from API: [
  // ... list of classes
]
```

If "BIG MAN TING" is NOT in this list, it's been deleted from DB and the flash is expected (filtering removes it).

### 5. Refresh Page
After the initial flash:
1. Refresh the page (F5)
2. Check console again
3. "BIG MAN TING" should NOT appear in "Current class events" anymore

If it still appears, there's another source of stale data.

## Expected Behavior After Fix

### First Load (with stale data)
1. "BIG MAN TING" flashes briefly
2. Console shows it was filtered out
3. After API completes, it's gone
4. Won't reappear

### Subsequent Loads
1. No "BIG MAN TING" in initial events
2. API doesn't return it
3. Never appears

## If Problem Persists

### Check These:
1. **Browser cache**: Clear cache and hard refresh (Cmd+Shift+R / Ctrl+Shift+F5)
2. **Service worker**: Disable in DevTools → Application → Service Workers
3. **localStorage**: Check if class data is cached in localStorage
4. **Multiple tabs**: Close other tabs with the app open

### Additional Logging Needed
If "BIG MAN TING" keeps appearing, add this to check localStorage:

```typescript
console.log('📚 [DEBUG] localStorage keys:', Object.keys(localStorage));
console.log('📚 [DEBUG] localStorage calendar data:', 
  localStorage.getItem('tutor-calendar-events')
);
```

## Files Modified
- ✅ `tutor-calendar.page.ts`
  - Added extensive logging to `loadClasses()`
  - Added logging to filter operation
  - Made `classesMap.clear()` explicit with logging

---

**Status**: 🔍 Debug Logging Added
**Next**: Check console output to identify source of stale "BIG MAN TING" data
**Date**: December 19, 2025


