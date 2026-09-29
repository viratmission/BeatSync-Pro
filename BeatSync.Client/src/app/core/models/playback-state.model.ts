export interface PlaybackState {
  trackId: number;
  isPlaying: boolean;
  currentPosition: number;
  serverTimestamp: number;
  playbackRate: number;
  updatedBy?: string;
}
