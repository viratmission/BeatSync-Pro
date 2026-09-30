import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { RoomComponent } from './pages/room/room.component';
import { LoginComponent } from './pages/login/login.component';
import { ProfileComponent } from './pages/profile/profile.component';
import { CinemaHostComponent } from './pages/cinema-host/cinema-host.component';
import { CinemaDeviceComponent } from './pages/cinema-device/cinema-device.component';

export const routes: Routes = [
  { path: '', component: HomeComponent, title: 'BeatSync - Real-time Audio Synchronization' },
  { path: 'room/:roomCode', component: RoomComponent, title: 'BeatSync Room' },
  { path: 'cinema/host/:roomCode', component: CinemaHostComponent, title: 'BeatSync Cinema - Master Host' },
  { path: 'cinema/device/:roomCode', component: CinemaDeviceComponent, title: 'BeatSync Cinema - Surround Speaker' },
  { path: 'login', component: LoginComponent, title: 'Login - BeatSync' },
  { path: 'profile', component: ProfileComponent, title: 'Profile - BeatSync' },
  { path: '**', redirectTo: '' }
];

