# Agora Interactive Whiteboard Integration Guide

## Overview
This guide explains how to replace the custom HTML5 Canvas whiteboard with Agora's Fastboard SDK in the video-call component.

## What's Been Completed

✅ **1. Backend Setup**
- Created `/backend/routes/whiteboard.js` with token generation endpoints
- Registered whiteboard routes in `server.js`
- Added whiteboard credentials to `config.env`

✅ **2. Frontend Setup**
- Installed `@netless/fastboard` and `white-web-sdk` packages
- Created `WhiteboardService` for API calls
- Updated `environment.ts` with whiteboard config

✅ **3. Database**
- Added `whiteboardRoomUUID` and `whiteboardCreatedAt` fields to Lesson model

## Configuration Required

### 1. Get Whiteboard Credentials from Agora Console

1. Log into [Agora Console](https://console.agora.io/projects)
2. Select your project
3. Go to "ALL FEATURES" → Enable "Whiteboard"
4. Get these credentials:
   - **App Identifier** (Whiteboard App ID)
   - **Access Key (AK)**
   - **Secret Key (SK)**

### 2. Update Backend Config

Edit `/backend/config.env`:
```env
AGORA_WHITEBOARD_APP_ID=your_actual_app_id_here
AGORA_WHITEBOARD_AK=your_actual_access_key_here
AGORA_WHITEBOARD_SK=your_actual_secret_key_here
```

### 3. Update Frontend Config

Edit `/language-learning-app/src/environments/environment.ts`:
```typescript
agoraWhiteboard: {
  appId: 'your_actual_app_id_here', // Same as backend
  region: 'us-sv' // or your region
}
```

## Implementation Steps for Video-Call Component

### Step 1: Add Imports

At the top of `video-call.page.ts`, add:
```typescript
import { createFastboard, FastboardApp, Theme } from '@netless/fastboard';
import { WhiteboardService } from '../services/whiteboard.service';
```

### Step 2: Add Properties

Replace the canvas properties with Fastboard properties:
```typescript
// Remove old canvas properties:
// @ViewChild('whiteboardCanvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;
// private canvas: HTMLCanvasElement | null = null;
// private ctx: CanvasRenderingContext2D | null = null;
// ... other canvas properties

// Add Fastboard properties:
private fastboard: FastboardApp | null = null;
whiteboardRoomUUID: string = '';
whiteboardRoomToken: string = '';
whiteboardLoading: boolean = false;
```

### Step 3: Inject WhiteboardService

In the constructor:
```typescript
constructor(
  // ... existing services
  private whiteboardService: WhiteboardService
) {
  // ... existing constructor code
}
```

### Step 4: Replace initializeWhiteboard() Method

```typescript
async initializeWhiteboard() {
  if (this.fastboard) {
    console.log('⚠️ Whiteboard already initialized');
    return;
  }

  this.whiteboardLoading = true;

  try {
    // Create or get whiteboard room
    let roomData;
    
    if (!this.whiteboardRoomUUID) {
      // Create new room
      roomData = await firstValueFrom(this.whiteboardService.createRoom(false));
      this.whiteboardRoomUUID = roomData.roomUUID;
      this.whiteboardRoomToken = roomData.roomToken;
      
      // TODO: Save whiteboardRoomUUID to lesson in database
      console.log('✅ Created whiteboard room:', this.whiteboardRoomUUID);
    } else {
      // Get token for existing room
      const tokenData = await firstValueFrom(
        this.whiteboardService.getRoomToken(this.whiteboardRoomUUID, 'writer')
      );
      this.whiteboardRoomToken = tokenData.roomToken;
      console.log('✅ Got token for existing room:', this.whiteboardRoomUUID);
    }

    // Initialize Fastboard
    const container = document.getElementById('whiteboard-container');
    if (!container) {
      throw new Error('Whiteboard container not found');
    }

    this.fastboard = await createFastboard({
      sdkConfig: {
        appIdentifier: environment.agoraWhiteboard.appId,
        region: environment.agoraWhiteboard.region as any
      },
      joinRoom: {
        uuid: this.whiteboardRoomUUID,
        roomToken: this.whiteboardRoomToken,
        userPayload: {
          userId: this.currentUserId,
          nickName: this.myName || 'User'
        }
      },
      managerConfig: {
        cursor: true, // Show user cursors
        chessboard: false
      }
    });

    console.log('✅ Agora Whiteboard (Fastboard) initialized successfully');
    this.whiteboardLoading = false;

  } catch (error) {
    console.error('❌ Failed to initialize whiteboard:', error);
    this.whiteboardLoading = false;
    
    const toast = await this.toastController.create({
      message: 'Failed to initialize whiteboard. Please try again.',
      duration: 3000,
      color: 'danger',
      position: 'top'
    });
    await toast.present();
  }
}
```

### Step 5: Update toggleWhiteboard() Method

```typescript
async toggleWhiteboard() {
  this.showWhiteboard = !this.showWhiteboard;
  
  if (this.showWhiteboard) {
    this.cdr.detectChanges();
    
    setTimeout(async () => {
      await this.initializeWhiteboard();
      
      // Reposition videos when whiteboard opens
      if (this.isClass) {
        this.playRemoteVideosInParticipantTiles();
      } else {
        this.moveRemoteVideoToTile();
      }
    }, 100);
  } else {
    // Whiteboard closed - videos go back to normal
    if (this.isClass) {
      this.playRemoteVideosInParticipantTiles();
    } else if (this.remoteVideoRef && this.remoteVideoRef.nativeElement) {
      this.playRemoteVideoInMain();
    }
  }
}
```

### Step 6: Update Cleanup in ngOnDestroy()

```typescript
async ngOnDestroy() {
  // ... existing cleanup code ...
  
  // Destroy Fastboard
  if (this.fastboard) {
    try {
      await this.fastboard.destroy();
      this.fastboard = null;
      console.log('✅ Fastboard destroyed');
    } catch (error) {
      console.error('❌ Error destroying Fastboard:', error);
    }
  }
  
  // ... rest of existing cleanup code ...
}
```

### Step 7: Update HTML Template

Replace the canvas whiteboard section in `video-call.page.html`:

**OLD (Remove):**
```html
<canvas 
  #whiteboardCanvas 
  [width]="canvasWidth"
  [height]="canvasHeight"
  (mousedown)="handleCanvasMouseDown($event)"
  (mousemove)="handleCanvasMouseMove($event)"
  (mouseup)="handleCanvasMouseUp($event)"
  (mouseleave)="handleCanvasMouseLeave($event)"
  <!-- ... more canvas events ... -->
></canvas>
```

**NEW (Replace with):**
```html
<!-- Whiteboard Container for Fastboard -->
<div id="whiteboard-container" class="whiteboard-container">
  <div *ngIf="whiteboardLoading" class="whiteboard-loading">
    <ion-spinner name="crescent"></ion-spinner>
    <p>Loading whiteboard...</p>
  </div>
</div>
```

### Step 8: Update SCSS

In `video-call.page.scss`, update the whiteboard styles:

```scss
.whiteboard-container {
  width: 100%;
  height: 100%;
  position: relative;
  background: #ffffff;
  border-radius: 8px;
  overflow: hidden;
  
  // Fastboard will inject its own UI here
  
  .whiteboard-loading {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    
    p {
      color: var(--ion-color-medium);
      font-size: 14px;
    }
  }
}
```

### Step 9: Remove Old Canvas Code

**Remove these methods (no longer needed):**
- `adjustCanvasSize()`
- `startDrawing()`
- `draw()`
- `stopDrawing()`
- `drawToCanvas()`
- `drawBatchToCanvas()`
- `clearWhiteboard()`
- `undo()` / `redo()`
- `setBrushColor()`
- `setBrushSize()`
- All canvas-related helper methods

**Remove these properties:**
- `canvas`, `ctx`, `canvasWidth`, `canvasHeight`
- `isDrawing`, `lastX`, `lastY`
- `currentColor`, `currentBrushSize`
- `whiteboardElements`, `historyIndex`
- `batchInterval`, `lastPoint`, `lastSentPoint`
- Canvas event handlers

### Step 10: Remove Custom Toolbar (Optional)

Fastboard comes with its own built-in toolbar. You can remove the custom toolbar HTML if desired, or keep it hidden and let Fastboard's UI handle everything.

## Testing

1. Start backend: `cd backend && npm start`
2. Start frontend: `cd language-learning-app && npm start`
3. Join a video call
4. Click the whiteboard button
5. You should see:
   - Fastboard toolbar on the left
   - Drawing tools (pen, shapes, text, eraser)
   - User cursors showing where others are pointing
   - Perfect synchronization across all users!

## Benefits of Fastboard

✅ Perfect stroke synchronization (no more drawing mismatches!)
✅ Built-in tools: shapes, text, images, eraser
✅ Multi-user cursors (see where everyone points)
✅ Professional UI out of the box
✅ Lower bandwidth usage (vector commands, not pixels)
✅ Automatic conflict resolution
✅ Recording support (optional)
✅ Undo/redo that works across all users

## Pricing

- **First 10,000 minutes/month**: FREE
- **After that**: ~$1.50 per 1,000 minutes
- Much more cost-effective than current bandwidth usage!

## Troubleshooting

**Issue**: "Whiteboard container not found"
- **Fix**: Make sure `id="whiteboard-container"` exists in HTML and `*ngIf` conditions are correct

**Issue**: "Failed to create room"
- **Fix**: Check backend credentials in `config.env` are correct
- **Fix**: Verify Whiteboard feature is enabled in Agora Console

**Issue**: "Authentication failed"
- **Fix**: Ensure Access Key (AK) and Secret Key (SK) match your Agora project

**Issue**: Whiteboard doesn't load
- **Fix**: Check browser console for errors
- **Fix**: Verify `environment.ts` has correct App ID

## Next Steps

After integration is complete, you can:
1. Customize Fastboard theme (light/dark mode)
2. Add custom UI buttons if needed
3. Implement whiteboard recording
4. Add image upload to whiteboard
5. Sync whiteboard state with lesson recordings

## Support

- [Agora Fastboard Documentation](https://docs.agora.io/en/fastboard/overview/product-overview)
- [Fastboard GitHub](https://github.com/netless-io/fastboard)
- [Interactive Whiteboard API Reference](https://docs.agora.io/en/interactive-whiteboard/overview/product-overview)



