import { Injectable } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { BehaviorSubject, Subject, Observable } from 'rxjs';
import { Participant } from '../models/participant.model';
import { RoomState } from '../models/room-state.model';
import { PlaybackState } from '../models/playback-state.model';
import { Track } from '../models/track.model';
import { getApiBaseUrl } from './api-config';

export type HubConnectionStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

@Injectable({
  providedIn: 'root'
})
export class SignalRService {
  private hubConnection: signalR.HubConnection | null = null;
  private get hubUrl(): string {
    return `${getApiBaseUrl()}/hubs/room`;
  }

  private clockOffset = 0; // serverTime - clientTime
  private rtt = 0; // Round trip time in ms

  private readonly connectionStatusSubject = new BehaviorSubject<HubConnectionStatus>('disconnected');
  public readonly connectionStatus$: Observable<HubConnectionStatus> = this.connectionStatusSubject.asObservable();

  private readonly userJoinedSubject = new Subject<Participant>();
  public readonly userJoined$: Observable<Participant> = this.userJoinedSubject.asObservable();

  private readonly userLeftSubject = new Subject<{ username: string; connectionId: string }>();
  public readonly userLeft$: Observable<{ username: string; connectionId: string }> = this.userLeftSubject.asObservable();

  private readonly roomStateUpdatedSubject = new Subject<RoomState>();
  public readonly roomStateUpdated$: Observable<RoomState> = this.roomStateUpdatedSubject.asObservable();

  private readonly playbackStateChangedSubject = new Subject<PlaybackState>();
  public readonly playbackStateChanged$: Observable<PlaybackState> = this.playbackStateChangedSubject.asObservable();

  private readonly trackChangedSubject = new Subject<{ track: Track; state: PlaybackState }>();
  public readonly trackChanged$: Observable<{ track: Track; state: PlaybackState }> = this.trackChangedSubject.asObservable();

  private readonly seekChangedSubject = new Subject<{ position: number; serverTimestamp: number }>();
  public readonly seekChanged$: Observable<{ position: number; serverTimestamp: number }> = this.seekChangedSubject.asObservable();

  private readonly hostChangedSubject = new Subject<{ username: string; connectionId: string }>();
  public readonly hostChanged$: Observable<{ username: string; connectionId: string }> = this.hostChangedSubject.asObservable();

  public get estimatedServerTime(): number {
    return Date.now() + this.clockOffset;
  }

  public get currentLatency(): number {
    return Math.round(this.rtt / 2);
  }

  public get isConnected(): boolean {
    return this.hubConnection?.state === signalR.HubConnectionState.Connected;
  }

  public async startConnection(): Promise<void> {
    if (this.hubConnection && this.hubConnection.state === signalR.HubConnectionState.Connected) {
      return;
    }

    if (this.hubConnection) {
      try {
        await this.hubConnection.stop();
      } catch {
        // ignore
      }
    }

    this.connectionStatusSubject.next('connecting');

    this.hubConnection = new signalR.HubConnectionBuilder()
      .withUrl(this.hubUrl, {
        skipNegotiation: false,
        transport: signalR.HttpTransportType.WebSockets | signalR.HttpTransportType.LongPolling
      })
      .withAutomaticReconnect([0, 1000, 2000, 5000, 10000])
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    this.registerServerEventHandlers();

    try {
      await this.hubConnection.start();
      this.connectionStatusSubject.next('connected');
      await this.calibrateClock();
    } catch (err) {
      this.connectionStatusSubject.next('disconnected');
      throw err;
    }
  }

  private registerServerEventHandlers(): void {
    if (!this.hubConnection) return;

    this.hubConnection.onreconnecting(() => {
      this.connectionStatusSubject.next('reconnecting');
    });

    this.hubConnection.onreconnected(async () => {
      this.connectionStatusSubject.next('connected');
      await this.calibrateClock();
    });

    this.hubConnection.onclose(() => {
      this.connectionStatusSubject.next('disconnected');
    });

    this.hubConnection.on('UserJoined', (participant: Participant) => {
      this.userJoinedSubject.next(participant);
    });

    this.hubConnection.on('UserLeft', (username: string, connectionId: string) => {
      this.userLeftSubject.next({ username, connectionId });
    });

    this.hubConnection.on('RoomStateUpdated', (state: RoomState) => {
      this.roomStateUpdatedSubject.next(state);
    });

    this.hubConnection.on('PlaybackStateChanged', (state: PlaybackState) => {
      this.playbackStateChangedSubject.next(state);
    });

    this.hubConnection.on('TrackChanged', (track: Track, state: PlaybackState) => {
      this.trackChangedSubject.next({ track, state });
    });

    this.hubConnection.on('SeekChanged', (position: number, serverTimestamp: number) => {
      this.seekChangedSubject.next({ position, serverTimestamp });
    });

    this.hubConnection.on('HostChanged', (username: string, connectionId: string) => {
      this.hostChangedSubject.next({ username, connectionId });
    });
  }

  public async calibrateClock(): Promise<void> {
    if (!this.isConnected) return;

    try {
      const samples: Array<{ rtt: number; offset: number }> = [];
      for (let i = 0; i < 3; i++) {
        const start = Date.now();
        const serverTimestamp = await this.hubConnection!.invoke<number>('GetServerTime');
        const end = Date.now();
        const roundTrip = end - start;
        const offset = serverTimestamp - (start + roundTrip / 2);
        samples.push({ rtt: roundTrip, offset });
      }

      // Pick sample with lowest RTT for best precision
      samples.sort((a, b) => a.rtt - b.rtt);
      this.rtt = samples[0].rtt;
      this.clockOffset = samples[0].offset;
    } catch (e) {
      console.warn('Clock calibration error:', e);
    }
  }

  public async joinRoom(roomCode: string, username: string): Promise<RoomState> {
    await this.startConnection();
    return await this.hubConnection!.invoke<RoomState>('JoinRoom', roomCode, username);
  }

  public async leaveRoom(roomCode: string): Promise<void> {
    if (!this.isConnected) return;
    try {
      await this.hubConnection!.invoke('LeaveRoom', roomCode);
    } catch (e) {
      console.warn('Error leaving room:', e);
    }
  }

  public async play(roomCode: string, position: number, trackId?: number): Promise<void> {
    if (!this.isConnected) return;
    await this.hubConnection!.invoke('Play', roomCode, position, trackId ?? null);
  }

  public async pause(roomCode: string, position: number, trackId?: number): Promise<void> {
    if (!this.isConnected) return;
    await this.hubConnection!.invoke('Pause', roomCode, position, trackId ?? null);
  }

  public async seek(roomCode: string, position: number, trackId?: number): Promise<void> {
    if (!this.isConnected) return;
    await this.hubConnection!.invoke('Seek', roomCode, position, trackId ?? null);
  }

  public async changeTrack(roomCode: string, trackId: number): Promise<void> {
    if (!this.isConnected) return;
    await this.hubConnection!.invoke('ChangeTrack', roomCode, trackId);
  }

  public async stop(): Promise<void> {
    if (this.hubConnection) {
      try {
        await this.hubConnection.stop();
      } catch {
        // ignore
      }
      this.hubConnection = null;
      this.connectionStatusSubject.next('disconnected');
    }
  }
}
