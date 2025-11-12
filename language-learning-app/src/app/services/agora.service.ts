import { Injectable } from '@angular/core';
import AgoraRTC, {
  IAgoraRTCClient,
  ICameraVideoTrack,
  ILocalVideoTrack,
  IMicrophoneAudioTrack,
  IRemoteVideoTrack,
  IRemoteAudioTrack,
  UID
} from 'agora-rtc-sdk-ng';
import VirtualBackgroundExtension from 'agora-extension-virtual-background';
import { environment } from '../../environments/environment';
import { TokenGeneratorService } from './token-generator.service';
import { LessonService, LessonJoinResponse } from './lesson.service';
import { UserService } from './user.service';

@Injectable({
  providedIn: 'root'
})
export class AgoraService {
  private client: IAgoraRTCClient | null = null;
  private localVideoTrack: ICameraVideoTrack | ILocalVideoTrack | null = null;
  private localAudioTrack: IMicrophoneAudioTrack | null = null;
  private remoteUsers: Map<UID, { videoTrack?: IRemoteVideoTrack; audioTrack?: IRemoteAudioTrack; isMuted?: boolean; isVideoOff?: boolean }> = new Map();
  private videoEnabledState: boolean = true; // Track video enabled state

  // Virtual background properties (following official example)
  private extension: any = null;
  private processor: any = null;
  private virtualBackgroundEnabled = false;
  
  // Virtual background state preservation
  private virtualBackgroundState: {
    enabled: boolean;
    type: 'blur' | 'color' | 'image' | null;
    value?: string | number; // blur degree, color, or image URL
  } = {
    enabled: false,
    type: null
  };

  // Real-time messaging properties
  private channelName: string = 'default';
  private lastMessageTime: string = new Date().toISOString();
  private pollingInterval: any = null;
  private currentLessonId: string | null = null;

  // Callback functions for real-time updates
  public onWhiteboardMessage?: (data: any) => void;
  public onChatMessage?: (message: any) => void;
  public onRemoteUserStateChange?: (uid: UID, state: { isMuted?: boolean; isVideoOff?: boolean }) => void;

  private readonly APP_ID = environment.agora.appId;
  private readonly TOKEN = environment.agora.token;
  private readonly UID = environment.agora.uid;

  // High-quality video encoder configuration
  private readonly encoderConfig = {
    resolution: { width: 1280, height: 720 }, // HD 720p
    frameRate: 30, // 30 fps for smooth video
    bitrateMax: 2000, // 2000 kbps for high quality
    bitrateMin: 600,  // 600 kbps minimum
    optimizationMode: 'detail' as const // Prioritize quality over latency
  };

  constructor(
    private tokenGenerator: TokenGeneratorService,
    private lessonService: LessonService,
    private userService: UserService
  ) { }

  getClient(): IAgoraRTCClient | null {
    return this.client;
  }

  isConnected(): boolean {
    return this.client?.connectionState === 'CONNECTED';
  }

  isConnecting(): boolean {
    return this.client?.connectionState === 'CONNECTING';
  }

  isBrowserSupported(): boolean {
    // Check if getUserMedia is supported
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return false;
    }
    
    // Check if WebRTC is supported
    if (!window.RTCPeerConnection) {
      return false;
    }
    
