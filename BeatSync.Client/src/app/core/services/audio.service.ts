import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { Track } from '../models/track.model';
import { PlaybackState } from '../models/playback-state.model';
import { getApiBaseUrl } from './api-config';
import { SignalRService } from './signalr.service';

export interface SyncStatus {
  driftMs: number;
  isSynced: boolean;
  rateAdjusted: boolean;
  expectedPosition: number;
  actualPosition: number;
}

@Injectable({
  providedIn: 'root'
})
export class AudioService {
  private readonly signalRService = inject(SignalRService);

  private readonly audio = new Audio();
  private currentTrack: Track | null = null;
  private currentPlaybackState: PlaybackState | null = null;
  private syncIntervalId: any = null;

  private readonly currentTimeSubject = new BehaviorSubject<number>(0);
  public readonly currentTime$: Observable<number> = this.currentTimeSubject.asObservable();

  private readonly durationSubject = new BehaviorSubject<number>(0);
  public readonly duration$: Observable<number> = this.durationSubject.asObservable();

  private readonly isPlayingSubject = new BehaviorSubject<boolean>(false);
  public readonly isPlaying$: Observable<boolean> = this.isPlayingSubject.asObservable();

  private readonly volumeSubject = new BehaviorSubject<number>(80);
  public readonly volume$: Observable<number> = this.volumeSubject.asObservable();

  private readonly isMutedSubject = new BehaviorSubject<boolean>(false);
  public readonly isMuted$: Observable<boolean> = this.isMutedSubject.asObservable();

  private readonly syncStatusSubject = new BehaviorSubject<SyncStatus>({
    driftMs: 0,
    isSynced: true,
    rateAdjusted: false,
    expectedPosition: 0,
    actualPosition: 0
  });
  public readonly syncStatus$: Observable<SyncStatus> = this.syncStatusSubject.asObservable();

  private readonly autoplayBlockedSubject = new BehaviorSubject<boolean>(false);
  public readonly autoplayBlocked$: Observable<boolean> = this.autoplayBlockedSubject.asObservable();

  private readonly trackEndedSubject = new Subject<void>();
  public readonly trackEnded$: Observable<void> = this.trackEndedSubject.asObservable();

  constructor() {
    this.initAudio();
  }

  private initAudio(): void {
    // Restore saved local volume
    const savedVol = localStorage.getItem('beatsync_volume');
    if (savedVol !== null) {
      const vol = Math.max(0, Math.min(100, Number(savedVol)));
      this.volumeSubject.next(vol);
      this.audio.volume = vol / 100;
    } else {
      this.audio.volume = 0.8;
      this.volumeSubject.next(80);
    }

    this.audio.preload = 'auto';

    this.audio.addEventListener('timeupdate', () => {
      this.currentTimeSubject.next(this.audio.currentTime);
    });

    this.audio.addEventListener('loadedmetadata', () => {
      this.durationSubject.next(this.audio.duration || 0);
    });

    this.audio.addEventListener('durationchange', () => {
      this.durationSubject.next(this.audio.duration || 0);
    });

    this.audio.addEventListener('play', () => {
      this.isPlayingSubject.next(true);
      this.autoplayBlockedSubject.next(false);
    });

    this.audio.addEventListener('pause', () => {
      this.isPlayingSubject.next(false);
    });

    this.audio.addEventListener('ended', () => {
      this.isPlayingSubject.next(false);
      this.trackEndedSubject.next();
    });

    this.audio.addEventListener('error', (e) => {
      console.warn('Audio playback error:', e);
    });

    // Start periodic synchronization watchdog (runs every 600ms)
    this.syncIntervalId = setInterval(() => {
      this.checkAndAdjustSync();
    }, 600);
  }

  public get audioElement(): HTMLAudioElement {
    return this.audio;
  }

  public loadTrack(track: Track, initialState?: PlaybackState): void {
    const isDifferentTrack = this.currentTrack?.id !== track.id;
    this.currentTrack = track;

    const fullAudioUrl = track.audioUrl.startsWith('http')
      ? track.audioUrl
      : `${getApiBaseUrl()}${track.audioUrl}`;

    if (isDifferentTrack || this.audio.src !== fullAudioUrl) {
      this.audio.pause();
      this.audio.src = fullAudioUrl;
      this.safeSetCurrentTime(0);
      this.currentTimeSubject.next(0);
      this.durationSubject.next(track.duration || 0);
      this.audio.load();
    }

    if (initialState) {
      this.syncPlayback(initialState);
    } else {
      this.safeSetCurrentTime(0);
      this.currentTimeSubject.next(0);
    }
  }

