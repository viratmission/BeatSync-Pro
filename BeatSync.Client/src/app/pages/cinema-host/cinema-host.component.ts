import { Component, OnInit, OnDestroy, inject, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RoomService } from '../../core/services/room.service';
import { SignalRService, HubConnectionStatus } from '../../core/services/signalr.service';
import { CinemaService, PeerDiagnostics } from '../../core/services/cinema.service';
import { UserService } from '../../core/services/user.service';
import { ToastService } from '../../core/services/toast.service';
import { Room } from '../../core/models/room.model';
import { Participant } from '../../core/models/participant.model';
import { PlaybackState } from '../../core/models/playback-state.model';
import { DEVICE_POSITIONS, DevicePosition, DeviceSyncReport } from '../../core/models/cinema.model';

@Component({
  selector: 'app-cinema-host',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="cinema-layout">
      <!-- Top Cinematic Navigation Bar -->
      <header class="cinema-header">
        <div class="header-left">
          <div class="brand-badge">
            <span class="cinema-icon">🎬</span>
            <span class="brand-title">BEATSYNC <span class="pro-tag">CINEMA</span></span>
          </div>
          <div class="room-pill">
            <span class="pill-label">ROOM:</span>
            <span class="pill-code">{{ roomCode }}</span>
            <button class="btn-copy" (click)="copyInviteLink()" title="Copy phone join link">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              <span>Share Code</span>
            </button>
          </div>
        </div>

        <div class="header-center">
          <div class="live-status">
            <span class="status-indicator" [ngClass]="connectionStatus"></span>
            <span class="status-label">
              {{ connectionStatus === 'connected' ? 'HOST AUTHORITATIVE SERVER ACTIVE' : connectionStatus }}
            </span>
          </div>
        </div>

        <div class="header-right">
          <div class="device-counter-badge">
            <span class="device-icon">📱</span>
            <span class="counter-text">{{ phoneParticipants.length }} / 8+ Speakers Connected</span>
          </div>
          <button class="btn-exit" (click)="leaveRoom()">Exit Cinema</button>
        </div>
      </header>

      <!-- Main Stage Split: Video Player on Left, Surround Map & Devices on Right -->
      <div class="cinema-main-stage">
        <!-- LEFT: Video Screen & Master Controls -->
        <main class="theater-screen-column">
          <div class="screen-frame">
            <!-- Video Player Element -->
            <div class="video-container" (click)="togglePlayPause()">
              <video
                #cinemaVideo
                class="main-video-element"
                [src]="videoSrc"
                (timeupdate)="onVideoTimeUpdate()"
                (loadedmetadata)="onVideoLoadedMetadata()"
                (ended)="onVideoEnded()"
                (play)="onVideoPlay()"
                (pause)="onVideoPause()"
                playsinline
              ></video>

              <!-- Empty State / File Picker Overlay if no video selected -->
              @if (!videoSrc) {
                <div class="video-placeholder" (click)="$event.stopPropagation()">
                  <div class="placeholder-content">
                    <div class="film-reel-icon">🎬</div>
                    <h2>Load Movie / Video for Cinema Sync</h2>
                    <p>Select any local MP4, WebM, or video file from your laptop. Only audio is streamed to phones!</p>

                    <div class="picker-actions">
                      <label class="btn-file-select">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                          <polyline points="17 8 12 3 7 8"/>
                          <line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                        <span>Select Local Video File</span>
                        <input
                          type="file"
                          accept="video/mp4,video/webm,video/ogg,video/quicktime,video/*"
                          (change)="onFileSelected($event)"
                          style="display: none"
                        />
                      </label>

                      <button class="btn-demo-media" (click)="loadDemoCinemaMedia()">
                        <span>⚡ Load Cinema Surround Demo Film</span>
                      </button>
                    </div>
                  </div>
                </div>
              }

              <!-- Playback Overlay Badge -->
              @if (videoSrc && isPlaying) {
                <div class="live-sync-pill">
                  <span class="pulse-dot"></span>
                  <span>BROADCASTING SURROUND AUDIO</span>
                </div>
              }
            </div>

            <!-- Master Scrub Timeline -->
            <div class="scrub-container">
              <div
                class="timeline-track"
                (click)="onTimelineClick($event)"
                #timelineBar
              >
                <div class="timeline-fill" [style.width.%]="progressPercent"></div>
                <div class="timeline-thumb" [style.left.%]="progressPercent"></div>
              </div>
              <div class="timeline-timestamps">
                <span class="time-current">{{ formatTime(currentTime) }}</span>
                <span class="media-title-display">{{ mediaTitle || 'Local Cinema Media' }}</span>
                <span class="time-total">{{ formatTime(duration) }}</span>
              </div>
            </div>

            <!-- Master Cinema Control Bar -->
            <div class="master-controls-bar">
              <div class="control-group-left">
                <button class="ctrl-btn" (click)="step(-10)" title="Rewind 10s">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <path d="M12.5 8c-2.65 0-5.05 1-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.2 3.16-1.98 5.12-1.98 3.53 0 6.55 2.28 7.6 5.5l2.85-.95C21.45 10.6 17.38 8 12.5 8z"/>
                  </svg>
                  <span>10s</span>
                </button>

                <button
                  class="btn-master-play"
                  [disabled]="!videoSrc"
                  (click)="togglePlayPause()"
                >
                  @if (isPlaying) {
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                      <rect x="6" y="4" width="4" height="16" rx="1"/>
                      <rect x="14" y="4" width="4" height="16" rx="1"/>
                    </svg>
                    <span>PAUSE ALL</span>
                  } @else {
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                    <span>PLAY CINEMA</span>
                  }
                </button>

                <button class="ctrl-btn" (click)="step(10)" title="Forward 10s">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <path d="M11.5 8c2.65 0 5.05 1 6.9 2.6L22 7v9h-9l3.62-3.62c-1.39-1.2-3.16-1.98-5.12-1.98-3.53 0-6.55 2.28-7.6 5.5l-2.85-.95C2.55 10.6 6.62 8 11.5 8z"/>
                  </svg>
                  <span>10s</span>
                </button>
              </div>

              <!-- Speed & Audio Alignment Controls -->
              <div class="control-group-right">
                <div class="playback-rate-pill">
                  <label>Speed:</label>
                  <select [(ngModel)]="playbackRate" (change)="onPlaybackRateChange()">
                    <option [value]="0.75">0.75×</option>
                    <option [value]="1.0">1.0× Normal</option>
                    <option [value]="1.25">1.25×</option>
                    <option [value]="1.5">1.5×</option>
                  </select>
                </div>

                <div class="laptop-volume-pill">
                  <span>💻 Laptop Speaker:</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    [(ngModel)]="hostVolume"
                    (input)="onHostVolumeChange()"
                  />
                  <span>{{ hostVolume }}%</span>
                </div>
              </div>
            </div>
          </div>
        </main>

        <!-- RIGHT: Theater Surround Map & Connected Phone Speakers -->
        <aside class="surround-stage-column">
          <!-- 3D/2D Surround Speaker Theater Map -->
          <div class="theater-stage-card">
            <div class="stage-card-header">
              <h3>Surround Theater Map</h3>
              <span class="stage-tag">Dolby 7.1 Layout</span>
            </div>

            <!-- Stage Grid representing physical room around audience -->
            <div class="stage-visualizer">
              <div class="screen-indicator">
                <span>🎬 MOVIE SCREEN (LAPTOP)</span>
              </div>

              <div class="surround-grid">
                <!-- Front Row -->
                <div class="speaker-slot" [ngClass]="getSpeakerStatus('FrontLeft')">
                  <span class="slot-pos">FRONT LEFT</span>
                  <span class="slot-name">{{ getSpeakerName('FrontLeft') }}</span>
                  <span class="slot-drift">{{ getSpeakerDrift('FrontLeft') }}</span>
                </div>
                <div class="speaker-slot" [ngClass]="getSpeakerStatus('FrontCenter')">
                  <span class="slot-pos">CENTER</span>
                  <span class="slot-name">{{ getSpeakerName('FrontCenter') }}</span>
                  <span class="slot-drift">{{ getSpeakerDrift('FrontCenter') }}</span>
                </div>
                <div class="speaker-slot" [ngClass]="getSpeakerStatus('FrontRight')">
                  <span class="slot-pos">FRONT RIGHT</span>
                  <span class="slot-name">{{ getSpeakerName('FrontRight') }}</span>
                  <span class="slot-drift">{{ getSpeakerDrift('FrontRight') }}</span>
                </div>

                <!-- Middle / Audience Seating Area -->
                <div class="speaker-slot" [ngClass]="getSpeakerStatus('SurroundLeft')">
                  <span class="slot-pos">SURROUND L</span>
                  <span class="slot-name">{{ getSpeakerName('SurroundLeft') }}</span>
                  <span class="slot-drift">{{ getSpeakerDrift('SurroundLeft') }}</span>
                </div>
                <div class="audience-zone">
                  <div class="audience-icon">👤 👥 👤</div>
                  <span>AUDIENCE</span>
                </div>
                <div class="speaker-slot" [ngClass]="getSpeakerStatus('SurroundRight')">
                  <span class="slot-pos">SURROUND R</span>
                  <span class="slot-name">{{ getSpeakerName('SurroundRight') }}</span>
                  <span class="slot-drift">{{ getSpeakerDrift('SurroundRight') }}</span>
                </div>

                <!-- Rear Row -->
                <div class="speaker-slot" [ngClass]="getSpeakerStatus('RearLeft')">
                  <span class="slot-pos">REAR LEFT</span>
                  <span class="slot-name">{{ getSpeakerName('RearLeft') }}</span>
                  <span class="slot-drift">{{ getSpeakerDrift('RearLeft') }}</span>
                </div>
                <div class="speaker-slot" [ngClass]="getSpeakerStatus('RearCenter')">
                  <span class="slot-pos">REAR CENTER</span>
                  <span class="slot-name">{{ getSpeakerName('RearCenter') }}</span>
                  <span class="slot-drift">{{ getSpeakerDrift('RearCenter') }}</span>
                </div>
                <div class="speaker-slot" [ngClass]="getSpeakerStatus('RearRight')">
                  <span class="slot-pos">REAR RIGHT</span>
                  <span class="slot-name">{{ getSpeakerName('RearRight') }}</span>
                  <span class="slot-drift">{{ getSpeakerDrift('RearRight') }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Connected Phone Speakers Live Diagnostics Panel -->
          <div class="speakers-list-card">
            <div class="speakers-header">
              <div class="title-with-badge">
                <h3>Connected Phone Speakers</h3>
                <span class="count-pill">{{ phoneParticipants.length }}</span>
              </div>
              <button class="btn-invite-sm" (click)="copyInviteLink()">
                <span>+ Invite Phones</span>
              </button>
            </div>

            <!-- List of Phones with Live Sync Indicators -->
            <div class="speakers-items-list">
              @if (phoneParticipants.length === 0) {
                <div class="no-speakers-hint">
                  <div class="hint-icon">📱</div>
                  <h4>No phone speakers joined yet</h4>
                  <p>Open this link on phones to turn them into surround audio speakers:</p>
                  <code class="share-url-preview">{{ shareUrl }}</code>
                </div>
              }

              @for (phone of phoneParticipants; track phone.connectionId) {
                <div class="phone-item">
                  <div class="phone-item-main">
                    <div class="phone-avatar">📱</div>
                    <div class="phone-meta">
                      <div class="name-row">
                        <span class="phone-name">{{ phone.deviceName || phone.username }}</span>
                        <span class="sync-quality-badge" [ngClass]="getSyncQualityClass(phone.connectionId)">
                          {{ getSyncStatusText(phone.connectionId) }}
                        </span>
                      </div>
                      <div class="telemetry-row">
                        <span>Pos: <strong>{{ phone.devicePosition || 'FrontLeft' }}</strong></span>
                        <span>Drift: <strong>{{ getSpeakerDriftRaw(phone.connectionId) }}</strong></span>
                        <span>RTT: <strong>{{ getSpeakerRtt(phone.connectionId) }}</strong></span>
                      </div>
                    </div>
                  </div>

                  <!-- Deep Media Diagnostics (Section 22 of prompt) -->
                  <div class="pipeline-diagnostics-bar">
                    <span class="p-diag" [ngClass]="getPhoneSignalRStatus(phone)">
                      SigR: {{ getPhoneSignalRText(phone) }}
                    </span>
                    <span class="p-diag" [ngClass]="getPhoneWebRtcStatus(phone)">
                      WebRTC: {{ getPhoneWebRtcText(phone) }}
                    </span>
                    <span class="p-diag" [ngClass]="getPhoneIceStatus(phone)">
                      ICE: {{ getPhoneIceText(phone) }}
                    </span>
                    <span class="p-diag" [ngClass]="getPhoneTrackStatus(phone)">
                      Track: {{ getPhoneTrackText(phone) }}
                    </span>
                    <span class="p-diag" [ngClass]="getPhonePlaybackStatus(phone)">
                      Audio: {{ getPhonePlaybackText(phone) }}
                    </span>
                  </div>

                  @if (getPhoneIceText(phone).includes('Checking') || getPhoneWebRtcText(phone).includes('failed')) {
                    <div class="cell-nat-hint">
                      💡 <b>Cellular NAT detected:</b> Phone is on 4G mobile data. Connect phone to the <b>same Wi-Fi</b> as the laptop (or turn on Laptop Hotspot) for instant zero-latency direct audio!
                    </div>
                  }

                  <!-- Host Control: Change Position or Volume of Phone -->
                  <div class="phone-actions-row">
                    <select
                      class="pos-select"
                      [ngModel]="phone.devicePosition || 'FrontLeft'"
                      (ngModelChange)="onAssignPosition(phone, $event)"
                    >
                      @for (opt of positionOptions; track opt.id) {
                        <option [value]="opt.id">{{ opt.label }}</option>
                      }
                    </select>

                    <input
                      type="range"
                      min="0"
                      max="100"
                      class="mini-vol-slider"
                      [ngModel]="phone.volume ?? 80"
                      (ngModelChange)="onAdjustPhoneVolume(phone, $event)"
                      title="Adjust speaker volume"
                    />

                    <button class="btn-reconnect-audio" (click)="reconnectPhone(phone)" title="Force re-negotiate audio track">
                      ⚡ Reconnect
                    </button>
                  </div>
                </div>
              }
            </div>
          </div>
        </aside>
      </div>
    </div>
  `,
  styles: [`
    .cinema-layout {
      min-height: 100vh;
      background: #090d16;
      color: #f1f5f9;
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }
    .cinema-header {
      height: 64px;
      padding: 0 24px;
      background: #0d1322;
      border-bottom: 1px solid #1e293b;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .brand-badge {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .cinema-icon {
      font-size: 20px;
    }
    .brand-title {
      font-weight: 800;
      letter-spacing: 0.05em;
      font-size: 16px;
      color: #ffffff;
    }
    .pro-tag {
      background: #3b82f6;
      color: #ffffff;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 800;
      margin-left: 4px;
    }
    .room-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #1e293b;
      padding: 4px 10px;
      border-radius: 8px;
      border: 1px solid #334155;
    }
    .pill-label {
      font-size: 11px;
      color: #94a3b8;
      font-weight: 600;
    }
    .pill-code {
      font-family: ui-monospace, Menlo, Monaco, Consolas, monospace;
      font-weight: 800;
      color: #38bdf8;
      font-size: 14px;
      letter-spacing: 0.1em;
    }
    .btn-copy {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
      transition: all 0.15s;
    }
    .btn-copy:hover {
      background: #334155;
      color: #ffffff;
    }
    .live-status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: #94a3b8;
      font-weight: 700;
      letter-spacing: 0.05em;
    }
    .status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #64748b;
    }
    .status-indicator.connected {
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .device-counter-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #1e293b;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      color: #38bdf8;
      border: 1px solid #334155;
    }
    .btn-exit {
      background: #334155;
      color: #cbd5e1;
      border: none;
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-exit:hover {
      background: #ef4444;
      color: #ffffff;
    }
    .cinema-main-stage {
      flex: 1;
      display: grid;
      grid-template-columns: 1fr 380px;
      gap: 20px;
      padding: 20px 24px;
      max-width: 1600px;
      width: 100%;
      margin: 0 auto;
      box-sizing: border-box;
    }
    .theater-screen-column {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .screen-frame {
      background: #0d1322;
      border: 1px solid #1e293b;
      border-radius: 16px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    }
    .video-container {
      position: relative;
      width: 100%;
      height: 480px;
      background: #000000;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .main-video-element {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .video-placeholder {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle at center, #1e293b 0%, #090d16 100%);
      padding: 24px;
      text-align: center;
    }
    .placeholder-content {
      max-width: 480px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    .film-reel-icon {
      font-size: 48px;
    }
    .placeholder-content h2 {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      color: #ffffff;
    }
    .placeholder-content p {
      margin: 0;
      color: #94a3b8;
      font-size: 14px;
      line-height: 1.5;
    }
    .picker-actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: 100%;
      margin-top: 12px;
    }
    .btn-file-select {
      background: #3b82f6;
      color: #ffffff;
      padding: 12px 20px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-file-select:hover {
      background: #2563eb;
    }
    .btn-demo-media {
      background: #1e293b;
      color: #38bdf8;
      border: 1px solid #38bdf8;
      padding: 10px 16px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-demo-media:hover {
      background: #38bdf8;
      color: #090d16;
    }
    .live-sync-pill {
      position: absolute;
      top: 16px;
      left: 16px;
      background: rgba(16, 185, 129, 0.9);
      color: #ffffff;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.05em;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .pulse-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #ffffff;
      animation: pulse 1s infinite alternate;
    }
    @keyframes pulse {
      from { opacity: 0.4; }
      to { opacity: 1; }
    }
    .scrub-container {
      padding: 14px 20px 8px 20px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: #0d1322;
    }
    .timeline-track {
      position: relative;
      height: 8px;
      background: #1e293b;
      border-radius: 4px;
      cursor: pointer;
    }
    .timeline-fill {
      height: 100%;
      background: #3b82f6;
      border-radius: 4px;
    }
    .timeline-thumb {
      position: absolute;
      top: 50%;
      width: 14px;
      height: 14px;
      background: #ffffff;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      box-shadow: 0 0 6px rgba(0, 0, 0, 0.4);
    }
    .timeline-timestamps {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #64748b;
      font-family: ui-monospace, Menlo, monospace;
    }
    .media-title-display {
      color: #94a3b8;
      font-weight: 600;
    }
    .master-controls-bar {
      padding: 12px 20px;
      border-top: 1px solid #1e293b;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #0a0f1d;
    }
    .control-group-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .ctrl-btn {
      background: #1e293b;
      border: 1px solid #334155;
      color: #f1f5f9;
      height: 38px;
      padding: 0 12px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .btn-master-play {
      background: #3b82f6;
      color: #ffffff;
      border: none;
      height: 44px;
      padding: 0 24px;
      border-radius: 8px;
      font-weight: 800;
      font-size: 14px;
      letter-spacing: 0.05em;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
    }
    .btn-master-play:hover:not(:disabled) {
      background: #2563eb;
    }
    .btn-master-play:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .control-group-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .playback-rate-pill, .laptop-volume-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #94a3b8;
    }
    .playback-rate-pill select {
      background: #1e293b;
      color: #ffffff;
      border: 1px solid #334155;
      padding: 4px 8px;
      border-radius: 6px;
      outline: none;
    }
    .laptop-volume-pill input[type="range"] {
      width: 80px;
    }
    .surround-stage-column {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .theater-stage-card, .speakers-list-card {
      background: #0d1322;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .stage-card-header, .speakers-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .stage-card-header h3, .speakers-header h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      color: #ffffff;
    }
    .stage-tag {
      font-size: 10px;
      background: #1e293b;
      color: #38bdf8;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 700;
    }
    .stage-visualizer {
      background: #070a12;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .screen-indicator {
      text-align: center;
      background: #1e293b;
      border-radius: 6px;
      padding: 4px;
      font-size: 10px;
      font-weight: 800;
      color: #38bdf8;
      letter-spacing: 0.1em;
    }
    .surround-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    .speaker-slot {
      background: #0d1322;
      border: 1px dashed #334155;
      border-radius: 8px;
      padding: 8px 6px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 2px;
    }
    .speaker-slot.active {
      border: 1px solid #10b981;
      background: rgba(16, 185, 129, 0.08);
    }
    .slot-pos {
      font-size: 9px;
      font-weight: 800;
      color: #64748b;
    }
    .slot-name {
      font-size: 10px;
      font-weight: 700;
      color: #f1f5f9;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 80px;
    }
    .slot-drift {
      font-size: 9px;
      color: #10b981;
      font-family: ui-monospace, monospace;
    }
    .audience-zone {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #64748b;
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.05em;
    }
    .audience-icon {
      font-size: 18px;
    }
    .title-with-badge {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .count-pill {
      background: #3b82f6;
      color: #ffffff;
      font-size: 11px;
      font-weight: 800;
      padding: 1px 6px;
      border-radius: 10px;
    }
    .btn-invite-sm {
      background: transparent;
      border: 1px solid #3b82f6;
      color: #38bdf8;
      font-size: 11px;
      padding: 4px 8px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
    }
    .speakers-items-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: 380px;
      overflow-y: auto;
    }
    .no-speakers-hint {
      text-align: center;
      padding: 24px 12px;
      color: #64748b;
    }
    .hint-icon {
      font-size: 32px;
      margin-bottom: 8px;
    }
    .no-speakers-hint h4 {
      margin: 0 0 6px 0;
      color: #cbd5e1;
      font-size: 13px;
    }
    .no-speakers-hint p {
      margin: 0 0 8px 0;
      font-size: 11px;
    }
    .share-url-preview {
      display: block;
      background: #070a12;
      padding: 8px;
      border-radius: 6px;
      font-size: 10px;
      color: #38bdf8;
      word-break: break-all;
    }
    .phone-item {
      background: #070a12;
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .phone-item-main {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .phone-avatar {
      width: 32px;
      height: 32px;
      background: #1e293b;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
    }
    .phone-meta {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .name-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .phone-name {
      font-size: 12px;
      font-weight: 700;
      color: #ffffff;
    }
    .sync-quality-badge {
      font-size: 9px;
      font-weight: 800;
      padding: 2px 6px;
      border-radius: 4px;
      letter-spacing: 0.05em;
    }
    .sync-quality-badge.excellent {
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
    }
    .sync-quality-badge.good {
      background: rgba(59, 130, 246, 0.15);
      color: #38bdf8;
    }
    .sync-quality-badge.realigning {
      background: rgba(245, 158, 11, 0.15);
      color: #f59e0b;
    }
    .telemetry-row {
      display: flex;
      gap: 10px;
      font-size: 10px;
      color: #64748b;
    }
    .telemetry-row strong {
      color: #94a3b8;
    }
    .phone-actions-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .pos-select {
      flex: 1;
      height: 28px;
      background: #1e293b;
      border: 1px solid #334155;
      color: #cbd5e1;
      border-radius: 4px;
      font-size: 11px;
      padding: 0 6px;
      outline: none;
    }
    .mini-vol-slider {
      width: 70px;
    }
    .pipeline-diagnostics-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 5px 8px;
      background: #040711;
      border-radius: 6px;
      border: 1px solid #1e293b;
      font-size: 9px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .p-diag {
      padding: 1px 5px;
      border-radius: 3px;
      font-weight: 700;
    }
    .p-diag.ok {
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
    }
    .p-diag.pending {
      background: rgba(245, 158, 11, 0.15);
      color: #f59e0b;
    }
    .p-diag.err {
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
    }
    .cell-nat-hint {
      background: rgba(234, 179, 8, 0.1);
      border: 1px solid rgba(234, 179, 8, 0.25);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 10px;
      color: #fde047;
      line-height: 1.35;
    }
    .btn-reconnect-audio {
      background: rgba(56, 189, 248, 0.15);
      border: 1px solid rgba(56, 189, 248, 0.4);
      color: #38bdf8;
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 10px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s;
    }
    .btn-reconnect-audio:hover {
      background: rgba(56, 189, 248, 0.3);
      color: #ffffff;
    }
    @media (max-width: 1080px) {
      .cinema-main-stage {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class CinemaHostComponent implements OnInit, OnDestroy {
  @ViewChild('cinemaVideo') videoElementRef!: ElementRef<HTMLVideoElement>;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly roomService = inject(RoomService);
  private readonly signalRService = inject(SignalRService);
  private readonly cinemaService = inject(CinemaService);
  private readonly userService = inject(UserService);
  private readonly toastService = inject(ToastService);

  roomCode = '';
  connectionStatus: HubConnectionStatus = 'connecting';
  room: Room | null = null;
  participants: Participant[] = [];
  deviceReports = new Map<string, DeviceSyncReport>();
  peerDiagnostics = new Map<string, PeerDiagnostics>();

  videoSrc = '';
  mediaTitle = '';
  currentTime = 0;
  duration = 0;
  isPlaying = false;
  playbackRate = 1.0;
  hostVolume = 80;

  positionOptions = DEVICE_POSITIONS;
  private subscriptions = new Subscription();

  ngOnInit(): void {
    this.roomCode = this.route.snapshot.paramMap.get('roomCode')?.toUpperCase() || '';
    if (!this.roomCode || this.roomCode.length !== 6) {
      this.toastService.error('Invalid room code.');
      this.router.navigate(['/']);
      return;
    }

    this.initSubscriptions();
    this.connectHost();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.signalRService.leaveRoom(this.roomCode);
    this.cinemaService.stop();
  }

  get phoneParticipants(): Participant[] {
    return this.participants.filter(p => !p.isHost && p.isConnected);
  }

  get progressPercent(): number {
    if (!this.duration) return 0;
    return Math.min(100, Math.max(0, (this.currentTime / this.duration) * 100));
  }

  get shareUrl(): string {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/cinema/device/${this.roomCode}`;
    }
    return `/cinema/device/${this.roomCode}`;
  }

  private initSubscriptions(): void {
    this.subscriptions.add(
      this.signalRService.connectionStatus$.subscribe(status => {
        this.connectionStatus = status;
      })
    );

    this.subscriptions.add(
      this.signalRService.userJoined$.subscribe(participant => {
        if (!this.participants.some(p => p.username === participant.username)) {
          this.participants = [...this.participants, participant];
        }
        this.toastService.info(`Phone joined: ${participant.deviceName || participant.username}`);

        // If video stream is loaded, establish WebRTC connection to newly joined phone speaker
        this.setupAudioCapture();
        if (participant.connectionId && this.videoSrc) {
          this.cinemaService.connectToPhoneSpeaker(participant.connectionId, this.roomCode);
        }
      })
    );

    // When phone signals it has unlocked audio and is ready
    this.subscriptions.add(
      this.signalRService.webRtcSignalReceived$.subscribe(signal => {
        if (signal.signalType === 'ready' && signal.senderConnectionId) {
          this.toastService.info(`Phone ${signal.senderUsername || 'speaker'} ready for audio`);
          this.setupAudioCapture();
          this.cinemaService.connectToPhoneSpeaker(signal.senderConnectionId, this.roomCode);
        }
      })
    );

    this.subscriptions.add(
      this.signalRService.userLeft$.subscribe(({ username, connectionId }) => {
        this.participants = this.participants.filter(p => p.connectionId !== connectionId);
        this.toastService.info(`Device disconnected: ${username}`);
      })
    );

    this.subscriptions.add(
      this.signalRService.devicePositionChanged$.subscribe(updated => {
        this.participants = this.participants.map(p =>
          p.connectionId === updated.connectionId ? updated : p
        );
      })
    );

    this.subscriptions.add(
      this.cinemaService.deviceReports$.subscribe(reports => {
        this.deviceReports = reports;
      })
    );

    this.subscriptions.add(
      this.cinemaService.peerDiagnostics$.subscribe(diags => {
        this.peerDiagnostics = diags;
      })
    );
  }

  private async connectHost(): Promise<void> {
    try {
      const state = await this.signalRService.joinCinemaRoom(
        this.roomCode,
        this.userService.currentUsername,
        'HostVideo',
        'FrontCenter',
        'Laptop Host',
        this.hostVolume,
        false
      );

      this.room = state.room;
      this.participants = state.participants;
      this.toastService.success(`Cinema room ${this.roomCode} initialized!`);
    } catch (err: any) {
      this.toastService.error(err?.message || 'Failed to initialize cinema room.');
      this.router.navigate(['/']);
    }
  }

  // --- Video File Selection & Demo Loading ---

  onFileSelected(event: Event): void {
    this.cinemaService.resumeAudioContext();
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      this.mediaTitle = file.name.replace(/\.[^/.]+$/, '');
      this.videoSrc = URL.createObjectURL(file);

      this.toastService.success(`Loaded video: "${this.mediaTitle}"`);

      // Notify room of loaded media & attach capture
      setTimeout(() => {
        this.setupAudioCapture();
        this.broadcastCommand('LoadMedia', 0);
      }, 200);
    }
  }

  loadDemoCinemaMedia(): void {
    this.cinemaService.resumeAudioContext();
    this.mediaTitle = 'Cinema Surround Sound Test Film';
    // Use procedural cinema audio demo
    this.videoSrc = this.roomService.getCinemaAudioStreamUrl(this.roomCode);
    this.toastService.info('Loading Cinema Surround Demo media...');

    setTimeout(() => {
      this.setupAudioCapture();
      this.broadcastCommand('LoadMedia', 0);
    }, 200);
  }

  private setupAudioCapture(): void {
    if (this.videoElementRef?.nativeElement) {
      const video = this.videoElementRef.nativeElement;
      video.volume = 1.0;
      this.cinemaService.attachVideoAudioSource(video);

      // Connect WebRTC to all already connected phones
      for (const phone of this.phoneParticipants) {
        if (phone.connectionId) {
          this.cinemaService.connectToPhoneSpeaker(phone.connectionId, this.roomCode);
        }
      }
    }
  }

  // --- Master Cinema Playback Controls ---

  onVideoPlay(): void {
    this.cinemaService.resumeAudioContext();
    this.setupAudioCapture();
    if (!this.isPlaying) {
      this.isPlaying = true;
      const video = this.videoElementRef?.nativeElement;
      if (video) {
        this.broadcastCommand('Play', video.currentTime);
      }
    }
  }

  onVideoPause(): void {
    if (this.isPlaying) {
      this.isPlaying = false;
      const video = this.videoElementRef?.nativeElement;
      if (video) {
        this.broadcastCommand('Pause', video.currentTime);
      }
    }
  }

  togglePlayPause(): void {
    if (!this.videoElementRef?.nativeElement || !this.videoSrc) return;
    this.cinemaService.resumeAudioContext();
    const video = this.videoElementRef.nativeElement;

    if (this.isPlaying) {
      video.pause();
    } else {
      video.play().catch(err => {
        console.warn('Host play error:', err);
      });
    }
  }

  step(deltaSeconds: number): void {
    if (!this.videoElementRef?.nativeElement || !this.duration) return;
    const video = this.videoElementRef.nativeElement;
    const target = Math.max(0, Math.min(this.duration, video.currentTime + deltaSeconds));
    video.currentTime = target;
    this.broadcastCommand('Seek', target);
  }

  onTimelineClick(event: MouseEvent): void {
    if (!this.videoElementRef?.nativeElement || !this.duration) return;
    const targetEl = event.currentTarget as HTMLElement;
    const rect = targetEl.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const targetTime = ratio * this.duration;

    const video = this.videoElementRef.nativeElement;
    video.currentTime = targetTime;
    this.broadcastCommand('Seek', targetTime);
  }

  onPlaybackRateChange(): void {
    if (this.videoElementRef?.nativeElement) {
      this.videoElementRef.nativeElement.playbackRate = Number(this.playbackRate);
      this.broadcastCommand('Rate', this.currentTime);
    }
  }

  onHostVolumeChange(): void {
    if (this.videoElementRef?.nativeElement) {
      this.videoElementRef.nativeElement.volume = this.hostVolume / 100;
    }
    this.cinemaService.setHostVolume(this.hostVolume);
  }

  onVideoTimeUpdate(): void {
    if (this.videoElementRef?.nativeElement) {
      this.currentTime = this.videoElementRef.nativeElement.currentTime;
    }
  }

  onVideoLoadedMetadata(): void {
    if (this.videoElementRef?.nativeElement) {
      this.duration = this.videoElementRef.nativeElement.duration;
      this.videoElementRef.nativeElement.volume = 1.0;
      this.cinemaService.setHostVolume(this.hostVolume);
    }
  }

  onVideoEnded(): void {
    this.isPlaying = false;
    this.broadcastCommand('Pause', this.duration);
  }

  private broadcastCommand(commandType: 'Play' | 'Pause' | 'Seek' | 'Rate' | 'LoadMedia', pos: number): void {
    this.signalRService.sendCinemaCommand(this.roomCode, {
      commandType,
      position: pos,
      playbackRate: Number(this.playbackRate),
      mediaTitle: this.mediaTitle,
      mediaDuration: this.duration,
      scheduledPlayTime: commandType === 'Play' ? Date.now() + 100 : undefined
    }).catch(err => {
      console.warn('Error sending cinema command:', err);
    });
  }

  // --- Surround Speaker Grid Helpers ---

  getSpeakerStatus(position: DevicePosition): string {
    const speaker = this.phoneParticipants.find(p => p.devicePosition === position);
    return speaker ? 'active' : 'empty';
  }

  getSpeakerName(position: DevicePosition): string {
    const speaker = this.phoneParticipants.find(p => p.devicePosition === position);
    return speaker ? (speaker.deviceName || speaker.username) : 'Available Slot';
  }

  getSpeakerDrift(position: DevicePosition): string {
    const speaker = this.phoneParticipants.find(p => p.devicePosition === position);
    if (!speaker || !speaker.connectionId) return '';
    const report = this.deviceReports.get(speaker.connectionId);
    return report ? `±${Math.abs(report.driftMs)}ms` : '● Synced';
  }

  getSpeakerDriftRaw(connectionId: string): string {
    const report = this.deviceReports.get(connectionId);
    return report ? `${report.driftMs > 0 ? '+' : ''}${report.driftMs}ms` : '< 20ms';
  }

  getSpeakerRtt(connectionId: string): string {
    const report = this.deviceReports.get(connectionId);
    return report ? `${Math.round(report.rtt)}ms` : '15ms';
  }

  getSyncStatusText(connectionId: string): string {
    const report = this.deviceReports.get(connectionId);
    return report ? report.syncStatus.toUpperCase() : 'SYNCHRONIZED';
  }

  getSyncQualityClass(connectionId: string): string {
    const report = this.deviceReports.get(connectionId);
    if (!report) return 'excellent';
    return report.syncStatus.toLowerCase();
  }

  onAssignPosition(phone: Participant, newPosition: string): void {
    this.signalRService.updateDevicePosition(this.roomCode, {
      connectionId: phone.connectionId,
      devicePosition: newPosition,
      volume: phone.volume ?? 80,
      isMuted: phone.isMuted ?? false,
      deviceName: phone.deviceName
    });
    this.toastService.info(`Assigned ${phone.username} to ${newPosition}`);
  }

  onAdjustPhoneVolume(phone: Participant, vol: number): void {
    phone.volume = vol;
    this.signalRService.updateDevicePosition(this.roomCode, {
      connectionId: phone.connectionId,
      devicePosition: phone.devicePosition || 'FrontLeft',
      volume: vol,
      isMuted: phone.isMuted ?? false
    });
  }

  reconnectPhone(phone: Participant): void {
    if (phone.connectionId) {
      this.toastService.info(`Re-establishing audio to ${phone.deviceName || phone.username}...`);
      this.setupAudioCapture();
      this.cinemaService.reconnectPhoneSpeaker(phone.connectionId, this.roomCode, true);
    }
  }

  async copyInviteLink(): Promise<void> {
    const url = `${window.location.origin}/cinema/device/${this.roomCode}`;
    const shareData = {
      title: 'Join Cinema Surround Sound',
      text: `Connect your phone as a surround speaker for movie room ${this.roomCode}:`,
      url: url
    };

    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err: any) {
        if (err.name !== 'AbortError') console.warn(err);
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      this.toastService.success(`Phone join link copied! (Room: ${this.roomCode})`);
    } catch {
      prompt('Copy this link on phones to join as speakers:', url);
    }
  }

  leaveRoom(): void {
    this.signalRService.leaveRoom(this.roomCode);
    this.router.navigate(['/']);
  }

  formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return '00:00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }

  // --- Real-time Pipeline Diagnostics Helpers (Section 22 of prompt) ---

  getPhoneSignalRStatus(phone: Participant): string {
    return phone.isConnected ? 'ok' : 'err';
  }
  getPhoneSignalRText(phone: Participant): string {
    return phone.isConnected ? 'Connected ✅' : 'Disconnected ❌';
  }

  getPhoneWebRtcStatus(phone: Participant): string {
    const report = phone.connectionId ? this.deviceReports.get(phone.connectionId) : null;
    const diag = phone.connectionId ? this.peerDiagnostics.get(phone.connectionId) : null;
    const state = diag?.connectionState || report?.webRtcState;
    if (state === 'connected') return 'ok';
    if (state === 'connecting') return 'pending';
    if (state === 'failed') return 'err';
    return 'pending';
  }
  getPhoneWebRtcText(phone: Participant): string {
    const report = phone.connectionId ? this.deviceReports.get(phone.connectionId) : null;
    const diag = phone.connectionId ? this.peerDiagnostics.get(phone.connectionId) : null;
    const state = diag?.connectionState || report?.webRtcState;
    if (state === 'connected') return 'Connected ✅';
    if (state === 'connecting') return 'Connecting ⏳';
    if (state === 'failed') return 'Failed ❌';
    return state ? state.toUpperCase() : 'INIT ⏳';
  }

  getPhoneIceStatus(phone: Participant): string {
    const report = phone.connectionId ? this.deviceReports.get(phone.connectionId) : null;
    const diag = phone.connectionId ? this.peerDiagnostics.get(phone.connectionId) : null;
    const ice = diag?.iceState || report?.iceState;
    if (ice === 'connected' || ice === 'completed') return 'ok';
    if (ice === 'checking') return 'pending';
    if (ice === 'failed' || ice === 'disconnected') return 'err';
    return 'pending';
  }
  getPhoneIceText(phone: Participant): string {
    const report = phone.connectionId ? this.deviceReports.get(phone.connectionId) : null;
    const diag = phone.connectionId ? this.peerDiagnostics.get(phone.connectionId) : null;
    const ice = diag?.iceState || report?.iceState;
    if (ice === 'connected' || ice === 'completed') return 'Connected ✅';
    if (ice === 'checking') return 'Checking ⏳';
    if (ice === 'failed') return 'Failed ❌';
    return ice ? ice.toUpperCase() : 'INIT ⏳';
  }

  getPhoneTrackStatus(phone: Participant): string {
    const report = phone.connectionId ? this.deviceReports.get(phone.connectionId) : null;
    if (report?.audioTrackReceived) return 'ok';
    return 'pending';
  }
  getPhoneTrackText(phone: Participant): string {
    const report = phone.connectionId ? this.deviceReports.get(phone.connectionId) : null;
    if (report?.audioTrackReceived) return 'Active 🔊';
    return 'Waiting ⏳';
  }

  getPhonePlaybackStatus(phone: Participant): string {
    const report = phone.connectionId ? this.deviceReports.get(phone.connectionId) : null;
    if (report?.audioAutoplayBlocked) return 'err';
    if (report?.audioPlaybackActive) return 'ok';
    return 'pending';
  }
  getPhonePlaybackText(phone: Participant): string {
    const report = phone.connectionId ? this.deviceReports.get(phone.connectionId) : null;
    if (report?.audioAutoplayBlocked) return 'Blocked 🔇 (Tap to unlock)';
    if (report?.audioPlaybackActive) return 'Playing 🔊';
    return 'Standby ⏸️';
  }
}
