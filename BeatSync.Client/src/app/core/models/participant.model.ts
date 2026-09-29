export interface Participant {
  id: number;
  roomId: number;
  username: string;
  connectionId: string;
  joinedAt: string;
  isHost: boolean;
  isConnected: boolean;
}
