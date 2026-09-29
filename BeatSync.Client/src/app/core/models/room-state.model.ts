import { Room } from './room.model';
import { Participant } from './participant.model';
import { Track } from './track.model';
import { PlaybackState } from './playback-state.model';

export interface RoomState {
  room: Room;
  participants: Participant[];
  currentTrack?: Track;
  playbackState: PlaybackState;
  availableTracks: Track[];
}
