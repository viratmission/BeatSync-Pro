import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RoomService } from '../../core/services/room.service';
import { SignalRService, HubConnectionStatus } from '../../core/services/signalr.service';
import { AudioService, SyncStatus } from '../../core/services/audio.service';
import { AudioDeviceService, AudioOutputDevice } from '../../core/services/audio-device.service';
import { UserService } from '../../core/services/user.service';
import { ToastService } from '../../core/services/toast.service';
import { HeaderComponent } from '../../shared/components/header/header.component';
import { FooterComponent } from '../../shared/components/footer/footer.component';
import { Room } from '../../core/models/room.model';
import { Participant } from '../../core/models/participant.model';
import { Track } from '../../core/models/track.model';
import { PlaybackState } from '../../core/models/playback-state.model';

@Component({
  selector: 'app-room',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent, FooterComponent],
  template: `
    <div class="page-layout">
      <app-header
        [roomCode]="roomCode"
        [connectionState]="connectionStatus"
        (leave)="leaveRoom()"
      ></app-header>

      <!-- Autoplay Policy Notice Banner -->
      @if (autoplayBlocked) {
        <div class="autoplay-banner" (click)="enableAudio()">
          <div class="banner-content">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
            <span>Audio playback is waiting for user permission. <strong>Click anywhere to enable audio</strong>.</span>
          </div>
          <button class="banner-btn" (click)="enableAudio(); $event.stopPropagation()">Enable Sound</button>
        </div>
      }

      <main class="room-main">
        <div class="room-container">
          <!-- LEFT / CENTER: Audio Player Card -->
          <section class="player-section">
            <div class="player-card">
              <!-- Player Header / Role Indicator -->
              <div class="player-header">
                <div class="role-badge" [ngClass]="isHost ? 'host-role' : 'listener-role'">
                  @if (isHost) {
                    <span class="role-icon">👑</span>
                    <span>You are the Host (Master Controls)</span>
                  } @else {
                    <span class="role-icon">🎧</span>
                    <span>Listening in sync with {{ hostParticipant?.username || 'Host' }}</span>
                  }
                </div>

                <div class="sync-indicator" [title]="'Clock drift: ' + syncStatus.driftMs + 'ms'">
                  <span class="sync-dot" [ngClass]="{'synced': syncStatus.isSynced, 'adjusting': syncStatus.rateAdjusted}"></span>
                  <span class="sync-text">
                    @if (syncStatus.rateAdjusted) {
                      Aligning ({{ syncStatus.driftMs > 0 ? '+' : '' }}{{ syncStatus.driftMs }}ms)
                    } @else {
                      Synced ({{ syncStatus.driftMs }}ms)
                    }
                  </span>
                </div>
              </div>

              <!-- Artwork & Vinyl Visualizer -->
              <div class="visualizer-wrapper">
                <div class="disc-container" [ngClass]="{'spinning': isPlaying}">
                  @if (currentTrack?.artworkUrl) {
                    <img [src]="getArtworkUrl(currentTrack!.artworkUrl!)" [alt]="currentTrack?.title" class="artwork-img" />
                  } @else {
                    <div class="artwork-fallback">
                      <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="#94a3b8" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10" />
                        <circle cx="12" cy="12" r="3" />
                        <line x1="12" y1="2" x2="12" y2="5" />
                      </svg>
                    </div>
                  }
                  <div class="vinyl-hole"></div>
                </div>

                <div class="track-details">
                  <h2 class="track-title">{{ currentTrack?.title || 'No track selected' }}</h2>
                  <p class="track-artist">{{ currentTrack?.artist || 'Unknown artist' }}</p>
                </div>
              </div>

              <!-- Progress Bar -->
              <div class="progress-section">
                <div
                  class="progress-bar-container"
                  [ngClass]="{'interactive': isHost}"
                  (click)="onProgressBarClick($event)"
                  #progressBar
                >
                  <div class="progress-fill" [style.width.%]="progressPercent"></div>
                  @if (isHost) {
                    <div class="progress-thumb" [style.left.%]="progressPercent"></div>
                  }
                </div>
                <div class="time-labels">
                  <span class="time-text">{{ formatTime(currentTime) }}</span>
                  <span class="time-text">{{ formatTime(duration) }}</span>
                </div>
              </div>

              <!-- Master Playback Controls (Host vs Non-Host) -->
              <div class="playback-controls">
                <button
                  class="control-btn"
                  [disabled]="!isHost || availableTracks.length <= 1"
                  (click)="previousTrack()"
                  title="Previous Track"
                  aria-label="Previous track"
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <polygon points="19 20 9 12 19 4 19 20" />
                    <line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" stroke-width="2" />
                  </svg>
                </button>

                <button
                  class="play-pause-btn"
                  [disabled]="!isHost"
                  (click)="togglePlayPause()"
                  [title]="isHost ? (isPlaying ? 'Pause' : 'Play') : 'Only host can control playback'"
                  [attr.aria-label]="isPlaying ? 'Pause' : 'Play'"
                >
                  @if (isPlaying) {
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                      <rect x="6" y="4" width="4" height="16" rx="1" />
                      <rect x="14" y="4" width="4" height="16" rx="1" />
                    </svg>
                  } @else {
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  }
                </button>

                <button
                  class="control-btn"
                  [disabled]="!isHost || availableTracks.length <= 1"
                  (click)="nextTrack()"
                  title="Next Track"
                  aria-label="Next track"
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <polygon points="5 4 15 12 5 20 5 4" />
                    <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2" />
                  </svg>
                </button>
              </div>

              <!-- Track Selection Dropdown & Local Options -->
              <div class="track-selector-row">
                <div class="selector-col">
                  <label class="section-label">Select Track</label>
                  <select
                    class="track-select"
                    [disabled]="!isHost"
                    [ngModel]="currentTrack?.id"
                    (ngModelChange)="onTrackSelect($event)"
                    title="Select audio track"
                  >
                    @for (track of availableTracks; track track.id) {
                      <option [value]="track.id">{{ track.title }} - {{ track.artist }}</option>
                    }
                  </select>
                </div>

                @if (isHost) {
                  <div class="upload-col">
                    <label class="section-label">Upload Custom Audio</label>
                    <label class="btn-upload">
                      <input type="file" accept="audio/*" (change)="onFileUpload($event)" hidden />
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      <span>Upload Track</span>
                    </label>
                  </div>
                }
              </div>

              <!-- Local Volume & Audio Device Controls -->
              <div class="local-settings-row">
                <!-- Local Volume Slider (Each client controls audio.volume locally) -->
                <div class="volume-control">
                  <button class="vol-btn" (click)="toggleMute()" [title]="isMuted ? 'Unmute' : 'Mute'">
                    @if (isMuted || volume === 0) {
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <line x1="23" y1="9" x2="17" y2="15" />
                        <line x1="17" y1="9" x2="23" y2="15" />
                      </svg>
                    } @else if (volume < 50) {
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      </svg>
                    } @else {
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                      </svg>
                    }
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    [value]="isMuted ? 0 : volume"
                    (input)="onVolumeChange($event)"
                    class="volume-slider"
                    aria-label="Local device volume"
                  />
                  <span class="vol-percent">{{ isMuted ? 0 : volume }}%</span>
                </div>

                <!-- Phase 11: Audio Output Device / Native Speakers -->
                @if (isSinkIdSupported && outputDevices.length > 0) {
                  <div class="device-selector">
                    <label class="device-label">Output:</label>
                    <select
                      class="device-select"
                      [ngModel]="selectedDeviceId"
                      (ngModelChange)="onOutputDeviceChange($event)"
                    >
                      @for (dev of outputDevices; track dev.deviceId) {
                        <option [value]="dev.deviceId">{{ dev.label }}</option>
                      }
                    </select>
                  </div>
                }
              </div>
            </div>
          </section>

          <!-- RIGHT: Participants Panel -->
          <aside class="participants-section">
            <div class="participants-card">
              <div class="card-header">
                <div class="header-left">
                  <h3>Participants</h3>
                  <span class="count-badge">{{ participants.length }}</span>
                </div>
                <button class="invite-btn" (click)="copyInviteLink()" title="Copy room link">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  <span>Share</span>
                </button>
              </div>

              <div class="participants-list">
                @for (user of participants; track user.id || user.username) {
                  <div class="participant-item" [ngClass]="{'is-self': user.username === currentUsername}">
                    <div class="user-avatar" [style.background-color]="getAvatarColor(user.username)">
                      {{ getInitials(user.username) }}
                    </div>
                    <div class="user-meta">
                      <div class="user-name-row">
                        <span class="user-name">{{ user.username }}</span>
                        @if (user.username === currentUsername) {
                          <span class="self-badge">You</span>
                        }
                      </div>
                      <span class="user-status-text">
                        <span class="status-dot online"></span>
                        Connected
                      </span>
                    </div>
                    @if (user.isHost) {
                      <div class="host-pill">HOST</div>
                    }
                  </div>
                }
              </div>

              <!-- Room info footer inside panel -->
              <div class="room-info-footer">
                <span class="info-label">Room Code:</span>
                <span class="info-code">{{ roomCode }}</span>
              </div>
            </div>
          </aside>
        </div>
      </main>

      <app-footer></app-footer>
    </div>
  `,
  styles: [`
    .page-layout {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      background: #f8fafc;
    }
    .autoplay-banner {
      background: #3b82f6;
      color: #ffffff;
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      cursor: pointer;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    .banner-content {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 14px;
    }
    .banner-btn {
      padding: 6px 14px;
      background: #ffffff;
      color: #1d4ed8;
      border: none;
      border-radius: 6px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
    }
    .room-main {
      flex: 1;
      padding: 32px 24px;
      max-width: 1200px;
      width: 100%;
      margin: 0 auto;
    }
    .room-container {
      display: grid;
      grid-template-columns: 1fr 340px;
      gap: 24px;
      align-items: start;
    }
    .player-card, .participants-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.05), 0 2px 6px -1px rgba(0, 0, 0, 0.03);
      padding: 28px;
    }
    .player-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
      flex-wrap: wrap;
      gap: 10px;
    }
    .role-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
    }
    .role-badge.host-role {
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fde68a;
    }
    .role-badge.listener-role {
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #e2e8f0;
    }
    .sync-indicator {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #64748b;
      font-weight: 500;
    }
    .sync-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #cbd5e1;
    }
    .sync-dot.synced {
      background: #10b981;
    }
    .sync-dot.adjusting {
      background: #f59e0b;
    }
    .visualizer-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      margin: 16px 0 28px 0;
      text-align: center;
    }
    .disc-container {
      width: 180px;
      height: 180px;
      border-radius: 50%;
      background: #0f172a;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2);
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 6px solid #1e293b;
      margin-bottom: 20px;
      transition: transform 0.2s ease;
    }
    .disc-container.spinning {
      animation: spinDisc 8s linear infinite;
    }
    @keyframes spinDisc {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .artwork-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .artwork-fallback {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .vinyl-hole {
      position: absolute;
      width: 28px;
      height: 28px;
      background: #ffffff;
      border: 4px solid #0f172a;
      border-radius: 50%;
      z-index: 2;
    }
    .track-title {
      font-size: 22px;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 6px 0;
      letter-spacing: -0.01em;
    }
    .track-artist {
      font-size: 15px;
      color: #64748b;
      margin: 0;
    }
    .progress-section {
      margin-bottom: 24px;
    }
    .progress-bar-container {
      height: 8px;
      background: #e2e8f0;
      border-radius: 4px;
      position: relative;
      cursor: not-allowed;
    }
    .progress-bar-container.interactive {
      cursor: pointer;
    }
    .progress-fill {
      height: 100%;
      background: #0f172a;
      border-radius: 4px;
      transition: width 0.08s linear;
    }
    .progress-thumb {
      position: absolute;
      top: 50%;
      width: 14px;
      height: 14px;
      background: #0f172a;
      border: 2px solid #ffffff;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }
    .time-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      font-size: 12px;
      font-weight: 500;
      color: #64748b;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .playback-controls {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 20px;
      margin-bottom: 28px;
    }
    .control-btn {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      color: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .control-btn:hover:not(:disabled) {
      background: #e2e8f0;
    }
    .control-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .play-pause-btn {
      width: 58px;
      height: 58px;
      border-radius: 50%;
      background: #0f172a;
      color: #ffffff;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform 0.1s ease, background 0.15s ease;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.2);
    }
    .play-pause-btn:hover:not(:disabled) {
      background: #1e293b;
      transform: scale(1.04);
    }
    .play-pause-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
    .track-selector-row {
      display: flex;
      gap: 16px;
      padding-top: 16px;
      border-top: 1px solid #f1f5f9;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .selector-col {
      flex: 1;
      min-width: 200px;
    }
    .upload-col {
      display: flex;
      flex-direction: column;
    }
    .section-label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: #64748b;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .track-select {
      width: 100%;
      height: 40px;
      padding: 0 12px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      background: #ffffff;
      font-size: 14px;
      color: #0f172a;
      outline: none;
    }
    .btn-upload {
      height: 40px;
      padding: 0 14px;
      background: #ffffff;
      border: 1px dashed #94a3b8;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: #0f172a;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn-upload:hover {
      background: #f8fafc;
      border-color: #0f172a;
    }
    .local-settings-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding-top: 16px;
      border-top: 1px solid #f1f5f9;
      flex-wrap: wrap;
    }
    .volume-control {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      max-width: 240px;
    }
    .vol-btn {
      background: none;
      border: none;
      color: #64748b;
      cursor: pointer;
      display: flex;
      align-items: center;
      padding: 4px;
    }
    .vol-btn:hover {
      color: #0f172a;
    }
    .volume-slider {
      flex: 1;
      accent-color: #0f172a;
      cursor: pointer;
    }
    .vol-percent {
      font-size: 12px;
      color: #64748b;
      font-variant-numeric: tabular-nums;
      width: 32px;
    }
    .device-selector {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .device-label {
      font-size: 12px;
      color: #64748b;
      font-weight: 500;
    }
    .device-select {
      height: 32px;
      padding: 0 8px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      font-size: 12px;
      color: #0f172a;
      max-width: 180px;
    }
    .participants-card {
      padding: 24px;
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .header-left h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
    }
    .count-badge {
      background: #f1f5f9;
      color: #475569;
      font-size: 12px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 12px;
    }
    .invite-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      color: #0f172a;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .invite-btn:hover {
      background: #f8fafc;
    }
    .participants-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: 400px;
      overflow-y: auto;
    }
    .participant-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 10px;
      border-radius: 10px;
      background: #f8fafc;
      border: 1px solid #f1f5f9;
    }
    .participant-item.is-self {
      background: #f0fdf4;
      border-color: #dcfce7;
    }
    .user-avatar {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      color: #ffffff;
      font-size: 12px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .user-meta {
      flex: 1;
      min-width: 0;
    }
    .user-name-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .user-name {
      font-size: 13px;
      font-weight: 600;
      color: #0f172a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .self-badge {
      font-size: 10px;
      background: #dcfce7;
      color: #15803d;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 4px;
    }
    .user-status-text {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: #94a3b8;
    }
    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }
    .status-dot.online {
      background: #10b981;
    }
    .host-pill {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.05em;
      background: #0f172a;
      color: #ffffff;
      padding: 3px 7px;
      border-radius: 4px;
    }
    .room-info-footer {
      margin-top: 20px;
      padding-top: 14px;
      border-top: 1px solid #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
    }
    .info-label {
      color: #64748b;
    }
    .info-code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-weight: 700;
      color: #0f172a;
    }
    @media (max-width: 900px) {
      .room-container {
        grid-template-columns: 1fr;
      }
      .participants-section {
        order: 2;
      }
    }
  `]
})
export class RoomComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly roomService = inject(RoomService);
  private readonly signalRService = inject(SignalRService);
  private readonly audioService = inject(AudioService);
  private readonly audioDeviceService = inject(AudioDeviceService);
  private readonly userService = inject(UserService);
  private readonly toastService = inject(ToastService);

  roomCode = '';
  currentUsername = '';
  room: Room | null = null;
  participants: Participant[] = [];
  availableTracks: Track[] = [];
  currentTrack: Track | null = null;
  playbackState: PlaybackState = {
    trackId: 1,
    isPlaying: false,
    currentPosition: 0,
    serverTimestamp: Date.now(),
    playbackRate: 1.0
  };

  currentTime = 0;
  duration = 0;
  isPlaying = false;
  volume = 80;
  isMuted = false;
  autoplayBlocked = false;
  connectionStatus: HubConnectionStatus = 'connecting';
  syncStatus: SyncStatus = {
    driftMs: 0,
    isSynced: true,
    rateAdjusted: false,
    expectedPosition: 0,
    actualPosition: 0
  };

  outputDevices: AudioOutputDevice[] = [];
  selectedDeviceId = 'default';
  isSinkIdSupported = false;

  private subscriptions = new Subscription();

  ngOnInit(): void {
    this.currentUsername = this.userService.currentUsername;
    this.roomCode = this.route.snapshot.paramMap.get('roomCode')?.toUpperCase() || '';

    if (!this.roomCode || this.roomCode.length !== 6) {
      this.toastService.error('Invalid room code.');
      this.router.navigate(['/']);
      return;
    }

    this.initAudioSubscriptions();
    this.initSignalRSubscriptions();
    this.initAudioDeviceSubscriptions();
    this.connectAndJoin();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.signalRService.leaveRoom(this.roomCode);
    this.audioService.destroy();
  }

  get isHost(): boolean {
    const current = this.participants.find(p => p.username.toLowerCase() === this.currentUsername.toLowerCase());
    return current?.isHost ?? false;
  }

  get hostParticipant(): Participant | undefined {
    return this.participants.find(p => p.isHost);
  }

  get progressPercent(): number {
    if (!this.duration || this.duration === 0) return 0;
    return Math.min(100, Math.max(0, (this.currentTime / this.duration) * 100));
  }

  private initAudioSubscriptions(): void {
    this.subscriptions.add(
      this.audioService.currentTime$.subscribe(time => {
        this.currentTime = time;
      })
    );

    this.subscriptions.add(
      this.audioService.duration$.subscribe(dur => {
        this.duration = dur;
      })
    );

    this.subscriptions.add(
      this.audioService.isPlaying$.subscribe(playing => {
        this.isPlaying = playing;
      })
    );

    this.subscriptions.add(
      this.audioService.volume$.subscribe(vol => {
        this.volume = vol;
      })
    );

    this.subscriptions.add(
      this.audioService.isMuted$.subscribe(muted => {
        this.isMuted = muted;
      })
    );

    this.subscriptions.add(
      this.audioService.syncStatus$.subscribe(sync => {
        this.syncStatus = sync;
      })
    );

    this.subscriptions.add(
      this.audioService.autoplayBlocked$.subscribe(blocked => {
        this.autoplayBlocked = blocked;
      })
    );
  }

  private initSignalRSubscriptions(): void {
    this.subscriptions.add(
      this.signalRService.connectionStatus$.subscribe(status => {
        this.connectionStatus = status;
        if (status === 'disconnected') {
          this.toastService.warning('Disconnected from server. Retrying...');
        }
      })
    );

    this.subscriptions.add(
      this.signalRService.userJoined$.subscribe(participant => {
        if (!this.participants.some(p => p.username === participant.username)) {
          this.participants = [...this.participants, participant];
        }
        this.toastService.info(`${participant.username} joined the room.`);
      })
    );

    this.subscriptions.add(
      this.signalRService.userLeft$.subscribe(({ username }) => {
        this.participants = this.participants.filter(p => p.username !== username);
        this.toastService.info(`${username} left the room.`);
      })
    );

    this.subscriptions.add(
      this.signalRService.roomStateUpdated$.subscribe(state => {
        this.applyRoomState(state);
      })
    );

    this.subscriptions.add(
      this.signalRService.playbackStateChanged$.subscribe(state => {
        this.playbackState = state;
        this.audioService.syncPlayback(state);
      })
    );

    this.subscriptions.add(
      this.signalRService.trackChanged$.subscribe(({ track, state }) => {
        this.currentTrack = track;
        this.playbackState = state;
        this.audioService.loadTrack(track, true);
        this.toastService.info(`Track changed to "${track.title}"`);
      })
    );

    this.subscriptions.add(
      this.signalRService.hostChanged$.subscribe(({ username }) => {
        this.participants = this.participants.map(p => ({
          ...p,
          isHost: p.username === username
        }));
        if (username === this.currentUsername) {
          this.toastService.success('You are now the room host!');
        } else {
          this.toastService.info(`${username} is now the room host.`);
        }
      })
    );
  }

  private initAudioDeviceSubscriptions(): void {
    this.subscriptions.add(
      this.audioDeviceService.devices$.subscribe(devices => {
        this.outputDevices = devices;
      })
    );

    this.subscriptions.add(
      this.audioDeviceService.isSupported$.subscribe(supported => {
        this.isSinkIdSupported = supported;
      })
    );
  }

  private async connectAndJoin(): Promise<void> {
    try {
      const state = await this.signalRService.joinRoom(this.roomCode, this.currentUsername);
      this.applyRoomState(state);
      this.toastService.success(`Connected to room ${this.roomCode}!`);
    } catch (err: any) {
      console.error('Failed to join room:', err);
      this.toastService.error(err?.message || 'Failed to join room. Please check the code.');
      this.router.navigate(['/']);
    }
  }

  private applyRoomState(state: any): void {
    this.room = state.room;
    this.participants = state.participants;
    this.availableTracks = state.availableTracks || [];
    this.playbackState = state.playbackState;

    if (state.currentTrack) {
      this.currentTrack = state.currentTrack;
      this.audioService.loadTrack(state.currentTrack);
      if (this.playbackState?.isPlaying) {
        this.audioService.syncPlayback(this.playbackState);
      }
    }
  }

  // Master Playback controls (Host only)
  async togglePlayPause(): Promise<void> {
    if (!this.isHost) return;

    if (this.isPlaying) {
      await this.signalRService.pause(this.roomCode, this.currentTime);
    } else {
      await this.signalRService.play(this.roomCode, this.currentTime);
    }
  }

  async onProgressBarClick(event: MouseEvent): Promise<void> {
    if (!this.isHost || !this.duration) return;

    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickRatio = Math.max(0, Math.min(1, clickX / rect.width));
    const seekTime = clickRatio * this.duration;

    await this.signalRService.seek(this.roomCode, seekTime);
  }

  async previousTrack(): Promise<void> {
    if (!this.isHost || this.availableTracks.length <= 1) return;

    const currentIndex = this.availableTracks.findIndex(t => t.id === this.currentTrack?.id);
    const prevIndex = (currentIndex - 1 + this.availableTracks.length) % this.availableTracks.length;
    await this.signalRService.changeTrack(this.roomCode, this.availableTracks[prevIndex].id);
  }

  async nextTrack(): Promise<void> {
    if (!this.isHost || this.availableTracks.length <= 1) return;

    const currentIndex = this.availableTracks.findIndex(t => t.id === this.currentTrack?.id);
    const nextIndex = (currentIndex + 1) % this.availableTracks.length;
    await this.signalRService.changeTrack(this.roomCode, this.availableTracks[nextIndex].id);
  }

  async onTrackSelect(trackIdStr: any): Promise<void> {
    if (!this.isHost) return;
    const trackId = Number(trackIdStr);
    if (!isNaN(trackId) && trackId !== this.currentTrack?.id) {
      await this.signalRService.changeTrack(this.roomCode, trackId);
    }
  }

  async onFileUpload(event: Event): Promise<void> {
    if (!this.isHost) return;

    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const title = file.name.replace(/\.[^/.]+$/, '');
    const artist = this.currentUsername;

    this.toastService.info(`Uploading "${title}"...`);

    try {
      const track = await this.roomService.uploadTrack(file, title, artist).toPromise();
      if (track) {
        this.availableTracks = [...this.availableTracks, track];
        await this.signalRService.changeTrack(this.roomCode, track.id);
        this.toastService.success(`Uploaded and switched to "${track.title}"!`);
      }
    } catch (err: any) {
      this.toastService.error(err?.error?.message || 'Failed to upload audio file.');
    }
  }

  // Local volume controls
  onVolumeChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.audioService.setVolume(Number(input.value));
  }

  toggleMute(): void {
    this.audioService.toggleMute();
  }

  async onOutputDeviceChange(deviceId: string): Promise<void> {
    this.selectedDeviceId = deviceId;
    await this.audioService.setAudioOutputDevice(deviceId);
  }

  enableAudio(): void {
    this.audioService.userInteractedEnableAudio();
  }

  leaveRoom(): void {
    this.signalRService.leaveRoom(this.roomCode);
    this.router.navigate(['/']);
  }

  copyInviteLink(): void {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      this.toastService.success('Invite link copied to clipboard!');
    });
  }

  getArtworkUrl(url: string): string {
    return url.startsWith('http') ? url : `http://localhost:5000${url}`;
  }

  formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  getInitials(name: string): string {
    if (!name) return '?';
    const parts = name.split(/[-_\s]/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  getAvatarColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = [
      '#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4',
      '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#14b8a6'
    ];
    return colors[Math.abs(hash) % colors.length];
  }
}
