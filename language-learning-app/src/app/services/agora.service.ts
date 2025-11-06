import { Injectable } from '@angular/core';
import AgoraRTC, {
  IAgoraRTCClient,
  ICameraVideoTrack,
  IMicrophoneAudioTrack,
  IRemoteVideoTrack,
  IRemoteAudioTrack,
  UID
} from 'agora-rtc-sdk-ng';
// import AgoraRTM from 'agora-rtm-sdk'; // Disabled due to compilation issues
import { environment } from '../../environments/environment';
import { TokenGeneratorService } from './token-generator.service';
import { LessonService, LessonJoinResponse } from './lesson.service';
import { UserService } from './user.service';

@Injectable({
  providedIn: 'root'
})
export class AgoraService {
  private client: IAgoraRTCClient | null = null;
  private localVideoTrack: ICameraVideoTrack | null = null;
  private localAudioTrack: IMicrophoneAudioTrack | null = null;
  private remoteUsers: Map<UID, { videoTrack?: IRemoteVideoTrack; audioTrack?: IRemoteAudioTrack; isMuted?: boolean; isVideoOff?: boolean }> = new Map();
  private videoEnabledState: boolean = true; // Track video enabled state

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
      codec: "vp8" 
    });

    // Set up event listeners
    this.setupEventListeners();

    return this.client;
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

    // Note: Real-time messaging would require Agora RTM SDK
    // For now, we'll use localStorage + storage events for cross-window sync
  }

  async joinChannel(channelName: string, uid?: UID): Promise<void> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    try {
      // First, request permissions and create local tracks with high-quality encoder config
      console.log("Requesting camera and microphone permissions...");
      [this.localAudioTrack, this.localVideoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
        {},
        { encoderConfig: this.encoderConfig }
      );
      console.log("Successfully created local tracks with HD quality");

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
      
      // Always create both tracks so we can toggle them later
      [this.localAudioTrack, this.localVideoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
        {},
        { encoderConfig: this.encoderConfig }
      );
      
      console.log("Successfully created local tracks with HD quality");

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

  getLocalVideoTrack(): ICameraVideoTrack | null {
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

  // Simple real-time messaging using localStorage events and custom events
  private async initializeRTM(channelName: string): Promise<void> {
    try {
      console.log("Initializing simple real-time messaging...");
      
      // Use localStorage events for cross-tab sync
      window.addEventListener('storage', (e) => {
        if (e.key === `agora-message-${channelName}` && e.newValue) {
          this.handleIncomingMessage(e.newValue);
        }
      });
      
      // Use custom events for same-tab sync
      window.addEventListener('agora-message', (e: any) => {
        if (e.detail && e.detail.channel === channelName) {
          this.handleIncomingMessage(JSON.stringify(e.detail.data));
        }
      });
      
      console.log("Simple real-time messaging initialized");
      
    } catch (error) {
      console.error("Error initializing messaging:", error);
    }
  }

  private handleIncomingMessage(messageData: string): void {
    try {
      const data = JSON.parse(messageData);
      if (data.type === 'whiteboard') {
        if (this.onWhiteboardMessage) {
          this.onWhiteboardMessage(data.payload);
        }
      } else if (data.type === 'chat') {
        if (this.onChatMessage) {
          this.onChatMessage(data.payload);
        }
      } else if (data.type === 'muteState') {
        this.handleRemoteMuteStateUpdate(data.payload);
      } else if (data.type === 'videoState') {
        this.handleRemoteVideoStateUpdate(data.payload);
      }
    } catch (error) {
      console.error("Error parsing message:", error);
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
