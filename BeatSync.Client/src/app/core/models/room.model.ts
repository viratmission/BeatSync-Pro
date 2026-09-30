export interface Room {
  id: number;
  roomCode: string;
  name: string;
  hostUserId: string;
  createdAt: string;
  isActive: boolean;
  participantCount?: number;
  roomMode?: 'AudioSync' | 'Cinema';
  mediaTitle?: string;
  mediaDuration?: number;
  mediaType?: string;
}

export interface CreateRoomRequest {
  name?: string;
  hostUsername: string;
  roomMode?: 'AudioSync' | 'Cinema';
  mediaTitle?: string;
  mediaDuration?: number;
}

export interface JoinRoomRequest {
  roomCode: string;
  username: string;
  deviceRole?: string;
  devicePosition?: string;
}
