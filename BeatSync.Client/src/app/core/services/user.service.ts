import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

const ADJECTIVES = [
  'productive', 'clever', 'silent', 'happy', 'cosmic',
  'brave', 'swift', 'gentle', 'lively', 'stellar',
  'neon', 'electric', 'vivid', 'calm', 'daring',
  'radiant', 'nimble', 'witty', 'bold', 'mystic'
];

const ANIMALS = [
  'eagle', 'tiger', 'wolf', 'panda', 'falcon',
  'otter', 'fox', 'koala', 'dolphin', 'owl',
  'panther', 'hawk', 'lion', 'badger', 'lynx',
  'cheetah', 'bear', 'sparrow', 'whale', 'phoenix'
];

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private readonly usernameSubject = new BehaviorSubject<string>('');
  public readonly username$: Observable<string> = this.usernameSubject.asObservable();

  constructor() {
    this.initUsername();
  }

  private initUsername(): void {
    const saved = localStorage.getItem('beatsync_username');
    if (saved && saved.trim().length > 0) {
      this.usernameSubject.next(saved.trim());
    } else {
      const generated = this.generateRandomUsername();
      this.setUsername(generated);
    }
  }

  public get currentUsername(): string {
    return this.usernameSubject.value;
  }

  public setUsername(username: string): void {
    const trimmed = username.trim();
    this.usernameSubject.next(trimmed);
    localStorage.setItem('beatsync_username', trimmed);
  }

  public regenerateUsername(): string {
    const newUsername = this.generateRandomUsername();
    this.setUsername(newUsername);
    return newUsername;
  }

  private generateRandomUsername(): string {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    return `${adj}-${animal}`;
  }
}
