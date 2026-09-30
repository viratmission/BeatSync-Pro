export type DevicePosition =
  | 'FrontLeft'
  | 'FrontCenter'
  | 'FrontRight'
  | 'SurroundLeft'
  | 'SurroundRight'
  | 'RearLeft'
  | 'RearCenter'
  | 'RearRight';

export interface DevicePositionOption {
  id: DevicePosition;
  label: string;
  shortLabel: string;
  icon: string;
  description: string;
  defaultChannelAngle?: number;
}

export const DEVICE_POSITIONS: DevicePositionOption[] = [
  { id: 'FrontLeft', label: 'Front Left', shortLabel: 'FL', icon: '↖️', description: 'Placed in front of the audience, to the left' },
  { id: 'FrontCenter', label: 'Front Center', shortLabel: 'FC', icon: '⬆️', description: 'Directly in front, dialogue / center stage' },
  { id: 'FrontRight', label: 'Front Right', shortLabel: 'FR', icon: '↗️', description: 'Placed in front of the audience, to the right' },
  { id: 'SurroundLeft', label: 'Surround Left', shortLabel: 'SL', icon: '⬅️', description: 'Directly to the left of the seating area' },
  { id: 'SurroundRight', label: 'Surround Right', shortLabel: 'SR', icon: '➡️', description: 'Directly to the right of the seating area' },
  { id: 'RearLeft', label: 'Rear Left', shortLabel: 'RL', icon: '↙️', description: 'Behind the audience on the left side' },
  { id: 'RearCenter', label: 'Rear Center', shortLabel: 'RC', icon: '⬇️', description: 'Directly behind the audience center' },
  { id: 'RearRight', label: 'Rear Right', shortLabel: 'RR', icon: '↘️', description: 'Behind the audience on the right side' }
];

export interface CinemaPlaybackCommand {
  commandType: 'Play' | 'Pause' | 'Seek' | 'Rate' | 'LoadMedia';
  position: number;
  playbackRate?: number;
  serverTimestamp?: number;
  scheduledPlayTime?: number;
  sequence?: number;
  mediaTitle?: string;
  mediaDuration?: number;
  updatedBy?: string;
}

export interface DevicePositionUpdate {
  connectionId?: string;
  username?: string;
  devicePosition: string;
  volume: number;
  isMuted: boolean;
  deviceName?: string;
}

export interface DeviceSyncReport {
  connectionId?: string;
  username?: string;
  devicePosition?: string;
  driftMs: number;
  rtt: number;
  clockOffset: number;
  playbackRate: number;
  syncStatus: 'Excellent' | 'Good' | 'Realigning' | 'Desynced';
  lastSyncTime?: number;
}

export interface WebRtcSignal {
  senderConnectionId?: string;
  senderUsername?: string;
  targetConnectionId?: string;
  signalType: 'offer' | 'answer' | 'candidate' | 'ready';
  data: string;
}
