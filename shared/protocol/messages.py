"""
BeatSync-Pro Protocol Definitions and Message Schemas.
Version: 1
"""

from enum import Enum


class MessageType(str, Enum):
    # Connection & Session
    JOIN = "join"
    HOST = "host"
    WELCOME = "welcome"
    SESSION_STATE = "session-state"
    CLIENT_LIST = "client-list"
    ERROR = "error"

    # Playback Commands
    PLAY = "play"
    PAUSE = "pause"
    SEEK = "seek"
    STOP = "stop"
    SET_RATE = "setRate"
    LOAD = "load"
    UNLOAD = "unload"

    # Synchronization & Clocks
    SYNC = "sync"
    CLOCK_PING = "clock-ping"
    CLOCK_PONG = "clock-pong"
    TELEMETRY = "telemetry"

    # Heartbeat
    PING = "ping"
    PONG = "pong"

    # Optional Offline WebRTC Fallback
    WEBRTC_OFFER = "webrtc-offer"
    WEBRTC_ANSWER = "webrtc-answer"
    WEBRTC_CANDIDATE = "webrtc-candidate"


PROTOCOL_VERSION = 1
DEFAULT_PORT = 8080
DEFAULT_ROOM_ID = "movie-night"
SYNC_INTERVAL_MS = 400
HEARTBEAT_INTERVAL_MS = 2500
CLIENT_TIMEOUT_MS = 8000

# High-Precision Audio Drift Thresholds in Seconds
DRIFT_THRESHOLD_PERFECT = 0.020   # < 20ms: inaudible echo boundary, rate = 1.0x
DRIFT_THRESHOLD_FINE = 0.080      # 20ms - 80ms: micro-rate adjust (0.97x - 1.03x)
DRIFT_THRESHOLD_MODERATE = 0.300  # 80ms - 300ms: continuous catch-up rate (0.90x - 1.10x)
DRIFT_THRESHOLD_SEEK = 0.800      # 300ms - 800ms: rapid catch-up rate (0.84x - 1.16x)
                                  # >= 800ms: hard audio seek (scrub/jump only)

