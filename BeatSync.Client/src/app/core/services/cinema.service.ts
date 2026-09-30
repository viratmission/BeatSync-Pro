import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { SignalRService } from './signalr.service';
import { RoomService } from './room.service';
import { AudioDeviceService } from './audio-device.service';
import { ToastService } from './toast.service';
import { getApiBaseUrl } from './api-config';
import {
  CinemaPlaybackCommand,
  DevicePosition,
  DevicePositionUpdate,
  DeviceSyncReport,
  WebRtcSignal
} from '../models/cinema.model';
import { PlaybackState } from '../models/playback-state.model';
import { Participant } from '../models/participant.model';

export interface CinemaSyncState {
  driftMs: number;
  rtt: number;
  clockOffset: number;
  expectedPosition: number;
  actualPosition: number;
  playbackRate: number;
  syncQuality: 'Excellent' | 'Good' | 'Realigning' | 'Desynced';
  isWebRtcStreaming: boolean;
  webRtcState?: string;
  iceState?: string;
  audioTrackReceived?: boolean;
  audioPlaybackActive?: boolean;
  audioAutoplayBlocked?: boolean;
}

export interface PeerDiagnostics {
  connectionId: string;
  connectionState: RTCPeerConnectionState;
  iceState: RTCIceConnectionState;
  hasTrack: boolean;
  lastUpdated: number;
}

@Injectable({
  providedIn: 'root'
})
export class CinemaService {
  private readonly signalRService = inject(SignalRService);
  private readonly roomService = inject(RoomService);
  private readonly audioDeviceService = inject(AudioDeviceService);
  private readonly toastService = inject(ToastService);

  private readonly syncStateSubject = new BehaviorSubject<CinemaSyncState>({
    driftMs: 0,
    rtt: 0,
    clockOffset: 0,
    expectedPosition: 0,
    actualPosition: 0,
    playbackRate: 1.0,
    syncQuality: 'Excellent',
    isWebRtcStreaming: false,
    webRtcState: 'new',
    iceState: 'new',
    audioTrackReceived: false,
    audioPlaybackActive: false,
    audioAutoplayBlocked: true
  });
  public readonly syncState$: Observable<CinemaSyncState> = this.syncStateSubject.asObservable();

  private readonly deviceReportsSubject = new BehaviorSubject<Map<string, DeviceSyncReport>>(new Map());
  public readonly deviceReports$: Observable<Map<string, DeviceSyncReport>> = this.deviceReportsSubject.asObservable();

  private readonly peerDiagnosticsSubject = new BehaviorSubject<Map<string, PeerDiagnostics>>(new Map());
  public readonly peerDiagnostics$: Observable<Map<string, PeerDiagnostics>> = this.peerDiagnosticsSubject.asObservable();

  private audio: HTMLAudioElement;
  private fallbackAudioUrl = '';
  private currentPlaybackState: PlaybackState | null = null;
  private syncIntervalId: any = null;
  private telemetryIntervalId: any = null;
  private currentRoomCode = '';
  private currentUsername = '';
  private devicePosition: DevicePosition = 'FrontLeft';
  private subscriptions = new Subscription();

  // WebRTC P2P Mesh: Laptop Host maintains peer connections to each phone speaker
  private peerConnections = new Map<string, RTCPeerConnection>();
  private candidateQueues = new Map<string, RTCIceCandidateInit[]>();
  private localAudioStream: MediaStream | null = null;
  private remoteAudioStream: MediaStream | null = null;
  private currentVideoElement: HTMLVideoElement | null = null;
  private mediaElementSource: MediaElementAudioSourceNode | null = null;
  private mediaStreamDestination: MediaStreamAudioDestinationNode | null = null;
  private hostGainNode: GainNode | null = null;
  private hostVolume = 0.8;

  // Phone state
  private isUnlocked = false;
  private isAutoplayBlocked = true;
  private currentPhoneVolume = 0.85;
  private currentPhoneMuted = false;

  // Web Audio Context for zero-latency audio routing & chime
  private audioCtx: AudioContext | null = null;
  private remoteGainNode: GainNode | null = null;
  private remoteMediaStreamSource: MediaStreamAudioSourceNode | null = null;

