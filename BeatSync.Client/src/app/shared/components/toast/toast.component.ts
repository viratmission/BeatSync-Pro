import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-container" aria-live="polite">
      @for (toast of toastService.toasts$ | async; track toast.id) {
        <div class="toast-item" [ngClass]="toast.type" (click)="toastService.dismiss(toast.id)">
          <div class="toast-indicator"></div>
          <span class="toast-message">{{ toast.message }}</span>
          <button class="toast-close" (click)="toastService.dismiss(toast.id)" aria-label="Close notification">×</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 380px;
      pointer-events: none;
    }
    .toast-item {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05);
      font-size: 14px;
      color: #1e293b;
      cursor: pointer;
      animation: slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .toast-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .toast-item.success .toast-indicator { background-color: #10b981; }
    .toast-item.error .toast-indicator { background-color: #ef4444; }
    .toast-item.warning .toast-indicator { background-color: #f59e0b; }
    .toast-item.info .toast-indicator { background-color: #3b82f6; }

    .toast-message {
      flex: 1;
      font-weight: 500;
      line-height: 1.4;
    }
    .toast-close {
      background: none;
      border: none;
      font-size: 18px;
      color: #94a3b8;
      cursor: pointer;
      padding: 0 4px;
      line-height: 1;
    }
    .toast-close:hover {
      color: #475569;
    }
    @keyframes slideIn {
      from {
        transform: translateY(12px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }
  `]
})
export class ToastComponent {
  protected readonly toastService = inject(ToastService);
}
