import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <header class="app-header">
      <div class="header-container">
        <!-- Logo -->
        <a routerLink="/" class="brand" (click)="onBrandClick($event)">
          <div class="brand-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 10v3" />
              <path d="M6 6v11" />
              <path d="M10 3v18" />
              <path d="M14 8v7" />
              <path d="M18 5v13" />
              <path d="M22 10v4" />
            </svg>
          </div>
          <span class="brand-name">BeatSync</span>
        </a>

        <!-- Room Header Controls (if in room) -->
        @if (roomCode) {
          <div class="room-header-details">
            <div class="room-pill">
              <span class="room-label">ROOM</span>
              <span class="room-code">{{ roomCode }}</span>
              <button
                class="copy-btn"
                (click)="copyCode()"
                [title]="copied ? 'Copied!' : 'Copy room code'"
                aria-label="Copy room code"
              >
                @if (copied) {
                  <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                } @else {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                }
              </button>
            </div>

            <div class="connection-pill" [ngClass]="connectionState">
              <span class="pulse-dot"></span>
              <span class="connection-label">{{ connectionState }}</span>
            </div>

            <button class="leave-btn" (click)="leave.emit()">
              Leave
            </button>
          </div>
        } @else {
          <nav class="nav-links">
            <a routerLink="/login" class="nav-link">Login</a>
            <a routerLink="/profile" class="nav-link">Profile</a>
          </nav>
        }
      </div>
    </header>
  `,
  styles: [`
    .app-header {
      background: #ffffff;
      border-bottom: 1px solid #e2e8f0;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .header-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 24px;
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: #0f172a;
    }
    .brand-icon {
      width: 32px;
      height: 32px;
      background: #0f172a;
      color: #ffffff;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 6px;
    }
    .brand-name {
      font-size: 19px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .room-header-details {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .room-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 20px;
      font-size: 13px;
    }
    .room-label {
      color: #64748b;
      font-weight: 600;
      font-size: 11px;
      letter-spacing: 0.05em;
    }
    .room-code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: 700;
      color: #0f172a;
      letter-spacing: 0.05em;
    }
    .copy-btn {
      background: none;
      border: none;
      padding: 2px;
      display: flex;
      align-items: center;
      cursor: pointer;
      color: #64748b;
      border-radius: 4px;
      transition: color 0.15s ease;
    }
    .copy-btn:hover {
      color: #0f172a;
    }
    .connection-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
      text-transform: capitalize;
    }
    .pulse-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
    }
    .connection-pill.connected {
      background: #ecfdf5;
      color: #065f46;
    }
    .connection-pill.connected .pulse-dot {
      background: #10b981;
      box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
    }
    .connection-pill.connecting, .connection-pill.reconnecting {
      background: #fffbeb;
      color: #92400e;
    }
    .connection-pill.connecting .pulse-dot, .connection-pill.reconnecting .pulse-dot {
      background: #f59e0b;
    }
    .connection-pill.disconnected {
      background: #fef2f2;
      color: #991b1b;
    }
    .connection-pill.disconnected .pulse-dot {
      background: #ef4444;
    }
    .leave-btn {
      padding: 6px 14px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      color: #ef4444;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .leave-btn:hover {
      background: #fef2f2;
      border-color: #fca5a5;
    }
    .nav-links {
      display: flex;
      gap: 16px;
    }
    .nav-link {
      text-decoration: none;
      color: #64748b;
      font-size: 14px;
      font-weight: 500;
      padding: 6px 10px;
      border-radius: 6px;
      transition: color 0.15s ease;
    }
    .nav-link:hover {
      color: #0f172a;
    }
    @media (max-width: 640px) {
      .header-container {
        padding: 0 16px;
      }
      .connection-pill {
        display: none;
      }
    }
  `]
})
export class HeaderComponent {
  @Input() roomCode: string | null = null;
  @Input() connectionState: string = 'connected';
  @Output() leave = new EventEmitter<void>();

  copied = false;

  onBrandClick(event: MouseEvent): void {
    if (this.roomCode) {
      const confirmLeave = confirm('Leave this room and return home?');
      if (!confirmLeave) {
        event.preventDefault();
        return;
      }
      this.leave.emit();
    }
  }

  copyCode(): void {
    if (!this.roomCode) return;
    navigator.clipboard.writeText(this.roomCode).then(() => {
      this.copied = true;
      setTimeout(() => {
        this.copied = false;
      }, 2000);
    });
  }
}
