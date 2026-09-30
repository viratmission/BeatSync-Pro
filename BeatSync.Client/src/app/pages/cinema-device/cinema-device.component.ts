import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { SignalRService } from '../../core/services/signalr.service';
import { RoomService } from '../../core/services/room.service';
import { UserService } from '../../core/services/user.service';
import { ToastService } from '../../core/services/toast.service';
import { CinemaService, CinemaSyncState } from '../../core/services/cinema.service';
import { DEVICE_POSITIONS, DevicePosition, DevicePositionOption } from '../../core/models/cinema.model';
import { RoomState } from '../../core/models/room-state.model';
import { PlaybackState } from '../../core/models/playback-state.model';

@Component({
  selector: 'app-cinema-device',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="cinema-device-page">
      <!-- Hidden DOM Audio Element for Real-time Playback -->
      <audio #speakerAudio autoplay playsinline preload="auto" style="display:none"></audio>

      <!-- Ambient Glow Background -->
      <div class="ambient-glow" [class.playing]="isPlaying"></div>

      <!-- Top Navigation Bar -->
      <header class="top-bar">
        <div class="brand">
          <div class="logo-mark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </div>
          <div class="brand-text">
            <span class="app-name">BeatSync</span>
            <span class="mode-badge">CINEMA SPEAKER</span>
          </div>
        </div>

        <div class="top-actions">
          <div class="room-pill">
            <span class="room-label">ROOM</span>
            <span class="room-code-val">{{ roomCode }}</span>
          </div>
          <button class="btn-leave" (click)="leaveRoom()" title="Leave Cinema">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
          </button>
        </div>
      </header>

      <!-- Audio Unlock Floating Overlay (Critical for iOS/Android Autoplay Policy) -->
      @if (!isAudioUnlocked) {
        <div class="unlock-overlay">
          <div class="unlock-card">
            <div class="speaker-pulse-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
              </svg>
            </div>
            <h2>Activate Surround Speaker</h2>
            <p>Mobile browsers require one initial tap to unlock high-definition multi-channel surround audio.</p>
            <button class="btn-unlock" (click)="unlockAudio()">
              <span>🔊 Tap to Connect Audio</span>
            </button>
            <span class="unlock-subtext">Optimized for low-latency synchronization</span>
          </div>
        </div>
      }

      <main class="device-main">
        <!-- Speaker Identity Section -->
        <section class="speaker-hero-card">
          <div class="speaker-position-indicator" [class.active-sound]="isPlaying">
            <div class="radar-wave wave-1"></div>
            <div class="radar-wave wave-2"></div>
            <div class="radar-wave wave-3"></div>
            <div class="speaker-center-badge">
              <span class="pos-icon">{{ currentPositionOption.icon }}</span>
            </div>
          </div>

          <div class="speaker-title-wrap">
            <div class="pos-tag">{{ currentPositionOption.shortLabel }} CHANNEL</div>
            <h1 class="speaker-title">{{ currentPositionOption.label }} Speaker</h1>
            <p class="pos-desc">{{ currentPositionOption.description }}</p>
          </div>

          <!-- Equalizer Visualizer when playing -->
          <div class="audio-visualizer-bars" [class.bars-active]="isPlaying">
            <span class="bar bar-1"></span>
            <span class="bar bar-2"></span>
            <span class="bar bar-3"></span>
            <span class="bar bar-4"></span>
            <span class="bar bar-5"></span>
            <span class="bar bar-6"></span>
            <span class="bar bar-7"></span>
            <span class="bar bar-8"></span>
          </div>
        </section>

        <!-- Position Selector Quick-Picker -->
        <section class="position-switcher-card">
          <div class="section-header">
            <h3>Speaker Position</h3>
            <span class="section-hint">Tap to reassign role</span>
          </div>
          <div class="position-grid">
            @for (pos of availablePositions; track pos.id) {
              <button
                class="pos-btn"
                [class.selected]="selectedPosition === pos.id"
                (click)="changePosition(pos.id)"
              >
                <span class="pos-btn-icon">{{ pos.icon }}</span>
                <span class="pos-btn-label">{{ pos.shortLabel }}</span>
              </button>
            }
          </div>
        </section>

        <!-- Live Master Media Status (Controlled by Laptop) -->
        <section class="master-status-card">
          <div class="media-info">
            <div class="host-pill">
              <span class="host-dot"></span>
              <span>HOST: {{ hostUsername || 'Authoritative Laptop' }}</span>
            </div>
            <h3 class="movie-name">{{ mediaTitle || 'Cinema Surround Session' }}</h3>
          </div>

          <!-- Playback Timeline (Read-Only on Speaker Phone) -->
          <div class="timeline-display">
            <div class="time-readout">
              <span class="current-time">{{ formatTime(currentPosition) }}</span>
              <span class="playback-pill" [class.playing-pill]="isPlaying">
                {{ isPlaying ? '▶ PLAYING' : '⏸ PAUSED' }}
              </span>
              <span class="total-time">{{ formatTime(mediaDuration) }}</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" [style.width.%]="progressPercent"></div>
            </div>
            <div class="host-lock-hint">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
              <span>Master timeline controlled by Host Laptop</span>
            </div>
          </div>
        </section>

        <!-- Precision Sync & Telemetry HUD -->
        <section class="telemetry-card">
          <div class="telemetry-header">
            <h3>Cinema Sync Engine</h3>
            <span class="quality-badge" [ngClass]="getQualityBadgeClass(syncState.syncQuality)">
              {{ syncState.syncQuality }}
            </span>
          </div>

          <div class="metrics-grid">
            <div class="metric-item">
              <span class="metric-label">AUDIO DRIFT</span>
              <span class="metric-val" [class.drift-good]="Math.abs(syncState.driftMs) < 30">
                {{ syncState.driftMs > 0 ? '+' : '' }}{{ syncState.driftMs }} ms
              </span>
            </div>
            <div class="metric-item">
              <span class="metric-label">NETWORK PING</span>
              <span class="metric-val">{{ syncState.rtt }} ms</span>
            </div>
            <div class="metric-item">
              <span class="metric-label">PLAYBACK RATE</span>
              <span class="metric-val">{{ syncState.playbackRate.toFixed(2) }}x</span>
            </div>
            <div class="metric-item">
              <span class="metric-label">STREAM MODE</span>
              <span class="metric-val stream-mode">
                {{ syncState.isWebRtcStreaming ? 'WebRTC P2P' : 'HTTP Chunked' }}
              </span>
            </div>
          </div>
        </section>

        <!-- Local Speaker Controls -->
        <section class="speaker-controls-card">
          <div class="volume-row">
            <button class="btn-mute" (click)="toggleMute()" [class.muted]="isMuted">
              @if (isMuted || volume === 0) {
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="1" y1="1" x2="23" y2="23"></line>
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                  <line x1="12" y1="19" x2="12" y2="23"></line>
                  <line x1="8" y1="23" x2="16" y2="23"></line>
                </svg>
              } @else {
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                </svg>
              }
            </button>
            <div class="slider-wrap">
              <div class="slider-header">
                <span>Speaker Volume</span>
                <span class="vol-percent">{{ isMuted ? 'Muted' : volume + '%' }}</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                [(ngModel)]="volume"
                (input)="onVolumeChange()"
                class="vol-slider"
              />
            </div>
          </div>

          <div class="speaker-tools-row">
            <button class="btn-test-tone" (click)="playTestChirp()">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polygon points="10 8 16 12 10 16 10 8"></polygon>
              </svg>
              <span>Test Speaker Output</span>
            </button>
          </div>
        </section>
      </main>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      background: #090d16;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    .cinema-device-page {
      min-height: 100vh;
      position: relative;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
      padding-bottom: 30px;
    }

    .ambient-glow {
      position: absolute;
      top: -100px;
      left: 50%;
      transform: translateX(-50%);
      width: 500px;
      height: 400px;
      background: radial-gradient(circle, rgba(56, 189, 248, 0.15) 0%, rgba(99, 102, 241, 0.05) 50%, transparent 80%);
      pointer-events: none;
      transition: all 0.8s ease;
      z-index: 0;
    }

    .ambient-glow.playing {
      background: radial-gradient(circle, rgba(56, 189, 248, 0.25) 0%, rgba(168, 85, 247, 0.12) 50%, transparent 80%);
      transform: translateX(-50%) scale(1.15);
    }

    /* Top Navigation Bar */
    .top-bar {
      position: relative;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(12px);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .logo-mark {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #38bdf8 0%, #6366f1 100%);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ffffff;
      padding: 6px;
    }

    .brand-text {
      display: flex;
      flex-direction: column;
    }

    .app-name {
      font-size: 15px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: #ffffff;
    }

    .mode-badge {
      font-size: 9px;
      font-weight: 700;
      color: #38bdf8;
      letter-spacing: 0.1em;
    }

    .top-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .room-pill {
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 4px 10px;
      border-radius: 20px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .room-label {
      font-size: 10px;
      font-weight: 600;
      color: #94a3b8;
    }

    .room-code-val {
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.05em;
      color: #f8fafc;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }

    .btn-leave {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.25);
      color: #f87171;
      width: 34px;
      height: 34px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-leave:hover {
      background: rgba(239, 68, 68, 0.2);
    }

    /* Unlock Overlay */
    .unlock-overlay {
      position: fixed;
      inset: 0;
      z-index: 100;
      background: rgba(10, 15, 29, 0.94);
      backdrop-filter: blur(16px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .unlock-card {
      background: #111827;
      border: 1px solid rgba(56, 189, 248, 0.3);
      box-shadow: 0 0 50px rgba(56, 189, 248, 0.15);
      border-radius: 24px;
      padding: 36px 24px;
      max-width: 400px;
      width: 100%;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      animation: popIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes popIn {
      from { transform: scale(0.9); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    .speaker-pulse-icon {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: linear-gradient(135deg, #0284c7 0%, #6366f1 100%);
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      box-shadow: 0 0 24px rgba(56, 189, 248, 0.4);
      animation: iconPulse 2s infinite ease-in-out;
    }

    @keyframes iconPulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.08); }
    }

    .unlock-card h2 {
      font-size: 20px;
      font-weight: 700;
      color: #ffffff;
      margin: 0;
    }

    .unlock-card p {
      font-size: 13px;
      color: #94a3b8;
      line-height: 1.5;
      margin: 0;
    }

    .btn-unlock {
      width: 100%;
      padding: 16px;
      background: linear-gradient(135deg, #0284c7 0%, #4f46e5 100%);
      color: #ffffff;
      border: none;
      border-radius: 14px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(2, 132, 199, 0.4);
      transition: all 0.2s;
    }

    .btn-unlock:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 24px rgba(2, 132, 199, 0.5);
    }

    .unlock-subtext {
      font-size: 11px;
      color: #64748b;
    }

    /* Main Container */
    .device-main {
      position: relative;
      z-index: 1;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-width: 600px;
      margin: 0 auto;
      width: 100%;
    }

    /* Speaker Hero Card */
    .speaker-hero-card {
      background: linear-gradient(180deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.8) 100%);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      padding: 28px 20px 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      position: relative;
      overflow: hidden;
    }

    .speaker-position-indicator {
      width: 110px;
      height: 110px;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
    }

    .radar-wave {
      position: absolute;
      border: 2px solid rgba(56, 189, 248, 0.2);
      border-radius: 50%;
      pointer-events: none;
      opacity: 0;
    }

    .active-sound .radar-wave {
      animation: radarRipples 2s linear infinite;
    }

    .wave-1 { width: 100%; height: 100%; animation-delay: 0s; }
    .wave-2 { width: 130%; height: 130%; animation-delay: 0.6s; }
    .wave-3 { width: 160%; height: 160%; animation-delay: 1.2s; }

    @keyframes radarRipples {
      0% { transform: scale(0.6); opacity: 0.8; border-color: rgba(56, 189, 248, 0.8); }
      100% { transform: scale(1.4); opacity: 0; border-color: rgba(56, 189, 248, 0); }
    }

    .speaker-center-badge {
      width: 74px;
      height: 74px;
      border-radius: 50%;
      background: #0f172a;
      border: 2px solid #38bdf8;
      box-shadow: 0 0 20px rgba(56, 189, 248, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2;
    }

    .pos-icon {
      font-size: 32px;
    }

    .pos-tag {
      font-size: 11px;
      font-weight: 700;
      color: #38bdf8;
      letter-spacing: 0.1em;
      margin-bottom: 4px;
    }

    .speaker-title {
      font-size: 22px;
      font-weight: 800;
      color: #ffffff;
      margin: 0 0 6px 0;
    }

    .pos-desc {
      font-size: 12px;
      color: #94a3b8;
      margin: 0;
      max-width: 320px;
    }

    /* Equalizer Bars */
    .audio-visualizer-bars {
      display: flex;
      align-items: flex-end;
      gap: 4px;
      height: 28px;
      margin-top: 20px;
    }

    .bar {
      width: 4px;
      height: 4px;
      background: #38bdf8;
      border-radius: 2px;
      transition: height 0.1s ease;
    }

    .bars-active .bar-1 { animation: eqBar 0.6s infinite ease-in-out alternate; }
    .bars-active .bar-2 { animation: eqBar 0.4s infinite ease-in-out alternate 0.1s; }
    .bars-active .bar-3 { animation: eqBar 0.7s infinite ease-in-out alternate 0.2s; }
    .bars-active .bar-4 { animation: eqBar 0.5s infinite ease-in-out alternate 0.05s; }
    .bars-active .bar-5 { animation: eqBar 0.8s infinite ease-in-out alternate 0.15s; }
    .bars-active .bar-6 { animation: eqBar 0.45s infinite ease-in-out alternate 0.25s; }
    .bars-active .bar-7 { animation: eqBar 0.65s infinite ease-in-out alternate 0.1s; }
    .bars-active .bar-8 { animation: eqBar 0.55s infinite ease-in-out alternate 0.2s; }

    @keyframes eqBar {
      0% { height: 4px; opacity: 0.3; }
      100% { height: 26px; opacity: 1; background: #60a5fa; }
    }

    /* Position Switcher */
    .position-switcher-card {
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 16px;
      padding: 16px;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .section-header h3 {
      font-size: 13px;
      font-weight: 700;
      color: #e2e8f0;
      margin: 0;
    }

    .section-hint {
      font-size: 11px;
      color: #64748b;
    }

    .position-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
    }

    .pos-btn {
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      padding: 10px 4px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      color: #94a3b8;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .pos-btn:hover {
      background: rgba(51, 65, 85, 0.8);
      color: #ffffff;
    }

    .pos-btn.selected {
      background: rgba(2, 132, 199, 0.2);
      border-color: #38bdf8;
      color: #38bdf8;
      box-shadow: 0 0 12px rgba(56, 189, 248, 0.2);
    }

    .pos-btn-icon {
      font-size: 18px;
    }

    .pos-btn-label {
      font-size: 11px;
      font-weight: 700;
    }

    /* Master Status Card */
    .master-status-card {
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 16px;
      padding: 16px;
    }

    .media-info {
      margin-bottom: 12px;
    }

    .host-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      font-weight: 700;
      color: #94a3b8;
      background: rgba(30, 41, 59, 0.8);
      padding: 3px 8px;
      border-radius: 12px;
      margin-bottom: 6px;
    }

    .host-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #10b981;
    }

    .movie-name {
      font-size: 15px;
      font-weight: 700;
      color: #ffffff;
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .timeline-display {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .time-readout {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, monospace;
      color: #94a3b8;
    }

    .playback-pill {
      font-size: 10px;
      font-weight: 800;
      padding: 2px 8px;
      border-radius: 10px;
      background: rgba(100, 116, 139, 0.2);
      color: #94a3b8;
    }

    .playback-pill.playing-pill {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
    }

    .progress-track {
      height: 6px;
      background: rgba(30, 41, 59, 0.8);
      border-radius: 3px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #38bdf8 0%, #6366f1 100%);
      transition: width 0.3s linear;
    }

    .host-lock-hint {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: #64748b;
    }

    /* Telemetry Card */
    .telemetry-card {
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 16px;
      padding: 16px;
    }

    .telemetry-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .telemetry-header h3 {
      font-size: 13px;
      font-weight: 700;
      color: #e2e8f0;
      margin: 0;
    }

    .quality-badge {
      font-size: 10px;
      font-weight: 800;
      padding: 3px 8px;
      border-radius: 10px;
      letter-spacing: 0.05em;
    }

    .badge-excellent { background: rgba(16, 185, 129, 0.2); color: #34d399; }
    .badge-good { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
    .badge-realigning { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
    .badge-desynced { background: rgba(239, 68, 68, 0.2); color: #f87171; }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }

    .metric-item {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 10px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .metric-label {
      font-size: 9px;
      font-weight: 700;
      color: #64748b;
      letter-spacing: 0.08em;
    }

    .metric-val {
      font-size: 15px;
      font-weight: 800;
      color: #f1f5f9;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }

    .drift-good {
      color: #34d399;
    }

    .stream-mode {
      font-size: 12px;
      color: #38bdf8;
    }

    /* Local Speaker Controls */
    .speaker-controls-card {
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 16px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .volume-row {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .btn-mute {
      width: 44px;
      height: 44px;
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex-shrink: 0;
      transition: all 0.2s;
    }

    .btn-mute.muted {
      background: rgba(239, 68, 68, 0.2);
      border-color: rgba(239, 68, 68, 0.4);
      color: #f87171;
    }

    .slider-wrap {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .slider-header {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      font-weight: 600;
      color: #94a3b8;
    }

    .vol-percent {
      color: #38bdf8;
      font-weight: 700;
    }

    .vol-slider {
      width: 100%;
      height: 6px;
      accent-color: #38bdf8;
      cursor: pointer;
    }

    .speaker-tools-row {
      display: flex;
      justify-content: center;
    }

    .btn-test-tone {
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: #38bdf8;
      border-radius: 10px;
      padding: 10px 16px;
      font-size: 12px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-test-tone:hover {
      background: rgba(56, 189, 248, 0.2);
    }
  `]
})
export class CinemaDeviceComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('speakerAudio') speakerAudioRef!: ElementRef<HTMLAudioElement>;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly signalRService = inject(SignalRService);
  private readonly roomService = inject(RoomService);
  private readonly userService = inject(UserService);
  private readonly toastService = inject(ToastService);
  public readonly cinemaService = inject(CinemaService);

  readonly Math = Math;
  readonly availablePositions = DEVICE_POSITIONS;

  ngAfterViewInit(): void {
    if (this.speakerAudioRef?.nativeElement) {
      this.cinemaService.setAudioElement(this.speakerAudioRef.nativeElement);
    }
  }

  roomCode = '';
  username = '';
  hostUsername = '';
  mediaTitle = '';
  mediaDuration = 0;
  currentPosition = 0;
  isPlaying = false;
  progressPercent = 0;

  isAudioUnlocked = false;
  selectedPosition: DevicePosition = 'FrontLeft';
  volume = 85;
  isMuted = false;

  syncState: CinemaSyncState = {
    driftMs: 0,
    rtt: 0,
    clockOffset: 0,
    expectedPosition: 0,
    actualPosition: 0,
    playbackRate: 1.0,
    syncQuality: 'Excellent',
    isWebRtcStreaming: false
  };

  private subscriptions = new Subscription();
  private wakeLock: any = null;

  get currentPositionOption(): DevicePositionOption {
    return (
      DEVICE_POSITIONS.find(p => p.id === this.selectedPosition) || DEVICE_POSITIONS[0]
    );
  }

  async ngOnInit(): Promise<void> {
    const code = this.route.snapshot.paramMap.get('roomCode');
    if (!code) {
      this.toastService.error('Invalid Room Code');
      this.router.navigate(['/']);
      return;
    }

    this.roomCode = code.toUpperCase();
    this.username = this.userService.currentUsername;

    // Pick position from query param if provided (e.g. ?pos=FrontRight)
    const posParam = this.route.snapshot.queryParamMap.get('pos') as DevicePosition;
    if (posParam && DEVICE_POSITIONS.some(p => p.id === posParam)) {
      this.selectedPosition = posParam;
    }

    await this.joinAsCinemaSpeaker();
    this.initListeners();
    this.requestWakeLock();
  }

  private async joinAsCinemaSpeaker(): Promise<void> {
    try {
      // Connect to SignalR and join room as AudioSpeaker
      const roomState: RoomState = await this.signalRService.joinCinemaRoom(
        this.roomCode,
        this.username,
        'AudioSpeaker',
        this.selectedPosition,
        navigator.userAgent.includes('Mobile') ? 'Mobile Phone' : 'Speaker Device',
        this.volume,
        this.isMuted
      );

      if (roomState && roomState.room) {
        this.mediaTitle = roomState.room.mediaTitle || 'Cinema Surround Session';
        this.mediaDuration = roomState.room.mediaDuration || 0;
        this.hostUsername = roomState.room.hostUserId || '';
      }

      if (roomState && roomState.playbackState) {
        this.applyMasterPlayback(roomState.playbackState);
      }

      // Initialize Cinema Service audio engine with fallback streaming URL
      const streamUrl = this.roomService.getCinemaAudioStreamUrl(this.roomCode);
      this.cinemaService.startPhoneSyncEngine(
        this.roomCode,
        this.username,
        this.selectedPosition,
        streamUrl
      );

      this.cinemaService.setDeviceVolume(this.volume);
      this.toastService.success(`Connected as ${this.selectedPosition} Speaker!`);
    } catch (err: any) {
      console.error('Failed to join cinema room:', err);
      this.toastService.error(err?.message || 'Could not join Cinema room');
    }
  }

  private initListeners(): void {
    // 1. Cinema Playback Commands (Play, Pause, Seek, Rate, LoadMedia)
    this.subscriptions.add(
      this.signalRService.cinemaCommandExecuted$.subscribe(({ command, state }) => {
        if (command.commandType === 'LoadMedia') {
          if (command.mediaTitle) this.mediaTitle = command.mediaTitle;
          if (command.mediaDuration) this.mediaDuration = command.mediaDuration;
        }
        this.applyMasterPlayback(state);
      })
    );

    // 2. Playback State Updates
    this.subscriptions.add(
      this.signalRService.playbackStateChanged$.subscribe((state: PlaybackState) => {
        this.applyMasterPlayback(state);
      })
    );

    // 3. Sync Engine Telemetry
    this.subscriptions.add(
      this.cinemaService.syncState$.subscribe((state: CinemaSyncState) => {
        this.syncState = state;
        this.currentPosition = state.actualPosition;
        if (this.mediaDuration > 0) {
          this.progressPercent = Math.min(100, (this.currentPosition / this.mediaDuration) * 100);
        }
      })
    );

    // 4. Host Disconnection
    this.subscriptions.add(
      this.signalRService.cinemaHostDisconnected$.subscribe(() => {
        this.isPlaying = false;
        this.cinemaService.audioElement.pause();
        this.toastService.warning('Master Laptop Host disconnected. Audio paused.');
      })
    );
  }

  private applyMasterPlayback(state: PlaybackState): void {
    this.isPlaying = state.isPlaying;
    this.currentPosition = state.currentPosition;
    if (state.duration) this.mediaDuration = state.duration;
    if (this.mediaDuration > 0) {
      this.progressPercent = Math.min(100, (this.currentPosition / this.mediaDuration) * 100);
    }
    this.cinemaService.applyPlaybackState(state);
  }

  public unlockAudio(): void {
    this.cinemaService.unlockAudioOnTouch();
    this.isAudioUnlocked = true;
    this.toastService.info('Speaker audio activated');
  }

  public changePosition(position: DevicePosition): void {
    this.selectedPosition = position;
    this.cinemaService.setDevicePosition(position);
    this.toastService.info(`Reassigned to ${position}`);
  }

  public onVolumeChange(): void {
    this.cinemaService.setDeviceVolume(this.volume);
  }

  public toggleMute(): void {
    this.isMuted = this.cinemaService.toggleMute();
  }

  public playTestChirp(): void {
    this.unlockAudio();
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3);

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.35);
      this.toastService.info('Test chime played!');
    } catch (e) {
      console.warn('Could not play test chirp:', e);
    }
  }

  public getQualityBadgeClass(quality: string): string {
    switch (quality) {
      case 'Excellent': return 'badge-excellent';
      case 'Good': return 'badge-good';
      case 'Realigning': return 'badge-realigning';
      case 'Desynced': return 'badge-desynced';
      default: return 'badge-good';
    }
  }

  public formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds) || seconds < 0) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const pad = (n: number) => n.toString().padStart(2, '0');
    if (hrs > 0) {
      return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
  }

  private async requestWakeLock(): Promise<void> {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await (navigator as any).wakeLock.request('screen');
      }
    } catch {
      // Wake lock not supported or denied
    }
  }

  public async leaveRoom(): Promise<void> {
    await this.signalRService.leaveRoom(this.roomCode);
    this.router.navigate(['/']);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.cinemaService.stop();
    if (this.wakeLock) {
      try {
        this.wakeLock.release();
      } catch {}
    }
  }
}
