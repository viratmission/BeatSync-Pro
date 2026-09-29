import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface ToastMessage {
  id: string;
  type: 'success' | 'info' | 'warning' | 'error';
  message: string;
  duration?: number;
}

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  private readonly toastsSubject = new BehaviorSubject<ToastMessage[]>([]);
  public readonly toasts$: Observable<ToastMessage[]> = this.toastsSubject.asObservable();

  public show(message: string, type: 'success' | 'info' | 'warning' | 'error' = 'info', duration = 3500): void {
    const id = Math.random().toString(36).substring(2, 9);
    const toast: ToastMessage = { id, type, message, duration };

    const current = this.toastsSubject.value;
    this.toastsSubject.next([...current, toast]);

    if (duration > 0) {
      setTimeout(() => {
        this.dismiss(id);
      }, duration);
    }
  }

  public success(message: string): void {
    this.show(message, 'success');
  }

  public info(message: string): void {
    this.show(message, 'info');
  }

  public warning(message: string): void {
    this.show(message, 'warning');
  }

  public error(message: string): void {
    this.show(message, 'error', 4500);
  }

  public dismiss(id: string): void {
    const filtered = this.toastsSubject.value.filter(t => t.id !== id);
    this.toastsSubject.next(filtered);
  }
}
