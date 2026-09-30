import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { SignalRService } from './signalr.service';
import { RoomService } from './room.service';
import { AudioDeviceService } from './audio-device.service';
import { ToastService } from './toast.service';
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
    isWebRtcStreaming: false
  });
  public readonly syncState$: Observable<CinemaSyncState> = this.syncStateSubject.asObservable();

  private readonly deviceReportsSubject = new BehaviorSubject<Map<string, DeviceSyncReport>>(new Map());
  public readonly deviceReports$: Observable<Map<string, DeviceSyncReport>> = this.deviceReportsSubject.asObservable();

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

  // Web Audio Context for zero-latency mobile playback, spatial panning & gain control
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private remoteStreamSourceNode: MediaStreamAudioSourceNode | null = null;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.autoplay = true;
    (this.audio as any).playsInline = true;

    this.initSignalRListeners();
  }

  public setAudioElement(el: HTMLAudioElement): void {
    if (el) {
      this.audio = el;
      this.audio.preload = 'auto';
      this.audio.autoplay = true;
      (this.audio as any).playsInline = true;
      if (this.fallbackAudioUrl && !this.remoteAudioStream) {
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

  private getIceServers(): RTCIceServer[] {
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.relay.metered.ca:80' },
      {
        urls: 'turn:standard.relay.metered.ca:80',
        username: 'e7137f8eb4f7bb84813589b2',
        credential: 'b+Z62O3q92HjD/iA'
      },
      {
        urls: 'turn:standard.relay.metered.ca:443',
        username: 'e7137f8eb4f7bb84813589b2',
        credential: 'b+Z62O3q92HjD/iA'
      },
      {
        urls: 'turn:standard.relay.metered.ca:443?transport=tcp',
        username: 'e7137f8eb4f7bb84813589b2',
        credential: 'b+Z62O3q92HjD/iA'
      }
    ];
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
   * Laptop Host captures audio from local video element and shares with phones via WebRTC
   */
  public attachVideoAudioSource(video: HTMLVideoElement): void {
    try {
      video.crossOrigin = 'anonymous';

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!this.audioCtx) {
        this.audioCtx = new AudioContextClass();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      if (this.currentVideoElement !== video) {
        this.currentVideoElement = video;

        try {
          this.mediaElementSource = this.audioCtx.createMediaElementSource(video);
          const dest = this.audioCtx.createMediaStreamDestination();
          this.mediaElementSource.connect(dest);
          this.mediaElementSource.connect(this.audioCtx.destination);
          this.localAudioStream = dest.stream;
        } catch (webaudioErr) {
          console.warn('Web Audio createMediaElementSource fallback:', webaudioErr);
        }
      }

      // If localAudioStream has no tracks, fallback to captureStream
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
    } catch (e) {
      console.warn('Could not capture audio stream from video:', e);
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
      // Close previous connection if any
      const existing = this.peerConnections.get(targetConnectionId);
      if (existing) {
        try { existing.close(); } catch {}
      }

      const pc = new RTCPeerConnection({ iceServers: this.getIceServers() });
      this.peerConnections.set(targetConnectionId, pc);

      audioTracks.forEach(track => {
        pc.addTrack(track, this.localAudioStream!);
      });

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
    } catch (err) {
      console.warn(`WebRTC error connecting to phone ${targetConnectionId}:`, err);
    }
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

        pc.ontrack = (event) => {
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
          this.updateSyncState({ isWebRtcStreaming: true, syncQuality: 'Excellent' });
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
          await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        }
        this.candidateQueues.delete(senderId);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        await this.signalRService.sendWebRtcSignal(this.currentRoomCode, {
          targetConnectionId: senderId,
          signalType: 'answer',
          data: JSON.stringify(answer)
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
          await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        }
        this.candidateQueues.delete(senderId);
      }
    } else if (signal.signalType === 'candidate') {
      const pc = this.peerConnections.get(senderId);
      if (pc) {
        const candidate = JSON.parse(signal.data);
        if (!pc.remoteDescription || !pc.remoteDescription.type) {
          if (!this.candidateQueues.has(senderId)) {
            this.candidateQueues.set(senderId, []);
          }
          this.candidateQueues.get(senderId)!.push(candidate);
        } else {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
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
    // 1. Attach directly to HTMLAudioElement
    this.audio.srcObject = stream;
    this.audio.play().catch(e => console.warn('audio.play srcObject error:', e));

    // 2. Also attach via Web Audio API AudioContext for zero-latency, mobile autoplay bypass
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!this.audioCtx) {
        this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      if (!this.gainNode) {
        this.gainNode = this.audioCtx.createGain();
        this.gainNode.gain.value = this.audio.volume || 0.85;
        this.gainNode.connect(this.audioCtx.destination);
      }

      if (this.remoteStreamSourceNode) {
        try { this.remoteStreamSourceNode.disconnect(); } catch {}
      }
      this.remoteStreamSourceNode = this.audioCtx.createMediaStreamSource(stream);
      this.remoteStreamSourceNode.connect(this.gainNode);
    } catch (e) {
      console.warn('Web Audio stream source routing error:', e);
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

    // Start telemetry reporter every 2000ms
    if (this.telemetryIntervalId) clearInterval(this.telemetryIntervalId);
    this.telemetryIntervalId = setInterval(() => {
      this.sendTelemetryReport();
    }, 2000);
  }

  public applyPlaybackState(state: PlaybackState): void {
    this.currentPlaybackState = state;

    // If WebRTC is actively streaming from laptop, audio is transmitted live!
    if (this.remoteAudioStream) {
      if (state.isPlaying) {
        if (this.audio.paused) this.audio.play().catch(() => {});
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
          this.audioCtx.resume().catch(() => {});
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

    if (this.audio.paused) {
      this.audio.play().catch(e => console.warn('audio.play error:', e));
    }
  }

  private evaluateAndAdjustDrift(): void {
    if (!this.currentPlaybackState || !this.currentPlaybackState.isPlaying) {
      return;
    }

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
        isWebRtcStreaming: true
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
      isWebRtcStreaming: false
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
      lastSyncTime: Date.now()
    };

    this.signalRService.reportDeviceSync(this.currentRoomCode, report).catch(() => {});
  }

  public unlockAudioOnTouch(): void {
    // 1. Resume Web Audio Context
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!this.audioCtx) {
        this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      // Play immediate confirmation chime so user instantly hears their speaker working!
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

    // 2. Play HTML5 Audio element immediately with fallback URL or stream
    try {
      if (this.remoteAudioStream) {
        this.audio.srcObject = this.remoteAudioStream;
        this.audio.play().catch(e => console.warn('Stream play error:', e));
      } else if (this.fallbackAudioUrl) {
        this.audio.src = this.fallbackAudioUrl;
        if (this.currentPlaybackState && this.currentPlaybackState.isPlaying) {
          const nowServer = this.signalRService.estimatedServerTime;
          const elapsed = (nowServer - (this.currentPlaybackState.scheduledPlayTime || this.currentPlaybackState.serverTimestamp)) / 1000.0;
          this.audio.currentTime = Math.max(0, this.currentPlaybackState.currentPosition + elapsed);
        }
        this.audio.play().catch(e => console.warn('Direct fallback play error:', e));
      }
    } catch (e) {
      console.warn('HTML5 Audio unlock error:', e);
    }

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
    this.audio.volume = clamped / 100;
    if (this.gainNode && this.audioCtx) {
      this.gainNode.gain.setValueAtTime(clamped / 100, this.audioCtx.currentTime);
    }
  }

  public toggleMute(): boolean {
    this.audio.muted = !this.audio.muted;
    if (this.gainNode && this.audioCtx) {
      this.gainNode.gain.setValueAtTime(
        this.audio.muted ? 0 : this.audio.volume,
        this.audioCtx.currentTime
      );
    }
    return this.audio.muted;
  }

  public setDevicePosition(position: DevicePosition): void {
    this.devicePosition = position;
    if (this.currentRoomCode && this.signalRService.isConnected) {
      this.signalRService.updateDevicePosition(this.currentRoomCode, {
        devicePosition: position,
        volume: Math.round(this.audio.volume * 100),
        isMuted: this.audio.muted
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