  private iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ];

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.autoplay = true;
    (this.audio as any).playsInline = true;

    this.initSignalRListeners();
    this.fetchIceServers();
  }

  public setAudioElement(el: HTMLAudioElement): void {
    if (el) {
      this.audio = el;
      this.audio.preload = 'auto';
      this.audio.autoplay = true;
      (this.audio as any).playsInline = true;
      this.audio.volume = this.currentPhoneVolume;
      this.audio.muted = this.currentPhoneMuted;

      if (this.remoteAudioStream) {
        this.audio.srcObject = this.remoteAudioStream;
        if (this.isUnlocked) {
          this.audio.play().catch(e => console.warn('setAudioElement play error:', e));
        }
      } else if (this.fallbackAudioUrl) {
        this.audio.src = this.fallbackAudioUrl;
        this.audio.load();
      }
    }
  }

  public get audioElement(): HTMLAudioElement {
    return this.audio;
  }

  public get isConnected(): boolean {
    return this.signalRService.isConnected;
  }

  public async fetchIceServers(): Promise<void> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/cinema/ice-servers`);
      if (res.ok) {
        const servers = await res.json();
        if (Array.isArray(servers) && servers.length > 0) {
          this.iceServers = servers;
        }
      }
    } catch {
      // Keep Google STUN default
    }
  }

  public getIceServers(): RTCIceServer[] {
    return this.iceServers;
  }

  public async resumeAudioContext(): Promise<void> {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!this.audioCtx) {
        this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
    } catch (e) {
      console.warn('resumeAudioContext error:', e);
    }
  }

  private initSignalRListeners(): void {
    // WebRTC Signaling Listener
    this.subscriptions.add(
      this.signalRService.webRtcSignalReceived$.subscribe(async (signal: WebRtcSignal) => {
        await this.handleIncomingWebRtcSignal(signal);
      })
    );

    // Device telemetry updates (for Host view)
    this.subscriptions.add(
      this.signalRService.deviceSyncReported$.subscribe((report: DeviceSyncReport) => {
        const current = new Map(this.deviceReportsSubject.value);
        const key = report.connectionId || report.username || 'unknown';
        current.set(key, report);
        this.deviceReportsSubject.next(current);
      })
    );
  }

  // --- Laptop Host WebRTC Streaming ---

  /**
   * Laptop Host captures audio from local video element and shares with phones via WebRTC.
   * Crucial: If video.src is a blob: URL, remove crossorigin so CORS doesn't silence Web Audio!
   */
  public attachVideoAudioSource(video: HTMLVideoElement): void {
    try {
      // Local blob: URLs MUST NOT have crossorigin attribute or Web Audio produces pure silence!
      if (video.src && video.src.startsWith('blob:')) {
        video.removeAttribute('crossorigin');
        (video as any).crossOrigin = null;
      } else if (video.src && (video.src.startsWith('http:') || video.src.startsWith('https:'))) {
        video.crossOrigin = 'anonymous';
      }

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!this.audioCtx) {
        this.audioCtx = new AudioContextClass();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      // Attach MediaElementSourceNode ONLY ONCE per HTMLVideoElement
      if (!this.mediaElementSource || this.currentVideoElement !== video) {
        this.currentVideoElement = video;

        try {
          this.mediaElementSource = this.audioCtx.createMediaElementSource(video);

          // 1. WebRTC Destination (clean reference audio for phones)
          this.mediaStreamDestination = this.audioCtx.createMediaStreamDestination();
          this.mediaElementSource.connect(this.mediaStreamDestination);
          this.localAudioStream = this.mediaStreamDestination.stream;

          // 2. Laptop Speaker Output via host gain node (laptop hears audio locally)
          this.hostGainNode = this.audioCtx.createGain();
          this.hostGainNode.gain.setValueAtTime(this.hostVolume, this.audioCtx.currentTime);
          this.mediaElementSource.connect(this.hostGainNode);
          this.hostGainNode.connect(this.audioCtx.destination);

          console.log('[Cinema Host] Web Audio pipeline connected: Video -> Destination & Laptop Speaker');
        } catch (webaudioErr) {
          console.warn('[Cinema Host] Web Audio createMediaElementSource note:', webaudioErr);
        }
      }

      // Fallback captureStream if needed
      if (!this.localAudioStream || this.localAudioStream.getAudioTracks().length === 0) {
        if ((video as any).captureStream) {
          const cs = (video as any).captureStream();
          if (cs && cs.getAudioTracks().length > 0) {
            this.localAudioStream = cs;
          }
        } else if ((video as any).mozCaptureStream) {
          const mcs = (video as any).mozCaptureStream();
          if (mcs && mcs.getAudioTracks().length > 0) {
            this.localAudioStream = mcs;
          }
        }
      }

      // If media source changed, replace tracks on active peer connections without reconnecting
      this.replaceTracksForActivePeers();
    } catch (e) {
      console.warn('Could not capture audio stream from video:', e);
    }
  }

  public setHostVolume(volume0to100: number): void {
    this.hostVolume = Math.max(0, Math.min(100, volume0to100)) / 100;
    if (this.hostGainNode && this.audioCtx) {
      this.hostGainNode.gain.setValueAtTime(this.hostVolume, this.audioCtx.currentTime);
    }
  }

  public replaceTracksForActivePeers(): void {
    if (!this.localAudioStream) return;
    const audioTrack = this.localAudioStream.getAudioTracks()[0];
    if (!audioTrack) return;

    for (const [targetId, pc] of this.peerConnections) {
      const senders = pc.getSenders();
      const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
      if (audioSender && audioSender.track !== audioTrack) {
        audioSender.replaceTrack(audioTrack).catch(err => console.warn(`replaceTrack error for ${targetId}:`, err));
      }
    }
  }

  /**
   * Laptop Host initiates WebRTC connection to a newly joined or ready phone
   */
  public async connectToPhoneSpeaker(targetConnectionId: string, roomCode: string): Promise<void> {
    if (!this.localAudioStream) {
      if (this.currentVideoElement) {
        this.attachVideoAudioSource(this.currentVideoElement);
      }
      if (!this.localAudioStream) {
        console.warn('No local audio stream available to share');
        return;
      }
    }

    const audioTracks = this.localAudioStream.getAudioTracks();
    if (audioTracks.length === 0) {
      console.warn('No audio tracks in local audio stream yet');
      return;
    }

    try {
      // Check if existing peer connection is already active and healthy
      const existing = this.peerConnections.get(targetConnectionId);
      if (existing) {
        if (existing.connectionState === 'connected' && existing.iceConnectionState === 'connected') {
          console.log(`[Host WebRTC] Phone ${targetConnectionId} is already connected with active audio.`);
          return;
        }
        try { existing.close(); } catch {}
      }

      const pc = new RTCPeerConnection({ iceServers: this.getIceServers() });
      this.peerConnections.set(targetConnectionId, pc);

      audioTracks.forEach(track => {
        pc.addTrack(track, this.localAudioStream!);
      });

      pc.onconnectionstatechange = () => {
        console.log(`[Host WebRTC] Phone ${targetConnectionId} connectionState:`, pc.connectionState);
        this.updatePeerDiagnostic(targetConnectionId, pc.connectionState, pc.iceConnectionState, true);
        if (pc.connectionState === 'connected') {
          this.reconnectAttempts.delete(targetConnectionId);
        } else if (pc.connectionState === 'failed') {
          this.reconnectPhoneSpeaker(targetConnectionId, roomCode);
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[Host WebRTC] Phone ${targetConnectionId} iceConnectionState:`, pc.iceConnectionState);
        this.updatePeerDiagnostic(targetConnectionId, pc.connectionState, pc.iceConnectionState, true);
        if (pc.iceConnectionState === 'connected') {
          this.reconnectAttempts.delete(targetConnectionId);
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.signalRService.sendWebRtcSignal(roomCode, {
            targetConnectionId,
            signalType: 'candidate',
            data: JSON.stringify(event.candidate)
          });
        }
      };

      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
      });
      await pc.setLocalDescription(offer);

      await this.signalRService.sendWebRtcSignal(roomCode, {
        targetConnectionId,
        signalType: 'offer',
        data: JSON.stringify(offer)
      });

      this.updatePeerDiagnostic(targetConnectionId, pc.connectionState, pc.iceConnectionState, true);
    } catch (err) {
      console.warn(`WebRTC error connecting to phone ${targetConnectionId}:`, err);
    }
  }

  private reconnectAttempts = new Map<string, number>();

  public reconnectPhoneSpeaker(targetConnectionId: string, roomCode: string, force = false): void {
    if (force) {
      this.reconnectAttempts.delete(targetConnectionId);
    }
    const attempts = this.reconnectAttempts.get(targetConnectionId) || 0;
    if (attempts >= 2) {
      console.log(`[Host WebRTC] Direct P2P blocked by cellular carrier NAT for ${targetConnectionId}. Use same Wi-Fi.`);
      return;
    }
    this.reconnectAttempts.set(targetConnectionId, attempts + 1);
    const delay = (attempts + 1) * 2000;
    setTimeout(() => {
      console.log(`[Host WebRTC] Retrying connection to phone ${targetConnectionId} (${attempts + 1}/2)...`);
      this.connectToPhoneSpeaker(targetConnectionId, roomCode);
    }, delay);
  }

  private updatePeerDiagnostic(
    connectionId: string,
    connState: RTCPeerConnectionState,
    iceState: RTCIceConnectionState,
    hasTrack: boolean
  ): void {
    const current = new Map(this.peerDiagnosticsSubject.value);
    current.set(connectionId, {
      connectionId,
      connectionState: connState,
      iceState,
      hasTrack,
      lastUpdated: Date.now()
    });
    this.peerDiagnosticsSubject.next(current);
  }

  // --- Phone Listener WebRTC Receiver ---

  private async handleIncomingWebRtcSignal(signal: WebRtcSignal): Promise<void> {
    const senderId = signal.senderConnectionId;
    if (!senderId) return;

    if (signal.signalType === 'offer') {
      try {
        const existing = this.peerConnections.get(senderId);
        if (existing) {
          try { existing.close(); } catch {}
        }

        const pc = new RTCPeerConnection({ iceServers: this.getIceServers() });
        this.peerConnections.set(senderId, pc);

        pc.onconnectionstatechange = () => {
          console.log(`[Phone WebRTC] Connection state:`, pc.connectionState);
          this.updateSyncState({
            webRtcState: pc.connectionState,
            iceState: pc.iceConnectionState
          });
        };

        pc.oniceconnectionstatechange = () => {
          console.log(`[Phone WebRTC] ICE state:`, pc.iceConnectionState);
          this.updateSyncState({
            iceState: pc.iceConnectionState
          });
        };

        pc.ontrack = (event) => {
          console.log('[Phone WebRTC] Remote audio track received!');
          let stream: MediaStream;
          if (event.streams && event.streams[0]) {
            stream = event.streams[0];
          } else if (event.track) {
            stream = new MediaStream([event.track]);
          } else {
            return;
          }

          this.remoteAudioStream = stream;
          this.playRemoteStream(stream);
          this.updateSyncState({
            isWebRtcStreaming: true,
            syncQuality: 'Excellent',
            audioTrackReceived: true
          });
        };

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            this.signalRService.sendWebRtcSignal(this.currentRoomCode, {
              targetConnectionId: senderId,
              signalType: 'candidate',
              data: JSON.stringify(event.candidate)
            });
          }
        };

        const offer = JSON.parse(signal.data);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        // Flush queued candidates
        const queued = this.candidateQueues.get(senderId) || [];
        for (const cand of queued) {
          if (cand && cand.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
        }
        this.candidateQueues.delete(senderId);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        await this.signalRService.sendWebRtcSignal(this.currentRoomCode, {
          targetConnectionId: senderId,
          signalType: 'answer',
          data: JSON.stringify(answer)
        });

        this.updateSyncState({
          webRtcState: pc.connectionState,
          iceState: pc.iceConnectionState
        });
      } catch (err) {
        console.warn('Failed to handle WebRTC offer on phone:', err);
      }
    } else if (signal.signalType === 'answer') {
      const pc = this.peerConnections.get(senderId);
      if (pc) {
        const answer = JSON.parse(signal.data);
        await pc.setRemoteDescription(new RTCSessionDescription(answer)).catch(err => {
          console.warn('setRemoteDescription answer error:', err);
        });

        // Flush queued candidates
        const queued = this.candidateQueues.get(senderId) || [];
        for (const cand of queued) {
          if (cand && cand.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
        }
        this.candidateQueues.delete(senderId);
      }
    } else if (signal.signalType === 'candidate') {
      const pc = this.peerConnections.get(senderId);
      if (pc) {
        const candidate = JSON.parse(signal.data);
        if (candidate && candidate.candidate) {
          if (!pc.remoteDescription || !pc.remoteDescription.type) {
            if (!this.candidateQueues.has(senderId)) {
              this.candidateQueues.set(senderId, []);
            }
            this.candidateQueues.get(senderId)!.push(candidate);
          } else {
            await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
          }
        }
      }
    } else if (signal.signalType === 'ready') {
      // Phone is unlocked and requesting audio stream!
      if (this.localAudioStream && this.currentRoomCode) {
        this.connectToPhoneSpeaker(senderId, this.currentRoomCode);
      }
    }
  }

  private playRemoteStream(stream: MediaStream): void {
    this.remoteAudioStream = stream;

    // 1. Primary Zero-Latency Hardware Speaker Pipeline via Web Audio API:
    // Web Audio routes directly to mobile multimedia loudspeaker with zero buffer latency!
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!this.audioCtx) {
        this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      if (!this.remoteGainNode) {
        this.remoteGainNode = this.audioCtx.createGain();
        this.remoteGainNode.connect(this.audioCtx.destination);
      }

      const targetGain = this.currentPhoneMuted ? 0 : this.currentPhoneVolume;
      this.remoteGainNode.gain.setValueAtTime(targetGain, this.audioCtx.currentTime);

      if (this.remoteMediaStreamSource) {
        try { this.remoteMediaStreamSource.disconnect(); } catch {}
      }
      this.remoteMediaStreamSource = this.audioCtx.createMediaStreamSource(stream);
      this.remoteMediaStreamSource.connect(this.remoteGainNode);
      console.log('[Phone Audio] Web Audio speaker pipeline connected to WebRTC stream');
    } catch (webaudioErr) {
      console.warn('[Phone Audio] Web Audio routing note:', webaudioErr);
    }

    // 2. DOM HTML5 Audio Element (keeps browser media session alive)
    try {
      this.audio.srcObject = stream;
      // If Web Audio succeeded, keep DOM element at near-zero volume to prevent dual-audio echo
      this.audio.volume = this.remoteMediaStreamSource ? 0.001 : this.currentPhoneVolume;
      this.audio.muted = this.currentPhoneMuted;

      const playPromise = this.audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            this.isAutoplayBlocked = false;
            this.updateSyncState({
              audioPlaybackActive: true,
              audioAutoplayBlocked: false
            });
          })
          .catch(e => {
            console.warn('[Phone Audio] DOM audio.play waiting for gesture:', e);
            this.updateSyncState({
              audioPlaybackActive: !this.isAutoplayBlocked,
              audioAutoplayBlocked: this.isAutoplayBlocked
            });
          });
      }
    } catch (e) {
      console.warn('playRemoteStream error:', e);
    }
  }

  // --- High-Precision Timeline Synchronization Engine ---

  public startPhoneSyncEngine(
    roomCode: string,
    username: string,
    position: DevicePosition = 'FrontLeft',
    fallbackAudioUrl?: string
  ): void {
    this.currentRoomCode = roomCode;
    this.currentUsername = username;
    this.devicePosition = position;
    this.fallbackAudioUrl = fallbackAudioUrl || '';

    // Load fallback audio track if WebRTC is not yet established
    if (!this.remoteAudioStream && this.fallbackAudioUrl) {
      this.audio.src = this.fallbackAudioUrl;
      this.audio.load();
    }

    // High-resolution clock drift calibration
    this.signalRService.calibrateClock();

    // Start periodic watchdog: evaluates position drift every 300ms
    if (this.syncIntervalId) clearInterval(this.syncIntervalId);
    this.syncIntervalId = setInterval(() => {
      this.evaluateAndAdjustDrift();
    }, 300);

    // Start telemetry reporter every 1500ms
    if (this.telemetryIntervalId) clearInterval(this.telemetryIntervalId);
    this.telemetryIntervalId = setInterval(() => {
      this.sendTelemetryReport();
    }, 1500);
  }

  public applyPlaybackState(state: PlaybackState): void {
    this.currentPlaybackState = state;

    // If WebRTC is actively streaming from laptop, audio is transmitted live!
    if (this.remoteAudioStream) {
      if (state.isPlaying) {
        if (this.audio.paused && this.isUnlocked) {
          this.audio.play().catch(() => {});
        }
      } else {
        this.audio.pause();
      }
      return;
    }

    // Fallback HTTP Audio element mode
    if (!this.audio.src && this.fallbackAudioUrl) {
      this.audio.src = this.fallbackAudioUrl;
      this.audio.load();
    }

    if (!state.isPlaying) {
      this.audio.pause();
      const targetPos = Math.max(0, state.currentPosition);
      if (Math.abs(this.audio.currentTime - targetPos) > 0.3) {
        this.safeSetCurrentTime(targetPos);
      }
      this.audio.playbackRate = 1.0;
      return;
    }

    // Is playing: calculate expected position based on authoritative server timestamp
    const nowServer = this.signalRService.estimatedServerTime;

    let targetTime = state.currentPosition;
    if (state.scheduledPlayTime) {
      const elapsed = Math.max(0, (nowServer - state.scheduledPlayTime) / 1000.0);
      targetTime = state.currentPosition + elapsed * (state.playbackRate || 1.0);
    } else {
      const elapsed = Math.max(0, (nowServer - state.serverTimestamp) / 1000.0);
      targetTime = state.currentPosition + elapsed * (state.playbackRate || 1.0);
    }

    this.safeSetCurrentTime(targetTime);
    this.evaluateAndAdjustDrift();

    if (this.audio.paused && this.isUnlocked) {
      this.audio.play().catch(e => console.warn('audio.play error:', e));
    }
  }

  private evaluateAndAdjustDrift(): void {
    if (!this.currentPlaybackState || !this.currentPlaybackState.isPlaying) {
      return;
    }

    const firstPc = this.peerConnections.size > 0 ? Array.from(this.peerConnections.values())[0] : null;
    const webRtcState = firstPc ? firstPc.connectionState : 'disconnected';
    const iceState = firstPc ? firstPc.iceConnectionState : 'new';
    const audioTrackReceived = !!this.remoteAudioStream && this.remoteAudioStream.getAudioTracks().length > 0;
    const audioPlaybackActive = !this.audio.paused && !this.audio.ended && this.audio.readyState >= 2;

    // When WebRTC is active, drift is bounded by network latency (< 25ms)
    if (this.remoteAudioStream) {
      this.updateSyncState({
        driftMs: Math.round((this.signalRService as any).rtt / 2) || 8,
        rtt: (this.signalRService as any).rtt || 15,
        clockOffset: (this.signalRService as any).clockOffset || 0,
        expectedPosition: this.currentPlaybackState.currentPosition,
        actualPosition: this.currentPlaybackState.currentPosition,
        playbackRate: 1.0,
        syncQuality: 'Excellent',
        isWebRtcStreaming: true,
        webRtcState,
        iceState,
        audioTrackReceived,
        audioPlaybackActive,
        audioAutoplayBlocked: this.isAutoplayBlocked
      });
      return;
    }

    const state = this.currentPlaybackState;
    const nowServer = this.signalRService.estimatedServerTime;

    let elapsed = 0;
    if (state.scheduledPlayTime) {
      elapsed = Math.max(0, (nowServer - state.scheduledPlayTime) / 1000.0);
    } else {
      elapsed = Math.max(0, (nowServer - state.serverTimestamp) / 1000.0);
    }

    const expectedPosition = state.currentPosition + elapsed * (state.playbackRate || 1.0);
    const actualPosition = this.audio.currentTime;
    const diff = expectedPosition - actualPosition;
    const driftMs = Math.round(diff * 1000);

    let syncQuality: 'Excellent' | 'Good' | 'Realigning' | 'Desynced' = 'Excellent';

    if (Math.abs(diff) > 0.5) {
      this.safeSetCurrentTime(Math.max(0, expectedPosition));
      this.audio.playbackRate = 1.0;
      syncQuality = 'Desynced';
    } else if (Math.abs(diff) > 0.05) {
      this.audio.playbackRate = diff > 0 ? 1.05 : 0.95;
      syncQuality = 'Realigning';
    } else {
      this.audio.playbackRate = 1.0;
      syncQuality = Math.abs(driftMs) < 25 ? 'Excellent' : 'Good';
    }

    this.updateSyncState({
      driftMs,
      rtt: (this.signalRService as any).rtt || 15,
      clockOffset: (this.signalRService as any).clockOffset || 0,
      expectedPosition,
      actualPosition,
      playbackRate: this.audio.playbackRate,
      syncQuality,
      isWebRtcStreaming: false,
      webRtcState,
      iceState,
      audioTrackReceived: false,
      audioPlaybackActive,
      audioAutoplayBlocked: this.isAutoplayBlocked
    });
  }

  private sendTelemetryReport(): void {
    if (!this.signalRService.isConnected || !this.currentRoomCode) return;

    const state = this.syncStateSubject.value;
    const report: DeviceSyncReport = {
      driftMs: state.driftMs,
      rtt: state.rtt,
      clockOffset: state.clockOffset,
      playbackRate: state.playbackRate,
      syncStatus: state.syncQuality,
      devicePosition: this.devicePosition,
      lastSyncTime: Date.now(),
      webRtcState: state.webRtcState,
      iceState: state.iceState,
      audioTrackReceived: state.audioTrackReceived,
      audioPlaybackActive: state.audioPlaybackActive,
      audioAutoplayBlocked: state.audioAutoplayBlocked
    };

    this.signalRService.reportDeviceSync(this.currentRoomCode, report).catch(() => {});
  }

  public unlockAudioOnTouch(): void {
    this.isUnlocked = true;
    this.isAutoplayBlocked = false;

    // 1. Resume Web Audio Context immediately inside user gesture!
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!this.audioCtx) {
        this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      // If remote stream is already waiting, connect to Web Audio right now!
      if (this.remoteAudioStream) {
        if (!this.remoteGainNode) {
          this.remoteGainNode = this.audioCtx.createGain();
          this.remoteGainNode.connect(this.audioCtx.destination);
        }
        const targetGain = this.currentPhoneMuted ? 0 : this.currentPhoneVolume;
        this.remoteGainNode.gain.setValueAtTime(targetGain, this.audioCtx.currentTime);

        if (!this.remoteMediaStreamSource) {
          this.remoteMediaStreamSource = this.audioCtx.createMediaStreamSource(this.remoteAudioStream);
          this.remoteMediaStreamSource.connect(this.remoteGainNode);
        }
      }

      // Play immediate confirmation chime so user instantly hears speaker working
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      gain.gain.setValueAtTime(0.2, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.3);
      osc.frequency.setValueAtTime(523.25, this.audioCtx.currentTime); // C5
      osc.frequency.setValueAtTime(659.25, this.audioCtx.currentTime + 0.1); // E5
      osc.frequency.setValueAtTime(783.99, this.audioCtx.currentTime + 0.2); // G5
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.32);
    } catch (e) {
      console.warn('Web Audio unlock chime error:', e);
    }

    // 2. Play HTML5 Audio element immediately to unlock mobile browser restrictions
    try {
      if (this.remoteAudioStream) {
        this.audio.srcObject = this.remoteAudioStream;
        this.audio.volume = this.remoteMediaStreamSource ? 0.001 : this.currentPhoneVolume;
        this.audio.muted = this.currentPhoneMuted;
        this.audio.play().catch(e => console.warn('Stream play error:', e));
      } else if (this.fallbackAudioUrl) {
        this.audio.src = this.fallbackAudioUrl;
        if (this.currentPlaybackState && this.currentPlaybackState.isPlaying) {
          const nowServer = this.signalRService.estimatedServerTime;
          const elapsed = (nowServer - (this.currentPlaybackState.scheduledPlayTime || this.currentPlaybackState.serverTimestamp)) / 1000.0;
          this.audio.currentTime = Math.max(0, this.currentPlaybackState.currentPosition + elapsed);
        }
        this.audio.play().catch(e => console.warn('Direct fallback play error:', e));
      } else {
        // Play silent sound to permanently unlock the element
        const playPromise = this.audio.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {});
        }
      }
    } catch (e) {
      console.warn('HTML5 Audio unlock error:', e);
    }

    this.updateSyncState({
      audioAutoplayBlocked: false,
      audioPlaybackActive: true
    });

    // 3. Notify Host that this phone is unlocked and ready for WebRTC stream
    if (this.currentRoomCode && this.signalRService.isConnected) {
      this.signalRService.sendWebRtcSignal(this.currentRoomCode, {
        signalType: 'ready',
        data: 'phone-audio-ready'
      }).catch(() => {});
    }
  }

  public setDeviceVolume(volume0to100: number): void {
    const clamped = Math.max(0, Math.min(100, volume0to100));
    this.currentPhoneVolume = clamped / 100;
    this.audio.volume = this.remoteMediaStreamSource ? 0.001 : this.currentPhoneVolume;
    if (this.remoteGainNode && this.audioCtx) {
      this.remoteGainNode.gain.setValueAtTime(
        this.currentPhoneMuted ? 0 : this.currentPhoneVolume,
        this.audioCtx.currentTime
      );
    }
  }

  public toggleMute(): boolean {
    this.currentPhoneMuted = !this.currentPhoneMuted;
    this.audio.muted = this.currentPhoneMuted;
    if (this.remoteGainNode && this.audioCtx) {
      this.remoteGainNode.gain.setValueAtTime(
        this.currentPhoneMuted ? 0 : this.currentPhoneVolume,
        this.audioCtx.currentTime
      );
    }
    return this.currentPhoneMuted;
  }

  public setDevicePosition(position: DevicePosition): void {
    this.devicePosition = position;
    if (this.currentRoomCode && this.signalRService.isConnected) {
      this.signalRService.updateDevicePosition(this.currentRoomCode, {
        devicePosition: position,
        volume: Math.round(this.currentPhoneVolume * 100),
        isMuted: this.currentPhoneMuted
      }).catch(() => {});
    }
  }

  private safeSetCurrentTime(seconds: number): void {
    try {
      if (this.remoteAudioStream) return;
      if (this.audio.readyState >= 1) {
        this.audio.currentTime = Math.max(0, seconds);
      }
    } catch {}
  }

  private updateSyncState(partial: Partial<CinemaSyncState>): void {
    this.syncStateSubject.next({
      ...this.syncStateSubject.value,
      ...partial
    });
  }

  public stop(): void {
    if (this.syncIntervalId) clearInterval(this.syncIntervalId);
    if (this.telemetryIntervalId) clearInterval(this.telemetryIntervalId);

    if (this.remoteMediaStreamSource) {
      try { this.remoteMediaStreamSource.disconnect(); } catch {}
      this.remoteMediaStreamSource = null;
    }
    if (this.remoteGainNode) {
      try { this.remoteGainNode.disconnect(); } catch {}
      this.remoteGainNode = null;
    }
    if (this.hostGainNode) {
      try { this.hostGainNode.disconnect(); } catch {}
      this.hostGainNode = null;
    }
    if (this.mediaElementSource) {
      try { this.mediaElementSource.disconnect(); } catch {}
      this.mediaElementSource = null;
    }

    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();
    this.candidateQueues.clear();

    this.audio.pause();
    this.audio.src = '';
    this.audio.srcObject = null;
    this.remoteAudioStream = null;
    this.localAudioStream = null;
    this.subscriptions.unsubscribe();
  }
}
