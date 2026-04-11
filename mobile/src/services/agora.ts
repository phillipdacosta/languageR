import createAgoraRtcEngine, {
  type IRtcEngine,
  ChannelProfileType,
  ClientRoleType,
  BackgroundSourceType,
  BackgroundBlurDegree,
  SegModelType,
  ChannelMediaOptions,
} from 'react-native-agora';
import { env } from '../config/env';

export type VbMode = 'none' | 'blur' | 'black';

let engine: IRtcEngine | null = null;
let currentVbMode: VbMode = 'none';

function getEngine(): IRtcEngine {
  if (!engine) throw new Error('Agora engine not initialized');
  return engine;
}

export const agoraService = {
  /**
   * @param appId Optional Agora App ID from join-lesson response (must match token).
   */
  async initialize(appId?: string): Promise<IRtcEngine> {
    if (engine) return engine;

    engine = createAgoraRtcEngine();
    engine.initialize({
      appId: appId ?? env.agora.appId,
      channelProfile: ChannelProfileType.ChannelProfileCommunication,
    });
    engine.setClientRole(ClientRoleType.ClientRoleBroadcaster);

    return engine;
  },

  enablePreview(): void {
    const e = getEngine();
    e.enableVideo();
    e.startPreview();
  },

  disablePreview(): void {
    try {
      const e = getEngine();
      e.stopPreview();
      e.disableVideo();
    } catch {
      // engine may already be destroyed
    }
  },

  setVirtualBackground(mode: VbMode): void {
    const e = getEngine();
    currentVbMode = mode;

    const segProperty = { modelType: SegModelType.SegModelAi };

    switch (mode) {
      case 'blur':
        e.enableVirtualBackground(
          true,
          {
            background_source_type: BackgroundSourceType.BackgroundBlur,
            blur_degree: BackgroundBlurDegree.BlurDegreeHigh,
          },
          segProperty,
        );
        break;
      case 'black':
        e.enableVirtualBackground(
          true,
          {
            background_source_type: BackgroundSourceType.BackgroundColor,
            color: 0x000000,
          },
          segProperty,
        );
        break;
      case 'none':
      default:
        e.enableVirtualBackground(
          false,
          { background_source_type: BackgroundSourceType.BackgroundNone },
          segProperty,
        );
        break;
    }
  },

  getCurrentVbMode(): VbMode {
    return currentVbMode;
  },

  muteLocalAudio(muted: boolean): void {
    try {
      getEngine().muteLocalAudioStream(muted);
    } catch {
      // ignore if engine not ready
    }
  },

  muteLocalVideo(muted: boolean): void {
    try {
      getEngine().muteLocalVideoStream(muted);
    } catch {
      // ignore if engine not ready
    }
  },

  getEngine(): IRtcEngine | null {
    return engine;
  },

  joinChannel(params: { token: string; channelId: string; uid: number }): number {
    const e = getEngine();
    const options = new ChannelMediaOptions();
    options.publishCameraTrack = true;
    options.publishMicrophoneTrack = true;
    options.autoSubscribeAudio = true;
    options.autoSubscribeVideo = true;
    options.clientRoleType = ClientRoleType.ClientRoleBroadcaster;
    return e.joinChannel(params.token, params.channelId, params.uid, options);
  },

  joinChannelWithUserAccount(params: {
    token: string;
    channelId: string;
    userAccount: string;
  }): number {
    const e = getEngine();
    const options = new ChannelMediaOptions();
    options.publishCameraTrack = true;
    options.publishMicrophoneTrack = true;
    options.autoSubscribeAudio = true;
    options.autoSubscribeVideo = true;
    options.clientRoleType = ClientRoleType.ClientRoleBroadcaster;
    return e.joinChannelWithUserAccount(
      params.token,
      params.channelId,
      params.userAccount,
      options,
    );
  },

  leaveChannel(): void {
    if (!engine) return;
    try {
      engine.leaveChannel();
    } catch {
      // not in channel
    }
  },

  destroy(): void {
    if (!engine) return;
    try {
      try {
        engine.leaveChannel();
      } catch {
        // ignore
      }
      engine.stopPreview();
      engine.disableVideo();
      engine.disableAudio();
      engine.removeAllListeners();
      engine.release();
    } catch {
      // best effort cleanup
    }
    engine = null;
    currentVbMode = 'none';
  },
};
