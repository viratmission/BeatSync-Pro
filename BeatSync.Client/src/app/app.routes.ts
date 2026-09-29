import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { RoomComponent } from './pages/room/room.component';
import { LoginComponent } from './pages/login/login.component';
import { ProfileComponent } from './pages/profile/profile.component';

export const routes: Routes = [
  { path: '', component: HomeComponent, title: 'BeatSync - Real-time Audio Synchronization' },
  { path: 'room/:roomCode', component: RoomComponent, title: 'BeatSync Room' },
  { path: 'login', component: LoginComponent, title: 'Login - BeatSync' },
  { path: 'profile', component: ProfileComponent, title: 'Profile - BeatSync' },
  { path: '**', redirectTo: '' }
];
