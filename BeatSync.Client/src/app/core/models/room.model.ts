export interface Room {
  id: number;
  roomCode: string;
  name: string;
  hostUserId: string;
  createdAt: string;
  isActive: boolean;
  participantCount?: number;
}

export interface CreateRoomRequest {
  name?: string;
  hostUsername: string;
}

export interface JoinRoomRequest {
  roomCode: string;
  username: string;
}
