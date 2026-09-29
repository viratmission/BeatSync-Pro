import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { UserService } from '../../core/services/user.service';
import { AudioDeviceService } from '../../core/services/audio-device.service';
import { ToastService } from '../../core/services/toast.service';
import { HeaderComponent } from '../../shared/components/header/header.component';
import { FooterComponent } from '../../shared/components/footer/footer.component';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, HeaderComponent, FooterComponent],
  template: `
    <div class="page-layout">
      <app-header></app-header>
      <main class="profile-main">
        <div class="profile-card">
          <div class="profile-header">
            <div class="avatar-large">{{ getInitials(username) }}</div>
            <div class="profile-titles">
              <h2>User Profile</h2>
              <span class="user-role">BeatSync Participant</span>
            </div>
          </div>

          <div class="settings-form">
            <div class="form-group">
              <label>Current Username</label>
              <div class="input-with-button">
                <input
                  type="text"
                  [(ngModel)]="username"
                  class="form-input"
                />
                <button class="btn-secondary" (click)="saveUsername()">Save</button>
              </div>
            </div>

            <div class="form-group">
              <label>Audio Preferences</label>
              <div class="pref-card">
                <label class="checkbox-row">
                  <input
                    type="checkbox"
                    [(ngModel)]="useNativeSpeakers"
                    (change)="onSpeakerOptionChange()"
                  />
                  <span>Use native device speakers for browser playback</span>
                </label>
              </div>
            </div>

            <div class="form-group">
              <label>Session Stats</label>
              <div class="stats-grid">
                <div class="stat-box">
                  <span class="stat-num">3</span>
                  <span class="stat-lbl">Built-in Tracks</span>
                </div>
                <div class="stat-box">
                  <span class="stat-num">&lt; 15ms</span>
                  <span class="stat-lbl">Target Sync Drift</span>
                </div>
              </div>
            </div>
          </div>

          <div class="profile-footer">
            <a routerLink="/" class="back-link">← Return to Home</a>
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
    .profile-main {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
    }
    .profile-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.05);
      max-width: 480px;
      width: 100%;
      padding: 32px;
    }
    .profile-header {
      display: flex;
      align-items: center;
      gap: 16px;
      padding-bottom: 24px;
      border-bottom: 1px solid #f1f5f9;
      margin-bottom: 24px;
    }
    .avatar-large {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: #0f172a;
      color: #ffffff;
      font-size: 20px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .profile-titles h2 {
      margin: 0;
      font-size: 20px;
      color: #0f172a;
    }
    .user-role {
      font-size: 13px;
      color: #64748b;
    }
    .settings-form {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    label {
      font-size: 13px;
      font-weight: 600;
      color: #475569;
    }
    .input-with-button {
      display: flex;
      gap: 10px;
    }
    .form-input {
      flex: 1;
      height: 42px;
      padding: 0 12px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
    }
    .form-input:focus {
      border-color: #0f172a;
    }
    .btn-secondary {
      padding: 0 18px;
      height: 42px;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
    }
    .pref-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px;
    }
    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      color: #334155;
      cursor: pointer;
    }
    .checkbox-row input {
      accent-color: #0f172a;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .stat-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px;
      text-align: center;
    }
    .stat-num {
      display: block;
      font-size: 18px;
      font-weight: 700;
      color: #0f172a;
    }
    .stat-lbl {
      font-size: 11px;
      color: #64748b;
    }
    .profile-footer {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid #f1f5f9;
      text-align: center;
    }
    .back-link {
      font-size: 13px;
      color: #64748b;
      text-decoration: none;
    }
    .back-link:hover {
      color: #0f172a;
    }
  `]
})
export class ProfileComponent {
  private readonly userService = inject(UserService);
  private readonly audioDeviceService = inject(AudioDeviceService);
  private readonly toastService = inject(ToastService);

  username = '';
  useNativeSpeakers = true;

  constructor() {
    this.username = this.userService.currentUsername;
    this.audioDeviceService.useNativeSpeakers$.subscribe(val => {
      this.useNativeSpeakers = val;
    });
  }

  saveUsername(): void {
    if (this.username.trim().length > 0) {
      this.userService.setUsername(this.username.trim());
      this.toastService.success('Username updated successfully.');
    }
  }

  onSpeakerOptionChange(): void {
    this.audioDeviceService.setUseNativeSpeakers(this.useNativeSpeakers);
    this.toastService.info('Audio preference updated.');
  }

  getInitials(name: string): string {
    if (!name) return '?';
    const parts = name.split(/[-_\s]/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
}
