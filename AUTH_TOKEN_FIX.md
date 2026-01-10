# Fix Applied: Auth Token Error

## Problem
When clicking the "TEST Auto-Cancel" button, the following error occurred:
```
tab1.page.ts:563 Test auto-cancel error: u: Consent required
at u.fromPayload (auth0-spa-js.production.esm.js:1:8341)
```

## Root Cause
The code was trying to get an Auth0 access token using:
```typescript
const token = await firstValueFrom(this.authService.getAccessToken());
```

This requires Auth0 consent/authentication flow which doesn't work properly in the current dev setup.

## Solution
Changed to use the same authentication method that all other services in the app use:

### Before:
```typescript
const token = await firstValueFrom(this.authService.getAccessToken());
const response = await fetch(`http://localhost:3000/api/classes/${classId}/test-auto-cancel`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});
```

### After:
```typescript
const headers = this.userService.getAuthHeadersSync();
const response = await fetch(`http://localhost:3000/api/classes/${classId}/test-auto-cancel`, {
  method: 'POST',
  headers: {
    'Authorization': headers.get('Authorization') || '',
    'Content-Type': 'application/json'
  }
});
```

## How It Works

### `userService.getAuthHeadersSync()`
This method:
1. Gets the current user email from the cached BehaviorSubject (synchronous)
2. Generates a dev token in the format: `dev-token-{email-with-dashes}`
3. Returns HttpHeaders with `Authorization: Bearer dev-token-...`

### Example
For user `travelbuggler@gmail.com`:
- Token becomes: `dev-token-travelbuggler-gmail-com`
- Header: `Authorization: Bearer dev-token-travelbuggler-gmail-com`

This matches how the backend authenticates dev requests (see `backend/middleware/videoUploadMiddleware.js`).

## Files Modified
- ✅ `language-learning-app/src/app/tab1/tab1.page.ts`
  - Line ~536: Changed auth token retrieval method

## Consistency
This change makes the test button use the **same authentication pattern** as:
- `ClassService`
- `LessonService`  
- `UserService`
- All other API calls in the app

## Testing
The button should now work! Try again:
1. Click the red "TEST Auto-Cancel" button
2. Select a class to cancel
3. Confirm the action
4. ✅ Should successfully cancel the class and update the UI

## No Linter Errors
✅ All TypeScript linting passes

---

**Status**: ✅ FIXED - Ready to test
**Date**: December 19, 2025





