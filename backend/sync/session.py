"""
Authoritative Session Manager for BeatSync-Pro.
Owns the master playback timeline, media metadata, and sequence ordering.
"""

import time
import logging
from typing import Optional, Dict, Any
from shared.models.session import SessionState
from backend.sync.clock import MasterClock

logger = logging.getLogger("BeatSync.Session")


class SessionManager:
    def __init__(self, room_token: str, room_id: str = "movie-night"):
        self.state = SessionState(
            sessionId=f"sess-{int(time.time())}",
            roomToken=room_token,
            roomId=room_id,
            duration=0.0,
            currentTime=0.0,
            playing=False,
            playbackRate=1.0,
            sequence=1,
            masterTimestamp=MasterClock.now_ms()
        )

    def get_state(self) -> SessionState:
        # Update currentTime to estimated time if playing
        current_est = self.state.current_estimated_time()
        # Return a copy with live estimate
        state_dict = self.state.model_dump()
        state_dict["currentTime"] = round(current_est, 3)
        return SessionState(**state_dict)

    def load_video(self, video_id: str, video_name: str, video_url: str, duration: float = 0.0, file_size: int = 0, mime_type: str = "video/mp4") -> SessionState:
        self.state.videoId = video_id
        self.state.videoName = video_name
        self.state.videoUrl = video_url
        self.state.duration = duration
        self.state.fileSize = file_size
        self.state.mimeType = mime_type
        self.state.currentTime = 0.0
        self.state.playing = False
        self.state.sequence += 1
        self.state.masterTimestamp = MasterClock.now_ms()
        self.state.lastUpdated = self.state.masterTimestamp
        logger.info(f"Video loaded: {video_name} (ID: {video_id}, Duration: {duration}s)")
        return self.get_state()

    def unload_video(self) -> SessionState:
        self.state.videoId = None
        self.state.videoName = None
        self.state.videoUrl = None
        self.state.duration = 0.0
        self.state.currentTime = 0.0
        self.state.playing = False
        self.state.sequence += 1
        self.state.masterTimestamp = MasterClock.now_ms()
        self.state.lastUpdated = self.state.masterTimestamp
        logger.info("Video unloaded")
        return self.get_state()

    def play(self, position: Optional[float] = None, start_at: Optional[float] = None) -> SessionState:
        now = MasterClock.now_ms()
        if position is not None and position >= 0:
            self.state.currentTime = max(0.0, position)
        else:
            self.state.currentTime = self.state.current_estimated_time()
        
        self.state.playing = True
        self.state.sequence += 1
        self.state.masterTimestamp = start_at if start_at is not None else now
        self.state.lastUpdated = now
        logger.info(f"Playback started at position {self.state.currentTime:.2f}s, startAt: {self.state.masterTimestamp}")
        return self.get_state()

    def pause(self, position: Optional[float] = None) -> SessionState:
        now = MasterClock.now_ms()
        if position is not None and position >= 0:
            self.state.currentTime = max(0.0, position)
        else:
            self.state.currentTime = self.state.current_estimated_time()
        
        self.state.playing = False
        self.state.sequence += 1
        self.state.masterTimestamp = now
        self.state.lastUpdated = now
        logger.info(f"Playback paused at position {self.state.currentTime:.2f}s")
        return self.get_state()

    def seek(self, position: float) -> SessionState:
        now = MasterClock.now_ms()
        self.state.currentTime = max(0.0, position)
        if self.state.duration > 0 and self.state.currentTime > self.state.duration:
            self.state.currentTime = self.state.duration
            
        self.state.sequence += 1
        self.state.masterTimestamp = now
        self.state.lastUpdated = now
        logger.info(f"Playback seeked to position {self.state.currentTime:.2f}s (playing: {self.state.playing})")
        return self.get_state()

    def set_rate(self, rate: float) -> SessionState:
        now = MasterClock.now_ms()
        # Freeze current position before changing rate
        self.state.currentTime = self.state.current_estimated_time()
        self.state.playbackRate = max(0.25, min(4.0, rate))
        self.state.sequence += 1
        self.state.masterTimestamp = now
        self.state.lastUpdated = now
        logger.info(f"Playback rate changed to {self.state.playbackRate}x")
        return self.get_state()

    def update_from_host(self, current_time: float, playing: bool, playback_rate: float = 1.0, master_timestamp: Optional[float] = None) -> SessionState:
        """Update authoritative state directly from master host's live video player."""
        now = MasterClock.now_ms()
        self.state.currentTime = max(0.0, current_time)
        self.state.playing = playing
        self.state.playbackRate = playback_rate
        self.state.masterTimestamp = master_timestamp if (master_timestamp and master_timestamp > 0) else now
        self.state.lastUpdated = now
        return self.get_state()

    def get_sync_payload(self) -> Dict[str, Any]:
        """Generate high-precision sync packet for broadcast."""
        curr = self.state.current_estimated_time()
        now = MasterClock.now_ms()
        return {
            "version": 1,
            "type": "sync",
            "sequence": self.state.sequence,
            "currentTime": round(curr, 3),
            "playing": self.state.playing,
            "playbackRate": self.state.playbackRate,
            "masterTimestamp": self.state.masterTimestamp,
            "serverTime": now,
            "videoId": self.state.videoId,
            "videoName": self.state.videoName,
            "duration": self.state.duration
        }