    return true;
  }

  async checkPermissions(): Promise<{ camera: boolean; microphone: boolean }> {
    try {
      // Check camera permission
      const cameraPermission = await navigator.permissions.query({ name: 'camera' as PermissionName });
      const microphonePermission = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      
      return {
        camera: cameraPermission.state === 'granted',
        microphone: microphonePermission.state === 'granted'
      };
    } catch (error) {
      console.log("Permission API not supported, will request permissions directly");
      return { camera: false, microphone: false };
    }
  }

  async requestPermissions(): Promise<boolean> {
    try {
      // Try to get user media to trigger permission request
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      });
      
      // Stop the stream immediately as we just needed to request permissions
      stream.getTracks().forEach(track => track.stop());
      
      console.log("Permissions granted successfully");
      return true;
    } catch (error) {
      console.error("Permission denied or error:", error);
      return false;
    }
  }

  async initializeClient(): Promise<IAgoraRTCClient> {
    if (this.client) {
      return this.client;
    }

    // Create Agora client
    this.client = AgoraRTC.createClient({ 
      mode: "rtc", 
      codec: "vp9" // Using vp9 as in the example
    });

    // Initialize virtual background extension
    await this.initializeVirtualBackgroundExtension();

    // Set up event listeners
    this.setupEventListeners();

    return this.client;
  }

  // Initialize virtual background extension (following official example)
  private async initializeVirtualBackgroundExtension(): Promise<void> {
    try {
      if (!this.extension) {
        console.log('🔧 Creating VirtualBackgroundExtension instance...');
        
        // Create a VirtualBackgroundExtension instance
        this.extension = new VirtualBackgroundExtension();
        console.log('🔧 Extension created:', !!this.extension);
        
        if (!this.extension) {
          throw new Error('Failed to create VirtualBackgroundExtension instance');
        }
        
        // Register the extension
        console.log('🔧 Registering extension with Agora...');
        AgoraRTC.registerExtensions([this.extension]);
        
        console.log('✅ Virtual background extension initialized and registered');
      } else {
        console.log('🔄 Virtual background extension already exists');
      }
    } catch (error) {
      console.error('❌ Failed to initialize virtual background extension:', error);
      this.extension = null;
      throw error;
    }
  }

  // Get processor instance (following official example)
  private async getProcessorInstance(): Promise<any> {
    console.log('🔍 DEBUG: getProcessorInstance called');
    console.log('🔍 DEBUG: Current processor exists:', !!this.processor);
    console.log('🔍 DEBUG: Local video track exists:', !!this.localVideoTrack);
    console.log('🔍 DEBUG: Extension exists:', !!this.extension);

    // If we have a processor but no local video track, or the processor is tied to an old track, recreate it
    if (!this.processor || !this.localVideoTrack) {
      if (!this.localVideoTrack) {
        console.warn('❌ Cannot create processor - no local video track available');
        return null;
      }

      if (!this.extension) {
        console.error('❌ Cannot create processor - no extension available');
        return null;
      }

      try {
        console.log('🔧 Creating new virtual background processor...');
        
        // Create a VirtualBackgroundProcessor instance
        console.log('🔧 Calling extension.createProcessor()...');
        this.processor = this.extension.createProcessor();
        console.log('🔧 Processor created:', !!this.processor);

        if (!this.processor) {
          throw new Error('extension.createProcessor() returned null/undefined');
        }

        // Initialize the extension - try different approaches for WASM loading
        console.log('🔧 Initializing processor...');
        try {
          // First try with assets path
          console.log('🔧 Trying init with assets path...');
          await this.processor.init("./assets/wasms");
          console.log('✅ WASM loaded from assets path');
        } catch (wasmError) {
          console.warn('Failed to load WASM from assets, trying alternative methods...', wasmError);
          try {
            // Try without path (may use CDN or embedded WASM)
            console.log('🔧 Trying init without path...');
            await this.processor.init();
            console.log('✅ WASM loaded without path');
          } catch (fallbackError) {
            console.warn('Failed to load WASM without path, trying empty string...', fallbackError);
            // Try with empty string
            console.log('🔧 Trying init with empty string...');
            await this.processor.init("");
            console.log('✅ WASM loaded with empty string');
          }
        }
        
        // Inject the extension into the video processing pipeline in the SDK
        console.log('🔧 Injecting processor into video pipeline...');
        
        // Check track state before pipeline injection
        console.log('🔍 DEBUG: Track state before pipeline injection:', {
          enabled: this.localVideoTrack.enabled,
          muted: this.localVideoTrack.muted
        });
        
        this.localVideoTrack.pipe(this.processor).pipe(this.localVideoTrack.processorDestination);
        
        // Check track state after pipeline injection
        console.log('🔍 DEBUG: Track state after pipeline injection:', {
          enabled: this.localVideoTrack.enabled,
          muted: this.localVideoTrack.muted
        });
        
        // Ensure track remains enabled after pipeline injection
        if (!this.localVideoTrack.enabled) {
          console.log('⚠️ Track was disabled by pipeline injection, re-enabling...');
          await this.localVideoTrack.setEnabled(true);
          console.log('✅ Track re-enabled after pipeline injection');
        }
        
        console.log('✅ Virtual background processor created and initialized');
        console.log('🎥 IMPORTANT: Virtual background is now applied to the PUBLISHED video track that other participants will see');
      } catch (error) {
        console.error('❌ Failed to load WASM resource or create processor:', error);
        console.error('❌ Error details:', error);
        this.processor = null;
        return null;
      }
    } else {
      console.log('🔄 Using existing processor instance');
    }
    return this.processor;
  }

  // Set background blur (following official example)
  async setBackgroundBlur(blurDegree: number = 2): Promise<void> {
    if (!this.localVideoTrack) {
      throw new Error('No local video track available');
    }

    console.log('🌀 Setting background blur...');
    
    try {
      const processor = await this.getProcessorInstance();
      if (!processor) {
        throw new Error('Failed to get processor instance');
      }

      // Set blur options
      processor.setOptions({ type: 'blur', blurDegree: blurDegree });
      await processor.enable();
      
      this.virtualBackgroundEnabled = true;
      // Store state for preservation
      this.virtualBackgroundState = {
        enabled: true,
        type: 'blur',
        value: blurDegree
      };
      console.log('✅ Background blur enabled successfully');
      console.log('👥 Other participants will now see your blurred background');
    } catch (error) {
      console.error('❌ Failed to set background blur:', error);
      throw error;
    }
  }

  // Set background color (following official example)
  async setBackgroundColor(color: string = '#00ff00'): Promise<void> {
    if (!this.localVideoTrack) {
      throw new Error('No local video track available');
    }

    console.log('🎨 Setting background color:', color);
    
    try {
      const processor = await this.getProcessorInstance();
      if (!processor) {
        throw new Error('Failed to get processor instance');
      }

      // Set color options
      processor.setOptions({ type: 'color', color: color });
      await processor.enable();
      
      this.virtualBackgroundEnabled = true;
      // Store state for preservation
      this.virtualBackgroundState = {
        enabled: true,
        type: 'color',
        value: color
      };
      console.log('✅ Background color set successfully');
      console.log('👥 Other participants will now see your colored background');
    } catch (error) {
      console.error('❌ Failed to set background color:', error);
      throw error;
    }
  }

  // Set background image (following official example)
  async setBackgroundImage(imageUrl: string): Promise<void> {
    if (!this.localVideoTrack) {
      throw new Error('No local video track available');
    }

    console.log('🖼️ Setting background image:', imageUrl);
    
    return new Promise((resolve, reject) => {
      const imgElement = document.createElement('img');
      
      imgElement.onload = async () => {
        try {
          const processor = await this.getProcessorInstance();
          if (!processor) {
            throw new Error('Failed to get processor instance');
          }

          // Set image options
          processor.setOptions({ type: 'img', source: imgElement });
          await processor.enable();
          
          this.virtualBackgroundEnabled = true;
          // Store state for preservation
          this.virtualBackgroundState = {
            enabled: true,
            type: 'image',
            value: imageUrl
          };
          console.log('✅ Background image set successfully');
          resolve();
        } catch (error) {
          console.error('❌ Failed to set background image:', error);
          reject(error);
        }
      };

      imgElement.onerror = () => {
        reject(new Error('Failed to load background image'));
      };

      imgElement.src = imageUrl;
    });
  }

  // Disable virtual background
  async disableVirtualBackground(): Promise<void> {
    if (this.processor) {
      try {
        await this.processor.disable();
        this.virtualBackgroundEnabled = false;
        // Clear state
        this.virtualBackgroundState = {
          enabled: false,
          type: null
        };
        console.log('✅ Virtual background disabled');
      } catch (error) {
        console.error('❌ Failed to disable virtual background:', error);
        throw error;
      }
    }
  }

  // Check if virtual background is enabled
  isVirtualBackgroundEnabled(): boolean {
    return this.virtualBackgroundEnabled;
  }

  // Get virtual background state for preservation
  getVirtualBackgroundState(): { enabled: boolean; type: 'blur' | 'color' | 'image' | null; value?: string | number } {
    return { ...this.virtualBackgroundState };
  }

  // Force restore virtual background (can be called manually if automatic restoration fails)
  async forceRestoreVirtualBackground(): Promise<boolean> {
    console.log('🔧 Force restoring virtual background...');
    try {
      // Reset processor to ensure clean state
      if (this.processor) {
        try {
          console.log('🔧 Unpiping processor for force restore...');
          this.processor.unpipe();
          console.log('✅ Processor unpiped for force restore');
        } catch (unpipeError) {
          console.warn('⚠️ Error unpiping processor for force restore:', unpipeError);
        }
      }
      this.processor = null;
      await this.restoreVirtualBackgroundState();
      return true;
    } catch (error) {
      console.error('❌ Force restore failed:', error);
      return false;
    }
  }

  // Restore virtual background state (used when joining lesson)
  async restoreVirtualBackgroundState(): Promise<void> {
    console.log('🔍 DEBUG: Checking virtual background state for restoration...');
    console.log('🔍 DEBUG: Current virtualBackgroundState:', JSON.stringify(this.virtualBackgroundState, null, 2));
    console.log('🔍 DEBUG: Local video track exists:', !!this.localVideoTrack);
    console.log('🔍 DEBUG: Extension exists:', !!this.extension);
    console.log('🔍 DEBUG: Processor exists:', !!this.processor);

    if (!this.virtualBackgroundState.enabled || !this.virtualBackgroundState.type) {
      console.log('❌ No virtual background state to restore - state not enabled or no type');
      return;
    }

    if (!this.localVideoTrack) {
      console.log('❌ Cannot restore virtual background - no local video track available');
      return;
    }

    try {
      console.log('🔄 Restoring virtual background state:', this.virtualBackgroundState);
      
      switch (this.virtualBackgroundState.type) {
        case 'blur':
          console.log('🌀 Restoring blur with degree:', this.virtualBackgroundState.value);
          await this.setBackgroundBlur(this.virtualBackgroundState.value as number || 2);
          break;
        case 'color':
          console.log('🎨 Restoring color background:', this.virtualBackgroundState.value);
          await this.setBackgroundColor(this.virtualBackgroundState.value as string || '#00ff00');
          break;
        case 'image':
          console.log('🖼️ Restoring image background:', this.virtualBackgroundState.value);
          await this.setBackgroundImage(this.virtualBackgroundState.value as string);
          break;
      }
      
      console.log('✅ Virtual background state restored successfully');
    } catch (error) {
      console.error('❌ Failed to restore virtual background state:', error);
      console.error('❌ Error details:', error);
      // Don't throw error - just log it so the call can continue
    }
  }

  private setupEventListeners() {
    if (!this.client) return;

    // Listen for remote user joining
    this.client.on("user-published", async (user, mediaType) => {
      console.log("🎉 User published:", user.uid, mediaType);
      
      try {
        // Subscribe to the remote user
        await this.client!.subscribe(user, mediaType);
        console.log("✅ Successfully subscribed to user:", user.uid, mediaType);
        
        if (mediaType === "video") {
          this.remoteUsers.set(user.uid, { 
            ...this.remoteUsers.get(user.uid), 
            videoTrack: user.videoTrack 
          });
          console.log("📹 Added video track for user:", user.uid);
        }
        
        if (mediaType === "audio") {
          this.remoteUsers.set(user.uid, { 
            ...this.remoteUsers.get(user.uid), 
            audioTrack: user.audioTrack 
          });
          user.audioTrack?.play();
          console.log("🔊 Added audio track for user:", user.uid);
        }
        
        console.log("👥 Total remote users:", this.remoteUsers.size);
      } catch (error) {
        console.error("❌ Error subscribing to user:", user.uid, error);
      }
    });

    // Listen for remote user leaving
    this.client.on("user-unpublished", (user, mediaType) => {
      console.log("User unpublished:", user, mediaType);
      
      if (mediaType === "video") {
        const remoteUser = this.remoteUsers.get(user.uid);
        if (remoteUser) {
          remoteUser.videoTrack = undefined;
        }
      }
      
      if (mediaType === "audio") {
        const remoteUser = this.remoteUsers.get(user.uid);
        if (remoteUser) {
          remoteUser.audioTrack = undefined;
        }
      }
    });

    // Listen for remote user leaving the channel
    this.client.on("user-left", (user) => {
      console.log("👋 User left:", user.uid);
      this.remoteUsers.delete(user.uid);
      console.log("👥 Total remote users after leave:", this.remoteUsers.size);
    });
  }

  async joinChannel(channelName: string, uid?: UID): Promise<void> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    try {
      // First, request permissions and create local tracks with high-quality encoder config
      console.log("Requesting camera and microphone permissions...");
      
      // Store virtual background state before creating new tracks
      const savedVBState = { ...this.virtualBackgroundState };
      
      [this.localAudioTrack, this.localVideoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
        {},
        { encoderConfig: this.encoderConfig }
      );
      console.log("Successfully created local tracks with HD quality");

      // CRITICAL: Reset processor since we have new tracks
      if (this.processor) {
        console.log('🔄 Resetting processor for new tracks (joinChannel)...');
        try {
          // Properly unpipe the processor before resetting
          console.log('🔧 Unpiping existing processor (joinChannel)...');
          this.processor.unpipe();
          console.log('✅ Processor unpiped successfully (joinChannel)');
        } catch (unpipeError) {
          console.warn('⚠️ Error unpiping processor (joinChannel, continuing anyway):', unpipeError);
        }
        this.processor = null;
      }

      // Restore virtual background state
      this.virtualBackgroundState = savedVBState;

      // Apply virtual background to the NEW tracks BEFORE joining channel
      if (savedVBState.enabled && savedVBState.type) {
        console.log('🔄 Applying virtual background to NEW tracks BEFORE joining (joinChannel)...');
        
        // Check video track state before applying VB
        console.log('🔍 DEBUG: Video track state BEFORE VB (joinChannel):', {
          exists: !!this.localVideoTrack,
          enabled: this.localVideoTrack?.enabled,
          muted: this.localVideoTrack?.muted
        });
        
        try {
          await this.restoreVirtualBackgroundState();
          
          // Check video track state after applying VB
          console.log('🔍 DEBUG: Video track state AFTER VB (joinChannel):', {
            exists: !!this.localVideoTrack,
            enabled: this.localVideoTrack?.enabled,
            muted: this.localVideoTrack?.muted
          });
          
          // Ensure video track is enabled after VB processing
          if (this.localVideoTrack && !this.localVideoTrack.enabled) {
            console.log('⚠️ Video track was disabled by VB processing, re-enabling (joinChannel)...');
            await this.localVideoTrack.setEnabled(true);
            console.log('✅ Video track re-enabled after VB processing (joinChannel)');
          }
          
          console.log('✅ Virtual background applied to NEW tracks before joining (joinChannel)');
        } catch (error) {
          console.error('❌ Failed to apply virtual background to NEW tracks (joinChannel):', error);
        }
      }

      // Generate token for testing or use null if testing mode is enabled
      let token = this.tokenGenerator.isTestingModeEnabled() ? null : this.tokenGenerator.generateTestToken(channelName, typeof uid === 'number' ? uid : 0);
      
      // If token generation fails, try without token
      if (!token && !this.tokenGenerator.isTestingModeEnabled()) {
        console.log('Token generation failed, trying without token...');
        token = null;
      }
      
      console.log('Using token:', token ? 'Token provided' : 'No token (null)');
      
      // Join the RTC channel
      await this.client.join(this.APP_ID, channelName, token, uid || this.UID);
      console.log("Successfully joined RTC channel:", channelName);
      
      // Publish local tracks
      await this.client.publish([this.localAudioTrack, this.localVideoTrack]);
      console.log("Successfully published local tracks");

      // Initialize real-time messaging
      this.channelName = channelName;
      this.startMessagePolling();

    } catch (error) {
      console.error("Error joining channel:", error);
      
      // Clean up tracks if they were created
      if (this.localVideoTrack) {
        this.localVideoTrack.close();
        this.localVideoTrack = null;
      }
      if (this.localAudioTrack) {
        this.localAudioTrack.close();
        this.localAudioTrack = null;
      }
      
      throw error;
    }
  }

  /**
   * Join a scheduled lesson using the secure backend endpoint
   * This method gets the Agora token from the lesson service only if within the allowed time window
   */
  async joinLesson(lessonId: string, role: 'tutor' | 'student', userId?: string, options?: { micEnabled?: boolean; videoEnabled?: boolean }): Promise<LessonJoinResponse> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    // Check if client is already connected to avoid double join
    if (this.client.connectionState === 'CONNECTED' || this.client.connectionState === 'CONNECTING') {
      console.log('⚠️ Client already connected/connecting, skipping join');
      // Return a mock response since we're already connected
      return {
        success: true,
        agora: {
          appId: this.APP_ID,
          channelName: 'languageRoom', // We know it's hardcoded
          token: 'already-connected',
          uid: this.UID || 0 // Use 0 as fallback if UID is null
        },
        lesson: {
          id: lessonId,
          startTime: new Date().toISOString(),
          endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
          tutor: { id: 'mock-tutor', name: 'Mock Tutor' },
          student: { id: 'mock-student', name: 'Mock Student' },
          subject: 'Mock Subject'
        },
        userRole: role,
        serverTime: new Date().toISOString()
      };
    }

    try {
      console.log('📅 Attempting to join lesson:', { lessonId, role, userId });

      // Get secure Agora credentials from backend
      const joinResponse = await new Promise<LessonJoinResponse>((resolve, reject) => {
        this.lessonService.joinLesson(lessonId, role, userId).subscribe({
          next: resolve,
          error: reject
        });
      });
      
      if (!joinResponse || !joinResponse.success) {
        throw new Error('Failed to get lesson access');
      }

      const { agora, lesson, userRole } = joinResponse;
      console.log('📅 Received Agora credentials for lesson:', lesson.id);

      // Create local tracks based on user preferences from pre-call screen
      const micEnabled = options?.micEnabled !== false; // Default to true if not specified
      const videoEnabled = options?.videoEnabled !== false; // Default to true if not specified
      
      console.log("Creating local tracks:", { micEnabled, videoEnabled });
      
      // Always create both tracks (required for toggling), we'll disable them after publishing if needed
      // Using high-quality encoder config for better video quality
      console.log("Creating tracks with preferences:", { micEnabled, videoEnabled });
      
      // Store virtual background state before creating new tracks
      const savedVBState = { ...this.virtualBackgroundState };
      console.log('🔍 DEBUG: Saving virtual background state before creating new tracks:', JSON.stringify(savedVBState, null, 2));

      // Always create both tracks so we can toggle them later
      [this.localAudioTrack, this.localVideoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
        {},
        { encoderConfig: this.encoderConfig }
      );
      
      console.log("Successfully created local tracks with HD quality");

      // CRITICAL: Reset processor since we have new tracks - the old processor is tied to old tracks
      if (this.processor) {
        console.log('🔄 Resetting processor for new tracks...');
        try {
          // Properly unpipe the processor before resetting
          console.log('🔧 Unpiping existing processor...');
          this.processor.unpipe();
          console.log('✅ Processor unpiped successfully');
        } catch (unpipeError) {
          console.warn('⚠️ Error unpiping processor (continuing anyway):', unpipeError);
        }
        this.processor = null;
      }

      // Restore virtual background state after creating new tracks
      this.virtualBackgroundState = savedVBState;
      console.log('🔍 DEBUG: Restored virtual background state after creating new tracks:', JSON.stringify(this.virtualBackgroundState, null, 2));

      // Apply virtual background to the NEW tracks BEFORE joining channel
      if (savedVBState.enabled && savedVBState.type) {
        console.log('🔄 Applying virtual background to NEW tracks BEFORE joining channel...');
        
        // Check video track state before applying VB
        console.log('🔍 DEBUG: Video track state BEFORE VB:', {
          exists: !!this.localVideoTrack,
          enabled: this.localVideoTrack?.enabled,
          muted: this.localVideoTrack?.muted
        });
        
        try {
          await this.restoreVirtualBackgroundState();
          
          // Check video track state after applying VB
          console.log('🔍 DEBUG: Video track state AFTER VB:', {
            exists: !!this.localVideoTrack,
            enabled: this.localVideoTrack?.enabled,
            muted: this.localVideoTrack?.muted
          });
          
          // Ensure video track is enabled after VB processing
          if (this.localVideoTrack && !this.localVideoTrack.enabled) {
            console.log('⚠️ Video track was disabled by VB processing, re-enabling...');
            await this.localVideoTrack.setEnabled(true);
            console.log('✅ Video track re-enabled after VB processing');
          }
          
          console.log('✅ Virtual background applied to NEW tracks before joining');
        } catch (error) {
          console.error('❌ Failed to apply virtual background to NEW tracks:', error);
          // Continue without virtual background rather than failing the join
        }
      }

      // Join the RTC channel using backend-provided credentials
      await this.client.join(agora.appId, agora.channelName, agora.token, agora.uid);
      console.log("Successfully joined lesson channel:", agora.channelName);

      // Publish both tracks (they both exist now)
      await this.client.publish([this.localAudioTrack, this.localVideoTrack]);
      console.log("Successfully published local tracks");
      
      // Apply user preferences after publishing
      // Audio: Use setMuted() (can be toggled)
      // Video: Use setEnabled() (can be toggled since track exists and is published)
      if (!micEnabled) {
        this.localAudioTrack!.setMuted(true);
        console.log("Microphone track muted per user preference");
      }
      
      if (!videoEnabled) {
        // For video tracks, use setEnabled() to disable camera
        await this.localVideoTrack!.setEnabled(false);
        this.videoEnabledState = false; // Track state
        console.log("Video track disabled per user preference");
      } else {
        this.videoEnabledState = true; // Track state
        console.log("Video track enabled per user preference");
      }

      // Initialize real-time messaging for the lesson
      this.channelName = agora.channelName;
      this.currentLessonId = lesson.id;
      this.startMessagePolling();

      // Virtual background was already applied before publishing tracks above
      // No need for delayed restoration

      return joinResponse;

    } catch (error: any) {
      console.error("❌ Error joining lesson:", error);
      
      // Clean up tracks if they were created
      if (this.localVideoTrack) {
        this.localVideoTrack.close();
        this.localVideoTrack = null;
      }
      if (this.localAudioTrack) {
        this.localAudioTrack.close();
        this.localAudioTrack = null;
      }
      
      // Extract error message from HttpErrorResponse or regular Error
      let errorMessage = 'Failed to join lesson';
      
      if (error?.error?.message) {
        // HttpErrorResponse from backend
        errorMessage = error.error.message;
      } else if (error?.message) {
        // Regular Error object
        errorMessage = error.message;
      }
      
      // Provide user-friendly error messages based on backend response
      if (errorMessage.toLowerCase().includes('too early') || errorMessage.toLowerCase().includes('not started')) {
        errorMessage = 'You can join the lesson 15 minutes before it starts.';
      } else if (errorMessage.toLowerCase().includes('ended') || errorMessage.toLowerCase().includes('has end')) {
        errorMessage = 'This lesson has ended.';
      } else if (errorMessage.toLowerCase().includes('not authorized') || errorMessage.toLowerCase().includes('unauthorized')) {
        errorMessage = 'You are not authorized to join this lesson.';
      } else if (errorMessage.toLowerCase().includes('not found')) {
        errorMessage = 'Lesson not found.';
      } else if (errorMessage.toLowerCase().includes('cancelled')) {
        errorMessage = 'This lesson has been cancelled.';
      }
      
      throw new Error(errorMessage);
    }
  }

  private startMessagePolling(): void {
    // Stop any existing polling
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    // Poll for new messages every 500ms
    this.pollingInterval = setInterval(() => {
      this.pollForMessages();
    }, 500);

    console.log("Started message polling for channel:", this.channelName);
  }

  private async pollForMessages(): Promise<void> {
    if (!this.channelName || this.channelName === 'default') return;

    try {
      const response = await fetch(`${environment.backendUrl}/api/messaging/channels/${this.channelName}/messages?since=${this.lastMessageTime}`, {
        headers: this.getAuthHeaders()
      });

      if (response.ok) {
        const data = await response.json();
        
        if (data.success && data.messages.length > 0) {
          console.log(`📥 Polling found ${data.messages.length} new messages:`, 
            data.messages.map((m: any) => ({ type: m.type, timestamp: m.timestamp })));
          
          // Process each message
          data.messages.forEach((message: any) => {
            this.handleReceivedMessage(message);
          });

          // Update last message time
          this.lastMessageTime = data.serverTime;
        }
      } else {
        console.error('❌ Message polling failed:', response.status, response.statusText);
      }
    } catch (error) {
      console.error("Error polling for messages:", error);
    }
  }

  private handleReceivedMessage(message: any): void {
    console.log("📥 Received message:", message);
    
    try {
      if (message.type === 'whiteboard') {
        if (this.onWhiteboardMessage) {
          this.onWhiteboardMessage(message.payload);
        }
      } else if (message.type === 'chat') {
        if (this.onChatMessage) {
          this.onChatMessage(message.payload);
        }
      } else if (message.type === 'muteState') {
        console.log('🎤 Processing mute state message:', message.payload);
        this.handleRemoteMuteStateUpdate(message.payload);
      } else if (message.type === 'videoState') {
        console.log('📹 Processing video state message:', message.payload);
        this.handleRemoteVideoStateUpdate(message.payload);
      } else {
        console.log('⚠️ Unknown message type:', message.type);
      }
    } catch (error) {
      console.error("❌ Error handling received message:", error);
    }
  }

  private getAuthHeaders(): Record<string, string> {
    // Use the same auth headers as other services, but convert HttpHeaders to plain object
    const httpHeaders = this.userService.getAuthHeadersSync();
    const headers: Record<string, string> = {};
    
    // Convert HttpHeaders to plain object for fetch API
    httpHeaders.keys().forEach(key => {
      const value = httpHeaders.get(key);
      if (value) {
        headers[key] = value;
      }
    });
    
    // Ensure Content-Type is set for JSON requests
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    
    return headers;
  }

  async leaveChannel(): Promise<void> {
    if (!this.client) return;

    try {
      // Notify backend we left the lesson (for rejoin tracking)
      try {
        if (this.currentLessonId) {
          this.lessonService.leaveLesson(this.currentLessonId).subscribe({ next: () => {}, error: () => {} });
          // Emit event so other views can update immediately
          try {
            window.dispatchEvent(new CustomEvent('lesson-left' as any, { detail: { lessonId: this.currentLessonId } }));
          } catch (_) {}
        }
      } catch (_) {}

      // Stop message polling
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }

      // Disable virtual background before cleanup
      if (this.virtualBackgroundEnabled) {
        await this.disableVirtualBackground();
      }

      // Stop local tracks
      if (this.localVideoTrack) {
        this.localVideoTrack.stop();
        this.localVideoTrack.close();
        this.localVideoTrack = null;
      }

      if (this.localAudioTrack) {
        this.localAudioTrack.stop();
        this.localAudioTrack.close();
        this.localAudioTrack = null;
      }

      // Clean up virtual background processor
      if (this.processor) {
        try {
          console.log('🔧 Unpiping processor during cleanup...');
          this.processor.unpipe();
          console.log('✅ Processor unpiped during cleanup');
        } catch (unpipeError) {
          console.warn('⚠️ Error unpiping processor during cleanup:', unpipeError);
        }
        this.processor = null;
      }

      // Leave the channel
      await this.client.leave();
      console.log("Successfully left channel");

      // Clear remote users
      this.remoteUsers.clear();
      
      // Clean up messaging
      this.channelName = 'default';
      this.currentLessonId = null;

    } catch (error) {
      console.error("Error leaving channel:", error);
      throw error;
    }
  }

  async toggleMute(): Promise<boolean> {
    if (!this.localAudioTrack) return false;

    const isMuted = this.localAudioTrack.muted;
    await this.localAudioTrack.setMuted(!isMuted);
    
    // Send mute state to other users via messaging
    await this.sendMuteStateUpdate(!isMuted);
    
    console.log(`🎤 Microphone ${!isMuted ? 'muted' : 'unmuted'}, notified remote users`);
    return !isMuted;
  }

  async toggleVideo(): Promise<boolean> {
    if (!this.localVideoTrack) return false;

    try {
      // Use setEnabled() approach - simpler and more reliable
      const currentlyEnabled = this.videoEnabledState;
      const newState = !currentlyEnabled;
      
      console.log(`Toggling video: ${currentlyEnabled ? 'ON' : 'OFF'} -> ${newState ? 'ON' : 'OFF'}`);
      
      await this.localVideoTrack.setEnabled(newState);
      this.videoEnabledState = newState;
      
      // Send video state to other users via messaging
      await this.sendVideoStateUpdate(!newState);
      
      console.log('Video track setEnabled completed:', {
        newState,
        videoEnabledState: this.videoEnabledState,
        trackExists: !!this.localVideoTrack
      });
      
      return !newState; // Return true if video is now off, false if video is now on
    } catch (error) {
      console.error('Error toggling video:', error);
      return !this.videoEnabledState; // Return opposite of current state on error
    }
  }

  getLocalVideoTrack(): ICameraVideoTrack | ILocalVideoTrack | null {
    return this.localVideoTrack;
  }

  getLocalAudioTrack(): IMicrophoneAudioTrack | null {
    return this.localAudioTrack;
  }

  isVideoEnabled(): boolean {
    return this.videoEnabledState;
  }

  getRemoteUsers(): Map<UID, { videoTrack?: IRemoteVideoTrack; audioTrack?: IRemoteAudioTrack; isMuted?: boolean; isVideoOff?: boolean }> {
    return this.remoteUsers;
  }

  getRemoteUserState(uid: UID): { isMuted?: boolean; isVideoOff?: boolean } | null {
    const user = this.remoteUsers.get(uid);
    return user ? { isMuted: user.isMuted, isVideoOff: user.isVideoOff } : null;
  }

  // Clean up local tracks without leaving channel (useful for pre-call cleanup)
  async cleanupLocalTracks(): Promise<void> {
    console.log('🧹 Cleaning up local Agora tracks...');
    
    // Disable virtual background before cleanup
    if (this.virtualBackgroundEnabled && this.processor) {
      try {
        await this.disableVirtualBackground();
      } catch (error) {
        console.warn('⚠️ Error disabling virtual background during cleanup:', error);
      }
    }

    // Clean up virtual background processor
    if (this.processor) {
      try {
        console.log('🔧 Unpiping processor during track cleanup...');
        this.processor.unpipe();
        console.log('✅ Processor unpiped during track cleanup');
      } catch (unpipeError) {
        console.warn('⚠️ Error unpiping processor during track cleanup:', unpipeError);
      }
      this.processor = null;
    }

    // Stop and close video track
    if (this.localVideoTrack) {
      try {
        console.log('🛑 Stopping and closing local video track...');
        this.localVideoTrack.stop();
        this.localVideoTrack.close();
        console.log('✅ Local video track cleaned up');
      } catch (error) {
        console.warn('⚠️ Error cleaning up video track:', error);
      }
      this.localVideoTrack = null;
    }

    // Stop and close audio track
    if (this.localAudioTrack) {
      try {
        console.log('🛑 Stopping and closing local audio track...');
        this.localAudioTrack.stop();
        this.localAudioTrack.close();
        console.log('✅ Local audio track cleaned up');
      } catch (error) {
        console.warn('⚠️ Error cleaning up audio track:', error);
      }
      this.localAudioTrack = null;
    }

    console.log('✅ Local tracks cleanup complete');
  }

  // Create Agora tracks for pre-call (similar to joinLesson but without joining)
  async createMicrophoneAndCameraTracks(): Promise<[IMicrophoneAudioTrack, ICameraVideoTrack]> {
    try {
      // Create tracks with high-quality encoder config
      const [audioTrack, videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
        {},
        { encoderConfig: this.encoderConfig }
      );

      // Store references
      this.localAudioTrack = audioTrack;
      this.localVideoTrack = videoTrack;
      
      console.log('Created Agora microphone and camera tracks for pre-call');
      return [audioTrack, videoTrack];
    } catch (error) {
      console.error('Error creating Agora tracks for pre-call:', error);
      throw error;
    }
  }

  async getDevices() {
    try {
      const devices = await AgoraRTC.getDevices();
      return {
        cameras: devices.filter(device => device.kind === 'videoinput'),
        microphones: devices.filter(device => device.kind === 'audioinput'),
        speakers: devices.filter(device => device.kind === 'audiooutput')
      };
    } catch (error) {
      console.error("Error getting devices:", error);
      return { cameras: [], microphones: [], speakers: [] };
    }
  }

  private handleRemoteMuteStateUpdate(payload: { uid: UID; isMuted: boolean; timestamp: string }): void {
    console.log('🎤 Received remote mute state update:', payload);
    
    // Try to find the remote user by UID first
    let remoteUser = this.remoteUsers.get(payload.uid);
    let targetUid = payload.uid;
    
    // If not found by UID (or UID is null), use the first available remote user
    if (!remoteUser && this.remoteUsers.size > 0) {
      const firstRemoteEntry = Array.from(this.remoteUsers.entries())[0];
      targetUid = firstRemoteEntry[0];
      remoteUser = firstRemoteEntry[1];
      console.log(`🎤 UID ${payload.uid} not found, using first remote user: ${targetUid}`);
    }
    
    if (remoteUser) {
      remoteUser.isMuted = payload.isMuted;
      console.log(`✅ Updated remote user ${targetUid} mute state to: ${payload.isMuted ? 'muted' : 'unmuted'}`);
      
      // Notify the video call component if callback is set
      if (this.onRemoteUserStateChange) {
        this.onRemoteUserStateChange(targetUid, { isMuted: payload.isMuted });
      }
    } else {
      console.log('⚠️ No remote users found to update mute state');
    }
  }

  private handleRemoteVideoStateUpdate(payload: { uid: UID; isVideoOff: boolean; timestamp: string }): void {
    console.log('📹 Received remote video state update:', payload);
    
    // Try to find the remote user by UID first
    let remoteUser = this.remoteUsers.get(payload.uid);
    let targetUid = payload.uid;
    
    // If not found by UID (or UID is null), use the first available remote user
    if (!remoteUser && this.remoteUsers.size > 0) {
      const firstRemoteEntry = Array.from(this.remoteUsers.entries())[0];
      targetUid = firstRemoteEntry[0];
      remoteUser = firstRemoteEntry[1];
      console.log(`📹 UID ${payload.uid} not found, using first remote user: ${targetUid}`);
    }
    
    if (remoteUser) {
      remoteUser.isVideoOff = payload.isVideoOff;
      console.log(`✅ Updated remote user ${targetUid} video state to: ${payload.isVideoOff ? 'off' : 'on'}`);
      
      // Notify the video call component if callback is set
      if (this.onRemoteUserStateChange) {
        this.onRemoteUserStateChange(targetUid, { isVideoOff: payload.isVideoOff });
      }
    } else {
      console.log('⚠️ No remote users found to update video state');
    }
  }

  // Send whiteboard data via HTTP API
  async sendWhiteboardData(data: any): Promise<void> {
    if (!this.channelName || this.channelName === 'default') {
      console.warn("Cannot send whiteboard data: no active channel");
      return;
    }

    try {
      const response = await fetch(`${environment.backendUrl}/api/messaging/channels/${this.channelName}/messages`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          type: 'whiteboard',
          payload: data
        })
      });

      if (response.ok) {
        console.log("Whiteboard data sent successfully:", data);
      } else {
        console.error("Failed to send whiteboard data:", response.statusText);
      }
    } catch (error) {
      console.error("Error sending whiteboard data:", error);
    }
  }

  // Send chat message via HTTP API
  async sendChatMessage(message: any): Promise<void> {
    if (!this.channelName || this.channelName === 'default') {
      console.warn("Cannot send chat message: no active channel");
      return;
    }

    try {
      const response = await fetch(`${environment.backendUrl}/api/messaging/channels/${this.channelName}/messages`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          type: 'chat',
          payload: message
        })
      });

      if (response.ok) {
        console.log("Chat message sent successfully:", message);
      } else {
        console.error("Failed to send chat message:", response.statusText);
      }
    } catch (error) {
      console.error("Error sending chat message:", error);
    }
  }

  // Send mute state update to other users
  async sendMuteStateUpdate(isMuted: boolean): Promise<void> {
    console.log('📤 Attempting to send mute state update:', { 
      isMuted, 
      channelName: this.channelName, 
      uid: this.UID 
    });

    if (!this.channelName || this.channelName === 'default') {
      console.warn("❌ Cannot send mute state: no active channel");
      return;
    }

    try {
      const payload = {
        type: 'muteState',
        payload: {
          uid: this.UID,
          isMuted: isMuted,
          timestamp: new Date().toISOString()
        }
      };

      console.log('📤 Sending mute state payload:', payload);

      const response = await fetch(`${environment.backendUrl}/api/messaging/channels/${this.channelName}/messages`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(payload)
      });

      console.log('📤 Mute state response status:', response.status);

      if (response.ok) {
        const responseData = await response.text();
        console.log("✅ Mute state sent successfully:", { isMuted, response: responseData });
      } else {
        const errorText = await response.text();
        console.error("❌ Failed to send mute state:", response.status, response.statusText, errorText);
      }
    } catch (error) {
      console.error("❌ Error sending mute state:", error);
    }
  }

  // Send video state update to other users
  async sendVideoStateUpdate(isVideoOff: boolean): Promise<void> {
    if (!this.channelName || this.channelName === 'default') {
      console.warn("Cannot send video state: no active channel");
      return;
    }

    try {
      const response = await fetch(`${environment.backendUrl}/api/messaging/channels/${this.channelName}/messages`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          type: 'videoState',
          payload: {
            uid: this.UID,
            isVideoOff: isVideoOff,
            timestamp: new Date().toISOString()
          }
        })
      });

      if (response.ok) {
        console.log("Video state sent successfully:", { isVideoOff });
      } else {
        console.error("Failed to send video state:", response.statusText);
      }
    } catch (error) {
      console.error("Error sending video state:", error);
    }
  }
}