import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
  isDefault: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AudioDeviceService {
  private readonly devicesSubject = new BehaviorSubject<AudioOutputDevice[]>([]);
  public readonly devices$: Observable<AudioOutputDevice[]> = this.devicesSubject.asObservable();

  private readonly selectedDeviceSubject = new BehaviorSubject<string>('default');
  public readonly selectedDevice$: Observable<string> = this.selectedDeviceSubject.asObservable();

  private readonly useNativeSpeakersSubject = new BehaviorSubject<boolean>(true);
  public readonly useNativeSpeakers$: Observable<boolean> = this.useNativeSpeakersSubject.asObservable();

  private readonly isSupportedSubject = new BehaviorSubject<boolean>(false);
  public readonly isSupported$: Observable<boolean> = this.isSupportedSubject.asObservable();

  constructor() {
    this.checkSupport();
    this.initSavedSettings();
  }

  private checkSupport(): void {
    const supported = typeof window !== 'undefined' &&
      'mediaDevices' in navigator &&
      typeof navigator.mediaDevices.enumerateDevices === 'function' &&
      'setSinkId' in HTMLMediaElement.prototype;

    this.isSupportedSubject.next(supported);
    if (supported) {
      this.refreshDevices();
      navigator.mediaDevices.addEventListener('devicechange', () => this.refreshDevices());
    }
  }

  private initSavedSettings(): void {
    const saved = localStorage.getItem('beatsync_native_speakers');
    if (saved !== null) {
      this.useNativeSpeakersSubject.next(saved === 'true');
    }
  }

  public setUseNativeSpeakers(useNative: boolean): void {
    this.useNativeSpeakersSubject.next(useNative);
    localStorage.setItem('beatsync_native_speakers', useNative.toString());
  }

  public async refreshDevices(): Promise<void> {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const outputDevices = allDevices
        .filter(d => d.kind === 'audiooutput')
        .map((d, index) => ({
          deviceId: d.deviceId,
          label: d.label || `Speaker / Output ${index + 1}`,
          isDefault: d.deviceId === 'default'
        }));

      this.devicesSubject.next(outputDevices);
    } catch (e) {
      console.warn('Unable to enumerate audio output devices:', e);
    }
  }

  public selectDevice(deviceId: string): void {
    this.selectedDeviceSubject.next(deviceId);
  }
}
