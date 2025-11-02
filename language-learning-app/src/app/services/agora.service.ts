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
  private remoteUsers: Map<UID, { videoTrack?: IRemoteVideoTrack; audioTrack?: IRemoteAudioTrack }> = new Map();

  // Real-time messaging properties
  private channelName: string = 'default';
  private lastMessageTime: string = new Date().toISOString();
  private pollingInterval: any = null;
  private currentLessonId: string | null = null;

  private readonly APP_ID = environment.agora.appId;
  private readonly TOKEN = environment.agora.token;
  private readonly UID = environment.agora.uid;

  // Callbacks for real-time messaging
  onWhiteboardMessage?: (data: any) => void;
  onChatMessage?: (message: any) => void;

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
      console.log("User published:", user, mediaType);
      
      // Subscribe to the remote user
      await this.client!.subscribe(user, mediaType);
      
      if (mediaType === "video") {
        this.remoteUsers.set(user.uid, { 
          ...this.remoteUsers.get(user.uid), 
          videoTrack: user.videoTrack 
        });
      }
      
      if (mediaType === "audio") {
        this.remoteUsers.set(user.uid, { 
          ...this.remoteUsers.get(user.uid), 
          audioTrack: user.audioTrack 
        });
        user.audioTrack?.play();
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
      console.log("User left:", user);
      this.remoteUsers.delete(user.uid);
    });

    // Note: Real-time messaging would require Agora RTM SDK
    // For now, we'll use localStorage + storage events for cross-window sync
  }

  async joinChannel(channelName: string, uid?: UID): Promise<void> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    try {
      // First, request permissions and create local tracks
      console.log("Requesting camera and microphone permissions...");
      [this.localAudioTrack, this.localVideoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
      console.log("Successfully created local tracks");

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
      
      // Always create tracks enabled (required for publishing), we'll disable them after publishing if needed
      if (micEnabled && videoEnabled) {
        // Both enabled - create together
        [this.localAudioTrack, this.localVideoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
      } else if (micEnabled && !videoEnabled) {
        // Only mic enabled
        this.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
        this.localVideoTrack = null;
      } else if (!micEnabled && videoEnabled) {
        // Only video enabled
        this.localVideoTrack = await AgoraRTC.createCameraVideoTrack();
        this.localAudioTrack = null;
      } else {
        // Both disabled - still need to create at least one track for publishing
        // Create both tracks enabled, we'll disable them after publishing
        [this.localAudioTrack, this.localVideoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
      }
      
      console.log("Successfully created local tracks");

      // Join the RTC channel using backend-provided credentials
      await this.client.join(agora.appId, agora.channelName, agora.token, agora.uid);
      console.log("Successfully joined lesson channel:", agora.channelName);
      
      // Publish local tracks (only publish tracks that exist)
      // Note: Tracks must be enabled when publishing
      const tracksToPublish: any[] = [];
      if (this.localAudioTrack) tracksToPublish.push(this.localAudioTrack);
      if (this.localVideoTrack) tracksToPublish.push(this.localVideoTrack);
      
      if (tracksToPublish.length > 0) {
        await this.client.publish(tracksToPublish);
        console.log("Successfully published local tracks");
        
        // Now disable tracks based on user preferences (after publishing)
        if (this.localAudioTrack && !micEnabled) {
          this.localAudioTrack.setEnabled(false);
          console.log("Microphone track disabled per user preference");
        }
        if (this.localVideoTrack && !videoEnabled) {
          this.localVideoTrack.setEnabled(false);
          console.log("Video track disabled per user preference");
        }
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
      
      // Provide user-friendly error messages
      if (error.message?.includes('Too early')) {
        throw new Error('You can join the lesson 15 minutes before it starts.');
      } else if (error.message?.includes('ended')) {
        throw new Error('This lesson has ended.');
      } else if (error.message?.includes('not authorized')) {
        throw new Error('You are not authorized to join this lesson.');
      } else {
        throw new Error(error.message || 'Failed to join lesson');
      }
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
          // Process each message
          data.messages.forEach((message: any) => {
            this.handleReceivedMessage(message);
          });

          // Update last message time
          this.lastMessageTime = data.serverTime;
        }
      }
    } catch (error) {
      console.error("Error polling for messages:", error);
    }
  }

  private handleReceivedMessage(message: any): void {
    console.log("Received message:", message);
    
    try {
      if (message.type === 'whiteboard') {
        if (this.onWhiteboardMessage) {
          this.onWhiteboardMessage(message.payload);
        }
      } else if (message.type === 'chat') {
        if (this.onChatMessage) {
          this.onChatMessage(message.payload);
        }
      }
    } catch (error) {
      console.error("Error handling received message:", error);
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
    return !isMuted;
  }

  async toggleVideo(): Promise<boolean> {
    if (!this.localVideoTrack) return false;

    const isVideoOff = this.localVideoTrack.muted;
    await this.localVideoTrack.setMuted(!isVideoOff);
    return !isVideoOff;
  }

  getLocalVideoTrack(): ICameraVideoTrack | null {
    return this.localVideoTrack;
  }

  getLocalAudioTrack(): IMicrophoneAudioTrack | null {
    return this.localAudioTrack;
  }

  getRemoteUsers(): Map<UID, { videoTrack?: IRemoteVideoTrack; audioTrack?: IRemoteAudioTrack }> {
    return this.remoteUsers;
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
      }
    } catch (error) {
      console.error("Error parsing message:", error);
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

}
