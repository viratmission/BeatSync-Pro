import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <footer class="app-footer">
      <div class="footer-container">
        <div class="footer-brand">
          <span class="footer-logo">BeatSync</span>
          <span class="footer-copy">Synchronized multi-device audio playback.</span>
        </div>
        <div class="footer-links">
          <button class="footer-link-btn" (click)="openModal('community')">Community</button>
          <button class="footer-link-btn" (click)="openModal('github')">GitHub</button>
          <button class="footer-link-btn" (click)="openModal('about')">About</button>
        </div>
      </div>
    </footer>

    <!-- Info Modal -->
    @if (activeModal) {
      <div class="modal-backdrop" (click)="closeModal()">
        <div class="modal-card" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3>{{ modalTitle }}</h3>
            <button class="modal-close" (click)="closeModal()">×</button>
          </div>
          <div class="modal-body">
            @if (activeModal === 'community') {
              <p>BeatSync is an open learning project for synchronized real-time web audio.</p>
              <p>Connect multiple laptops, phones, and tablets to play music in perfect harmony!</p>
            } @else if (activeModal === 'github') {
              <p>Built with Angular 22 & ASP.NET Core 9 SignalR.</p>
              <p>Featuring sub-millisecond clock drift compensation, smooth playback rate adjustments, and clean separation of concerns.</p>
            } @else if (activeModal === 'about') {
              <p><strong>BeatSync Clone</strong></p>
              <p>A full-stack learning implementation inspired by the core interactions and synchronization patterns of BeatSync.</p>
              <p>Architecture: Angular Client → ASP.NET Core SignalR Web API → SQL Server LocalDB.</p>
            }
          </div>
          <div class="modal-footer">
            <button class="btn-close" (click)="closeModal()">Close</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .app-footer {
      border-top: 1px solid #e2e8f0;
      background: #ffffff;
      padding: 24px 0;
      margin-top: auto;
    }
    .footer-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
    }
    .footer-brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .footer-logo {
      font-weight: 700;
      color: #0f172a;
      font-size: 15px;
    }
    .footer-copy {
      color: #94a3b8;
      font-size: 13px;
    }
    .footer-links {
      display: flex;
      gap: 20px;
    }
    .footer-link-btn {
      background: none;
      border: none;
      color: #64748b;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      padding: 0;
      transition: color 0.15s ease;
    }
    .footer-link-btn:hover {
      color: #0f172a;
    }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.4);
      backdrop-filter: blur(4px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .modal-card {
      background: #ffffff;
      border-radius: 14px;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      overflow: hidden;
      border: 1px solid #e2e8f0;
      animation: modalIn 0.2s ease-out;
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid #f1f5f9;
    }
    .modal-header h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: #0f172a;
    }
    .modal-close {
      background: none;
      border: none;
      font-size: 20px;
      color: #94a3b8;
      cursor: pointer;
    }
    .modal-body {
      padding: 20px;
      font-size: 14px;
      color: #475569;
      line-height: 1.6;
    }
    .modal-body p {
      margin: 0 0 12px 0;
    }
    .modal-body p:last-child {
      margin-bottom: 0;
    }
    .modal-footer {
      padding: 12px 20px;
      background: #f8fafc;
      border-top: 1px solid #f1f5f9;
      display: flex;
      justify-content: flex-end;
    }
    .btn-close {
      padding: 6px 14px;
      background: #0f172a;
      color: #ffffff;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
    }
    @keyframes modalIn {
      from { transform: scale(0.95); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
  `]
})
export class FooterComponent {
  activeModal: 'community' | 'github' | 'about' | null = null;

  get modalTitle(): string {
    switch (this.activeModal) {
      case 'community': return 'BeatSync Community';
      case 'github': return 'BeatSync Source & Architecture';
      case 'about': return 'About BeatSync';
      default: return '';
    }
  }

  openModal(type: 'community' | 'github' | 'about'): void {
    this.activeModal = type;
  }

  closeModal(): void {
    this.activeModal = null;
  }
}
