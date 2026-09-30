export interface Participant {
  id: number;
  roomId: number;
  username: string;
  connectionId: string;
  joinedAt: string;
  isHost: boolean;
  isConnected: boolean;
  deviceRole?: 'HostVideo' | 'AudioSpeaker';
  devicePosition?: string;
  deviceName?: string;
  volume?: number;
  isMuted?: boolean;
}
