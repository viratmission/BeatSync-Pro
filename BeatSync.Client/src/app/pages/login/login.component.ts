import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { UserService } from '../../core/services/user.service';
import { ToastService } from '../../core/services/toast.service';
import { HeaderComponent } from '../../shared/components/header/header.component';
import { FooterComponent } from '../../shared/components/footer/footer.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, HeaderComponent, FooterComponent],
  template: `
    <div class="page-layout">
      <app-header></app-header>
      <main class="login-main">
        <div class="login-card">
          <h2>Sign In to BeatSync</h2>
          <p class="subtitle">Access your custom playlists, saved rooms, and audio preferences.</p>

          <form (submit)="onSubmit($event)" class="login-form">
            <div class="form-group">
              <label>Username / Display Name</label>
              <input
                type="text"
                [(ngModel)]="username"
                name="username"
                placeholder="e.g. productive-eagle"
                required
                class="form-input"
              />
            </div>

            <div class="form-group">
              <label>Password (Optional for Demo)</label>
              <input
                type="password"
                [(ngModel)]="password"
                name="password"
                placeholder="••••••••"
                class="form-input"
              />
            </div>

            <button type="submit" class="btn-submit">
              Sign In
            </button>
          </form>

          <div class="login-footer">
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
    .login-main {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
    }
    .login-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.05);
      max-width: 420px;
      width: 100%;
      padding: 32px;
    }
    h2 {
      margin: 0 0 8px 0;
      font-size: 22px;
      color: #0f172a;
    }
    .subtitle {
      font-size: 14px;
      color: #64748b;
      margin: 0 0 24px 0;
    }
    .login-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    label {
      font-size: 13px;
      font-weight: 500;
      color: #475569;
    }
    .form-input {
      height: 44px;
      padding: 0 14px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
    }
    .form-input:focus {
      border-color: #0f172a;
    }
    .btn-submit {
      height: 44px;
      background: #0f172a;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 8px;
    }
    .login-footer {
      margin-top: 20px;
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
export class LoginComponent {
  private readonly userService = inject(UserService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);

  username = '';
  password = '';

  constructor() {
    this.username = this.userService.currentUsername;
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    if (this.username.trim().length > 0) {
      this.userService.setUsername(this.username.trim());
      this.toastService.success(`Welcome back, ${this.username}!`);
      this.router.navigate(['/']);
    }
  }
}
