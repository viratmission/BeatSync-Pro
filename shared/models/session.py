"""
BeatSync-Pro Data Models
"""

from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field
import time


class SessionState(BaseModel):
    sessionId: str = "default-session"
    roomToken: str = "BEAT123"
    roomId: str = "movie-night"
    
    videoId: Optional[str] = None
    videoName: Optional[str] = None
    videoUrl: Optional[str] = None
    fileSize: int = 0
    mimeType: str = "video/mp4"
    
    duration: float = 0.0
    currentTime: float = 0.0
    playing: bool = False
    playbackRate: float = 1.0
    
    sequence: int = 0
    masterTimestamp: float = Field(default_factory=lambda: time.time() * 1000)
    lastUpdated: float = Field(default_factory=lambda: time.time() * 1000)

    def current_estimated_time(self) -> float:
        """Calculate the live playback position based on master timestamp and playback rate."""
        if not self.playing:
            return self.currentTime
        now_ms = time.time() * 1000
        if now_ms < self.masterTimestamp:
            return self.currentTime
        elapsed_seconds = (now_ms - self.masterTimestamp) / 1000.0
        projected = self.currentTime + (elapsed_seconds * self.playbackRate)
        if self.duration > 0 and projected > self.duration:
            return self.duration
        return max(0.0, projected)


class ClientState(BaseModel):
    clientId: str
    deviceName: str = "Unknown Device"
    role: str = "receiver"  # "host" or "receiver"
    connected: bool = True
    ipAddress: Optional[str] = None
    
    latencyMs: float = 0.0
    clockOffsetMs: float = 0.0
    driftMs: float = 0.0
    calibrationOffsetMs: float = 0.0
    playbackState: str = "paused"  # "playing", "paused", "buffering", "ended"
    
    joinedAt: float = Field(default_factory=lambda: time.time() * 1000)
    lastSeen: float = Field(default_factory=lambda: time.time() * 1000)


class WSMessage(BaseModel):
    version: int = 1
    type: str
    roomId: Optional[str] = None
    clientId: Optional[str] = None
    token: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
    
    # Common flattened properties for convenience
    sequence: Optional[int] = None
    currentTime: Optional[float] = None
    position: Optional[float] = None
    startAt: Optional[float] = None
    playing: Optional[bool] = None
    playbackRate: Optional[float] = None
    masterTimestamp: Optional[float] = None
    serverTime: Optional[float] = None
    clientTime: Optional[float] = None
    
    # Metadata
    videoId: Optional[str] = None
    videoName: Optional[str] = None
    videoUrl: Optional[str] = None
    duration: Optional[float] = None
    
    # Telemetry
    deviceName: Optional[str] = None
    latencyMs: Optional[float] = None
    clockOffsetMs: Optional[float] = None
    driftMs: Optional[float] = None
    calibrationOffsetMs: Optional[float] = None
    playbackState: Optional[str] = None
    clients: Optional[List[Dict[str, Any]]] = None
    error: Optional[str] = None
