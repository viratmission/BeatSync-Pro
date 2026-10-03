"""
BeatSync-Pro Shared Session Data Models.

These models are intentionally kept as data models.

Authoritative playback-time calculations belong to:

    backend.sync.session.SessionManager

The SessionState model therefore stores the timeline anchor but does
not attempt to maintain its own independent wall-clock timeline.
"""

from typing import Optional, Dict, Any, List

from pydantic import BaseModel, Field


PROTOCOL_VERSION = 2


class SessionState(BaseModel):
    sessionId: str = "default-session"
    roomToken: str = "BEAT123"
    roomId: str = "movie-night"

    # --------------------------------------------------------------
    # Media
    # --------------------------------------------------------------

    videoId: Optional[str] = None
    videoName: Optional[str] = None
    videoUrl: Optional[str] = None

    fileSize: int = 0
    mimeType: str = "video/mp4"

    duration: float = 0.0

    # --------------------------------------------------------------
    # Authoritative playback timeline
    # --------------------------------------------------------------

    # Position at masterTimestamp.
    currentTime: float = 0.0

    playing: bool = False

    playbackRate: float = 1.0

    # Monotonically increasing session command/state sequence.
    sequence: int = 0

    # Epoch-compatible authoritative timestamp in milliseconds.
    masterTimestamp: float = Field(default=0.0)

    # Last time this state was modified, milliseconds.
    lastUpdated: float = Field(default=0.0)


class ClientState(BaseModel):
    clientId: str

    deviceName: str = "Unknown Device"

    # "host" or "receiver"
    role: str = "receiver"

    connected: bool = True

    ipAddress: Optional[str] = None

    # --------------------------------------------------------------
    # Synchronization telemetry
    # --------------------------------------------------------------

    latencyMs: float = 0.0

    clockOffsetMs: float = 0.0

    driftMs: float = 0.0

    calibrationOffsetMs: float = 0.0

    # "playing", "paused", "buffering", "ended"
    playbackState: str = "paused"

    joinedAt: float = Field(default=0.0)

    lastSeen: float = Field(default=0.0)


class WSMessage(BaseModel):
    """
    Shared WebSocket message schema.

    The backend currently accepts additional JSON fields when they are
    handled by the WebSocket manager, while these fields provide the
    common protocol structure.
    """

    version: int = PROTOCOL_VERSION

    type: str

    roomId: Optional[str] = None

    clientId: Optional[str] = None

    token: Optional[str] = None

    payload: Optional[Dict[str, Any]] = None

    # --------------------------------------------------------------
    # Timeline
    # --------------------------------------------------------------

    sequence: Optional[int] = None

    currentTime: Optional[float] = None

    position: Optional[float] = None

    startAt: Optional[float] = None

    playing: Optional[bool] = None

    playbackRate: Optional[float] = None

    masterTimestamp: Optional[float] = None

    serverTime: Optional[float] = None

    clientTime: Optional[float] = None

    estimatedPosition: Optional[float] = None

    # --------------------------------------------------------------
    # Media metadata
    # --------------------------------------------------------------

    videoId: Optional[str] = None

    videoName: Optional[str] = None

    videoUrl: Optional[str] = None

    duration: Optional[float] = None

    fileSize: Optional[int] = None

    mimeType: Optional[str] = None

    # --------------------------------------------------------------
    # Device
    # --------------------------------------------------------------

    deviceName: Optional[str] = None

    role: Optional[str] = None

    # --------------------------------------------------------------
    # Telemetry
    # --------------------------------------------------------------

    latencyMs: Optional[float] = None

    clockOffsetMs: Optional[float] = None

    driftMs: Optional[float] = None

    calibrationOffsetMs: Optional[float] = None

    playbackState: Optional[str] = None

    clients: Optional[List[Dict[str, Any]]] = None

    # --------------------------------------------------------------
    # Error handling
    # --------------------------------------------------------------

    error: Optional[str] = None