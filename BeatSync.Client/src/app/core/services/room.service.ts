import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Room, CreateRoomRequest, JoinRoomRequest } from '../models/room.model';
import { RoomState } from '../models/room-state.model';
import { Participant } from '../models/participant.model';
import { Track } from '../models/track.model';
import { getApiBaseUrl } from './api-config';

@Injectable({
  providedIn: 'root'
})
export class RoomService {
  private readonly http = inject(HttpClient);
  private get baseUrl(): string {
    return getApiBaseUrl();
  }

  getApiUrl(): string {
    return this.baseUrl;
  }

  getRoom(roomCode: string): Observable<Room> {
    return this.http.get<Room>(`${this.baseUrl}/api/rooms/${roomCode.toUpperCase()}`);
  }

  createRoom(request: CreateRoomRequest): Observable<Room> {
    return this.http.post<Room>(`${this.baseUrl}/api/rooms`, request);
  }

  joinRoom(roomCode: string, request: JoinRoomRequest): Observable<RoomState> {
    return this.http.post<RoomState>(`${this.baseUrl}/api/rooms/${roomCode.toUpperCase()}/join`, request);
  }

  getParticipants(roomCode: string): Observable<Participant[]> {
    return this.http.get<Participant[]>(`${this.baseUrl}/api/rooms/${roomCode.toUpperCase()}/participants`);
  }

  getTracks(): Observable<Track[]> {
    return this.http.get<Track[]>(`${this.baseUrl}/api/tracks`);
  }

  uploadTrack(file: File, title: string, artist: string, duration?: number): Observable<Track> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title);
    formData.append('artist', artist);
    if (duration) {
      formData.append('duration', duration.toString());
    }
    return this.http.post<Track>(`${this.baseUrl}/api/tracks/upload`, formData);
  }
}
