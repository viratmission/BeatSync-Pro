import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { RoomService } from '../../core/services/room.service';
import { UserService } from '../../core/services/user.service';
import { AudioDeviceService } from '../../core/services/audio-device.service';
import { ToastService } from '../../core/services/toast.service';
import { HeaderComponent } from '../../shared/components/header/header.component';
import { FooterComponent } from '../../shared/components/footer/footer.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent, FooterComponent],
  template: `
    <div class="page-layout">
      <app-header></app-header>

      <main class="home-main">
        <div class="hero-card">
          <!-- Logo & Brand Header -->
          <div class="brand-section">
            <div class="hero-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 10v3" />
                <path d="M6 6v11" />
                <path d="M10 3v18" />
                <path d="M14 8v7" />
                <path d="M18 5v13" />
                <path d="M22 10v4" />
              </svg>
            </div>
            <h1 class="main-heading">Join a BeatSync Room</h1>
            <p class="sub-heading">
              Synchronize audio playback across multiple devices and listen together in real time.
            </p>
          </div>

          <!-- Room Code Input & Join Button -->
          <div class="form-section">
            <div class="input-wrapper">
              <input
                type="text"
                class="room-input"
                [(ngModel)]="roomCode"
                (input)="onRoomCodeInput($event)"
                placeholder="Enter room code"
                maxlength="6"
                autocomplete="off"
                spellcheck="false"
                (keyup.enter)="joinRoom()"
              />
              <button
                class="btn-primary join-btn"
                [disabled]="isJoining || roomCode.length !== 6"
                (click)="joinRoom()"
              >
                @if (isJoining) {
                  <span class="spinner"></span> Joining...
                } @else {
                  Join Room
                }
              </button>
            </div>

            @if (errorMessage) {
              <div class="error-banner" role="alert">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{{ errorMessage }}</span>
              </div>
            }
          </div>

          <!-- Divider -->
          <div class="divider">
            <span>or start a new session</span>
          </div>

          <!-- Create Cinema Experience (Laptop Host) -->
          <button
            class="btn-cinema create-cinema-btn"
            [disabled]="isCreating || isCreatingCinema"
            (click)="createCinemaRoom()"
          >
            @if (isCreatingCinema) {
              <span class="spinner"></span> Initializing Cinema...
            } @else {
              <div class="cinema-icon-badge">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
                  <line x1="7" y1="2" x2="7" y2="22"></line>
                  <line x1="17" y1="2" x2="17" y2="22"></line>
                  <line x1="2" y1="12" x2="22" y2="12"></line>
                  <line x1="2" y1="7" x2="7" y2="7"></line>
                  <line x1="2" y1="17" x2="7" y2="17"></line>
                  <line x1="17" y1="17" x2="22" y2="17"></line>
                  <line x1="17" y1="7" x2="22" y2="7"></line>
                </svg>
              </div>
              <div class="cinema-btn-text">
                <span class="cinema-btn-title">Host Cinema Surround</span>
                <span class="cinema-btn-sub">Play video on laptop + sync phones as speakers</span>
              </div>
            }
          </button>

          <!-- Create Standard Audio Room Button -->
          <button
            class="btn-secondary create-btn"
            [disabled]="isCreating || isCreatingCinema"
            (click)="createRoom()"
          >
            @if (isCreating) {
              <span class="spinner"></span> Creating Room...
            } @else {
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Create Standard Music Room
            }
          </button>

          <!-- Username Section -->
          <div class="username-card">
            <span class="username-label">You'll join as</span>
            <div class="username-row">
              <div class="username-display">
                <span class="user-avatar-dot"></span>
                <input
                  type="text"
                  class="username-input"
                  [(ngModel)]="username"
                  (blur)="saveUsername()"
                  maxlength="30"
                  aria-label="Your username"
                />
              </div>
              <button
                class="btn-icon regenerate-btn"
                (click)="regenerateUsername()"
                title="Regenerate random username"
                aria-label="Regenerate username"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Native Speaker Option -->
          <div class="speaker-option">
            <label class="checkbox-container">
              <input
                type="checkbox"
                [(ngModel)]="useNativeSpeakers"
                (change)="onNativeSpeakersChanged()"
              />
              <span class="checkmark"></span>
              <span class="checkbox-text">Use native device speakers</span>
            </label>
          </div>
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
    .home-main {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
    }
    .hero-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.05), 0 2px 6px -1px rgba(0, 0, 0, 0.03);
      max-width: 480px;
      width: 100%;
      padding: 36px 32px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .brand-section {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .hero-icon {
      width: 48px;
      height: 48px;
      background: #0f172a;
      color: #ffffff;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 10px;
      margin-bottom: 16px;
    }
    .main-heading {
      font-size: 24px;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 8px 0;
      letter-spacing: -0.02em;
    }
    .sub-heading {
      font-size: 14px;
      color: #64748b;
      margin: 0;
      line-height: 1.5;
    }
    .form-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .input-wrapper {
      display: flex;
      gap: 10px;
    }
    .room-input {
      flex: 1;
      height: 48px;
      padding: 0 16px;
      font-size: 16px;
      font-weight: 600;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #0f172a;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      transition: all 0.15s ease;
      outline: none;
    }
    .room-input:focus {
      background: #ffffff;
      border-color: #0f172a;
      box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.1);
    }
    .btn-primary {
      height: 48px;
      padding: 0 22px;
      background: #0f172a;
      color: #ffffff;
      border: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: background 0.15s ease;
      white-space: nowrap;
    }
    .btn-primary:hover:not(:disabled) {
      background: #1e293b;
    }
    .btn-primary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .error-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 8px;
      color: #b91c1c;
      font-size: 13px;
    }
    .divider {
      display: flex;
      align-items: center;
      text-align: center;
      color: #94a3b8;
      font-size: 12px;
      font-weight: 500;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      border-bottom: 1px solid #e2e8f0;
    }
    .btn-cinema {
      min-height: 54px;
      padding: 10px 16px;
      background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
      border: 1px solid rgba(99, 102, 241, 0.35);
      border-radius: 12px;
      color: #ffffff;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 12px;
      transition: all 0.2s ease;
      text-align: left;
      box-shadow: 0 4px 14px rgba(79, 70, 229, 0.12);
    }
    .btn-cinema:hover:not(:disabled) {
      background: linear-gradient(135deg, #1e293b 0%, #312e81 100%);
      border-color: #818cf8;
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(79, 70, 229, 0.2);
    }
    .btn-cinema:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .cinema-icon-badge {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: linear-gradient(135deg, #0284c7 0%, #6366f1 100%);
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .cinema-btn-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .cinema-btn-title {
      font-size: 14px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: -0.01em;
    }
    .cinema-btn-sub {
      font-size: 11px;
      color: #94a3b8;
    }
    .btn-secondary {
      height: 48px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      color: #0f172a;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.15s ease;
    }
    .btn-secondary:hover:not(:disabled) {
      background: #f8fafc;
      border-color: #94a3b8;
    }
    .username-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .username-label {
      font-size: 12px;
      font-weight: 500;
      color: #64748b;
    }
    .username-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .username-display {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
    }
    .user-avatar-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #3b82f6;
    }
    .username-input {
      border: none;
      background: transparent;
      font-size: 14px;
      font-weight: 600;
      color: #0f172a;
      outline: none;
      width: 100%;
    }
    .regenerate-btn {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #64748b;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .regenerate-btn:hover {
      color: #0f172a;
      border-color: #cbd5e1;
    }
    .speaker-option {
      display: flex;
      align-items: center;
    }
    .checkbox-container {
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      user-select: none;
      font-size: 13px;
      color: #475569;
    }
    .checkbox-container input {
      accent-color: #0f172a;
      width: 16px;
      height: 16px;
      cursor: pointer;
    }
    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      border-top-color: #ffffff;
      animation: spin 0.6s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @media (max-width: 520px) {
      .hero-card {
        padding: 24px 20px;
      }
      .input-wrapper {
        flex-direction: column;
      }
    }
  `]
})
export class HomeComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly roomService = inject(RoomService);
  private readonly userService = inject(UserService);
  private readonly audioDeviceService = inject(AudioDeviceService);
  private readonly toastService = inject(ToastService);

  roomCode = '';
  username = '';
  useNativeSpeakers = true;
  isJoining = false;
  isCreating = false;
  isCreatingCinema = false;
  errorMessage = '';

  constructor() {
    this.username = this.userService.currentUsername;
    this.audioDeviceService.useNativeSpeakers$.subscribe(val => {
      this.useNativeSpeakers = val;
    });
  }

  ngOnInit(): void {
    const codeParam = this.route.snapshot.queryParamMap.get('code');
    if (codeParam && codeParam.trim().length === 6) {
      this.roomCode = codeParam.trim().toUpperCase();
      this.joinRoom();
    }
  }

  onRoomCodeInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.roomCode = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    this.errorMessage = '';
  }

  saveUsername(): void {
    if (this.username.trim().length > 0) {
      this.userService.setUsername(this.username);
    }
  }

  regenerateUsername(): void {
    this.username = this.userService.regenerateUsername();
    this.toastService.info(`Username updated: ${this.username}`);
  }

  onNativeSpeakersChanged(): void {
    this.audioDeviceService.setUseNativeSpeakers(this.useNativeSpeakers);
  }

  async joinRoom(): Promise<void> {
    if (this.roomCode.length !== 6) {
      this.errorMessage = 'Please enter a valid 6-character room code.';
      return;
    }

    this.saveUsername();
    this.isJoining = true;
    this.errorMessage = '';

    try {
      // Validate room existence and inspect roomMode
      const room = await this.roomService.getRoom(this.roomCode).toPromise();
      if (room && room.roomMode === 'Cinema') {
        this.router.navigate(['/cinema/device', this.roomCode]);
      } else {
        this.router.navigate(['/room', this.roomCode]);
      }
    } catch (err: any) {
      this.isJoining = false;
      this.errorMessage = err?.error?.message || 'Room not found. Check the code and try again.';
      this.toastService.error(this.errorMessage);
    }
  }

  async createCinemaRoom(): Promise<void> {
    this.saveUsername();
    this.isCreatingCinema = true;
    this.errorMessage = '';

    try {
      const room = await this.roomService.createRoom({
        hostUsername: this.userService.currentUsername,
        roomMode: 'Cinema'
      }).toPromise();

      if (room && room.roomCode) {
        this.toastService.success(`Cinema Room ${room.roomCode} created!`);
        this.router.navigate(['/cinema/host', room.roomCode]);
      }
    } catch (err: any) {
      this.isCreatingCinema = false;
      this.errorMessage = err?.error?.message || 'Failed to create Cinema room. Please try again.';
      this.toastService.error(this.errorMessage);
    }
  }

  async createRoom(): Promise<void> {
    this.saveUsername();
    this.isCreating = true;
    this.errorMessage = '';

    try {
      const room = await this.roomService.createRoom({
        hostUsername: this.userService.currentUsername,
        roomMode: 'AudioSync'
      }).toPromise();

      if (room && room.roomCode) {
        this.toastService.success(`Room ${room.roomCode} created!`);
        this.router.navigate(['/room', room.roomCode]);
      }
    } catch (err: any) {
      this.isCreating = false;
      this.errorMessage = err?.error?.message || 'Failed to create room. Please try again.';
      this.toastService.error(this.errorMessage);
    }
  }
}