  public syncPlayback(state: PlaybackState): void {
    this.currentPlaybackState = state;

    if (!state.isPlaying) {
      this.audio.pause();
      const targetPos = Math.max(0, state.currentPosition);
      if (Math.abs(this.audio.currentTime - targetPos) > 0.3) {
        this.safeSetCurrentTime(targetPos);
      }
      this.currentTimeSubject.next(this.audio.currentTime);
      this.audio.playbackRate = 1.0;
      this.isPlayingSubject.next(false);
      return;
    }

    // Is playing: calculate expected position based on server time
    const expectedPosition = this.calculateExpectedPosition(state);
    const diff = expectedPosition - this.audio.currentTime;

    // Direct seek if large difference (> 1.2s)
    if (Math.abs(diff) > 1.2) {
      this.safeSetCurrentTime(Math.max(0, expectedPosition));
      this.audio.playbackRate = 1.0;
    } else if (Math.abs(diff) > 0.05) {
      // Micro-adjust playbackRate for smooth catchup
      this.audio.playbackRate = diff > 0 ? 1.05 : 0.95;
    } else {
      this.audio.playbackRate = 1.0;
    }

    // Play if paused
    if (this.audio.paused) {
      const playPromise = this.audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          if (err.name === 'NotAllowedError') {
            this.autoplayBlockedSubject.next(true);
          }
        });
      }
    }
  }

  private safeSetCurrentTime(seconds: number): void {
    try {
      if (this.audio.readyState >= 1) {
        this.audio.currentTime = Math.max(0, seconds);
      } else {
        const onLoaded = () => {
          try {
            this.audio.currentTime = Math.max(0, seconds);
          } catch {}
        };
        this.audio.addEventListener('loadedmetadata', onLoaded, { once: true });
      }
    } catch {
      try {
        this.audio.currentTime = Math.max(0, seconds);
      } catch {}
    }
  }

  public userInteractedEnableAudio(): void {
    this.autoplayBlockedSubject.next(false);
    if (this.currentPlaybackState?.isPlaying) {
      this.syncPlayback(this.currentPlaybackState);
    } else {
      // Prime audio element for mobile browsers so future plays from SignalR won't be blocked
      try {
        const p = this.audio.play();
        if (p !== undefined) {
          p.then(() => {
            this.audio.pause();
          }).catch(() => {});
        }
      } catch {}
    }
  }

  private calculateExpectedPosition(state: PlaybackState): number {
    const nowServer = this.signalRService.estimatedServerTime;
    const elapsedSeconds = Math.max(0, (nowServer - state.serverTimestamp) / 1000.0);
    const expected = state.currentPosition + elapsedSeconds * (state.playbackRate || 1.0);
    const duration = this.audio.duration || (this.currentTrack?.duration ?? 300);
    return Math.min(expected, duration);
  }

  private checkAndAdjustSync(): void {
    if (!this.currentPlaybackState || !this.currentPlaybackState.isPlaying || this.audio.paused) {
      return;
    }

    const expected = this.calculateExpectedPosition(this.currentPlaybackState);
    const actual = this.audio.currentTime;
    const diff = expected - actual;
    const driftMs = Math.round(diff * 1000);

    let rateAdjusted = false;

    // Phase 8: Clock Synchronization Tolerance
    if (Math.abs(diff) > 1.5) {
      // Severe desync: hard seek
      this.audio.currentTime = Math.max(0, expected);
      this.audio.playbackRate = 1.0;
    } else if (Math.abs(diff) > 0.06) {
      // Mild drift: smoothly speed up or slow down
      this.audio.playbackRate = diff > 0 ? 1.05 : 0.95;
      rateAdjusted = true;
    } else {
      // Well aligned
      this.audio.playbackRate = 1.0;
    }

    this.syncStatusSubject.next({
      driftMs,
      isSynced: Math.abs(driftMs) < 60,
      rateAdjusted,
      expectedPosition: expected,
      actualPosition: actual
    });
  }

  // Volume is strictly local to each device
  public setVolume(volume0to100: number): void {
    const clamped = Math.max(0, Math.min(100, volume0to100));
    this.audio.volume = clamped / 100;
    this.volumeSubject.next(clamped);
    localStorage.setItem('beatsync_volume', clamped.toString());
    if (clamped > 0 && this.isMutedSubject.value) {
      this.isMutedSubject.next(false);
      this.audio.muted = false;
    }
  }

  public toggleMute(): void {
    const muted = !this.isMutedSubject.value;
    this.audio.muted = muted;
    this.isMutedSubject.next(muted);
  }

  public async setAudioOutputDevice(sinkId: string): Promise<boolean> {
    if ('setSinkId' in this.audio && typeof (this.audio as any).setSinkId === 'function') {
      try {
        await (this.audio as any).setSinkId(sinkId);
        return true;
      } catch (err) {
        console.warn('Failed to set audio sink ID:', err);
        return false;
      }
    }
    return false;
  }

  public destroy(): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
    }
    this.audio.pause();
    this.audio.src = '';
  }
}
