"""
BeatSync-Pro Protocol Definitions and Message Schemas.

Protocol version 2.

This module contains the shared protocol constants used by:

    - Backend
    - Host
    - Receiver
    - WebSocket signaling
    - Synchronization engine
    - WebRTC signaling

IMPORTANT:
Keep these constants available because older modules may import them
directly from shared.protocol.messages.
"""

from enum import Enum


# ============================================================
# Message Types
# ============================================================

class MessageType(str, Enum):
    """
    All WebSocket protocol message types.
    """

    # Connection / session
    JOIN = "join"
    HOST = "host"
    WELCOME = "welcome"
    SESSION_STATE = "session-state"
    CLIENT_LIST = "client-list"
    ERROR = "error"

    # Playback commands
    PLAY = "play"
    PAUSE = "pause"
    SEEK = "seek"
    STOP = "stop"
    SET_RATE = "setRate"

    # Media
    LOAD = "load"
    UNLOAD = "unload"

    # Synchronization
    SYNC = "sync"
    CLOCK_PING = "clock-ping"
    CLOCK_PONG = "clock-pong"
    TELEMETRY = "telemetry"
    CALIBRATE = "calibrate"

    # Heartbeat
    PING = "ping"
    PONG = "pong"

    # WebRTC signaling
    WEBRTC_OFFER = "webrtc-offer"
    WEBRTC_ANSWER = "webrtc-answer"
    WEBRTC_CANDIDATE = "webrtc-candidate"


# ============================================================
# Protocol
# ============================================================

PROTOCOL_VERSION = 2


# ============================================================
# Server / Network Defaults
# ============================================================

DEFAULT_PORT = 8080

DEFAULT_ROOM_ID = "movie-night"

DEFAULT_ROOM_TOKEN = "BEAT123"


# ============================================================
# Synchronization Timing
# ============================================================

SYNC_INTERVAL_MS = 400

HEARTBEAT_INTERVAL_MS = 2500

CLIENT_TIMEOUT_MS = 8000

DEFAULT_START_LEAD_MS = 700


# ============================================================
# Drift Correction Thresholds
# ============================================================

# Practically synchronized.
# No correction is normally required.
DRIFT_THRESHOLD_PERFECT = 0.020


# Small drift.
# Apply gentle playback-rate correction.
DRIFT_THRESHOLD_FINE = 0.080


# Medium drift.
# Apply stronger correction.
DRIFT_THRESHOLD_MODERATE = 0.300


# Large drift.
# Rapid correction should be used.
DRIFT_THRESHOLD_RAPID = 0.500


# Very large drift.
# Perform a hard seek/resynchronization.
DRIFT_THRESHOLD_SEEK = 0.800


# ============================================================
# Feature Flags
# ============================================================

FEATURE_AUTHORITATIVE_TIMELINE = True

FEATURE_CLOCK_SYNC = True

FEATURE_DRIFT_CORRECTION = True

FEATURE_HARD_RESYNC = True

FEATURE_CALIBRATION = True

FEATURE_WEBRTC_FALLBACK = True


# ============================================================
# WebRTC
# ============================================================

# Offline LAN mode intentionally does not require
# STUN/TURN servers.

WEBRTC_OFFLINE_MODE = True

WEBRTC_USE_STUN = False

WEBRTC_USE_TURN = False


# ============================================================
# Protocol Metadata
# ============================================================

PROTOCOL_NAME = "BeatSync-Pro"

PROTOCOL_MODE = "offline-lan"


# ============================================================
# Public Exports
# ============================================================

__all__ = [
    # Message types
    "MessageType",

    # Protocol
    "PROTOCOL_VERSION",

    # Network
    "DEFAULT_PORT",
    "DEFAULT_ROOM_ID",
    "DEFAULT_ROOM_TOKEN",

    # Timing
    "SYNC_INTERVAL_MS",
    "HEARTBEAT_INTERVAL_MS",
    "CLIENT_TIMEOUT_MS",
    "DEFAULT_START_LEAD_MS",

    # Drift
    "DRIFT_THRESHOLD_PERFECT",
    "DRIFT_THRESHOLD_FINE",
    "DRIFT_THRESHOLD_MODERATE",
    "DRIFT_THRESHOLD_RAPID",
    "DRIFT_THRESHOLD_SEEK",

    # Features
    "FEATURE_AUTHORITATIVE_TIMELINE",
    "FEATURE_CLOCK_SYNC",
    "FEATURE_DRIFT_CORRECTION",
    "FEATURE_HARD_RESYNC",
    "FEATURE_CALIBRATION",
    "FEATURE_WEBRTC_FALLBACK",

    # WebRTC
    "WEBRTC_OFFLINE_MODE",
    "WEBRTC_USE_STUN",
    "WEBRTC_USE_TURN",

    # Metadata
    "PROTOCOL_NAME",
    "PROTOCOL_MODE",
]