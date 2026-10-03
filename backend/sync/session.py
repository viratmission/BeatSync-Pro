# ```python
"""
BeatSync-Pro Authoritative Playback Session.

The server owns the authoritative playback timeline.

Timeline model:

    position =
        anchor_position
        +
        (authoritative_now - anchor_timestamp)
        * playback_rate

The anchor changes only when playback state changes:

- play
- pause
- seek
- playback-rate change
- media load/unload
- host-authoritative correction

Important:
    get_state() is NON-MUTATING.

This is critical because a PLAY command may contain a future
startAt timestamp. get_state() must never destroy that scheduled
timestamp by re-anchoring the timeline immediately.
"""

import time
import logging
from typing import Optional, Dict, Any

from shared.models.session import SessionState
from backend.sync.clock import MasterClock


logger = logging.getLogger("BeatSync.Session")

PROTOCOL_VERSION = 2
DEFAULT_START_LEAD_MS = 700.0

# Default offline LAN room configuration.
DEFAULT_ROOM_TOKEN = "BEAT123"
DEFAULT_ROOM_ID = "movie-night"


class SessionManager:

    def __init__(
        self,
        room_token: str,
        room_id: str = DEFAULT_ROOM_ID,
    ):
        now = MasterClock.now_ms()

        self.state = SessionState(
            sessionId=f"sess-{int(time.time())}",
            roomToken=room_token,
            roomId=room_id,
            duration=0.0,
            currentTime=0.0,
            playing=False,
            playbackRate=1.0,
            sequence=1,
            masterTimestamp=now,
            lastUpdated=now,
        )

    # ---------------------------------------------------------
    # CLOCK
    # ---------------------------------------------------------

    def _now(self) -> float:
        return MasterClock.now_ms()

    # ---------------------------------------------------------
    # AUTHORITATIVE POSITION
    # ---------------------------------------------------------

    def _calculate_position(
        self,
        now: Optional[float] = None,
    ) -> float:

        if now is None:
            now = self._now()

        anchor_position = max(
            0.0,
            float(self.state.currentTime),
        )

        # Paused timeline does not advance.
        if not self.state.playing:
            return anchor_position

        anchor_timestamp = float(
            self.state.masterTimestamp
        )

        # Future scheduled playback.
        #
        # Example:
        #   now     = 10000
        #   startAt = 10700
        #
        # Position remains at the anchor until startAt.

        if now <= anchor_timestamp:
            return anchor_position

        elapsed_seconds = (
            now - anchor_timestamp
        ) / 1000.0

        position = (
            anchor_position
            +
            (
                elapsed_seconds
                * float(self.state.playbackRate)
            )
        )

        # Never exceed known duration.
        if self.state.duration > 0:
            position = min(
                position,
                float(self.state.duration),
            )

        return max(0.0, position)

    # ---------------------------------------------------------
    # STATE SNAPSHOT
    # ---------------------------------------------------------

    def get_state(self) -> SessionState:
        """
        Return a current session snapshot.

        IMPORTANT:
        This method does NOT mutate self.state.

        If playback is already running, the returned snapshot is
        re-anchored to 'now' so a newly connected receiver can
        immediately calculate the correct position.

        If playback is scheduled for the future, the original
        future masterTimestamp is preserved.
        """

        now = self._now()

        state_dict = self.state.model_dump()

        if (
            self.state.playing
            and self.state.masterTimestamp <= now
        ):
            current_position = self._calculate_position(now)

            state_dict["currentTime"] = round(
                float(current_position),
                6,
            )

            state_dict["masterTimestamp"] = round(
                float(now),
                3,
            )

        else:
            # Paused OR future scheduled playback.
            state_dict["currentTime"] = round(
                float(self.state.currentTime),
                6,
            )

            state_dict["masterTimestamp"] = round(
                float(self.state.masterTimestamp),
                3,
            )

        state_dict["lastUpdated"] = round(
            float(self.state.lastUpdated),
            3,
        )

        return SessionState(**state_dict)

    # ---------------------------------------------------------
    # LOAD VIDEO
    # ---------------------------------------------------------

    def load_video(
        self,
        video_id: str,
        video_name: str,
        video_url: str,
        duration: float = 0.0,
        file_size: int = 0,
        mime_type: str = "video/mp4",
    ) -> SessionState:

        now = self._now()

        self.state.videoId = video_id
        self.state.videoName = video_name
        self.state.videoUrl = video_url

        self.state.duration = max(
            0.0,
            float(duration),
        )

        self.state.fileSize = max(
            0,
            int(file_size),
        )

        self.state.mimeType = mime_type

        self.state.currentTime = 0.0
        self.state.playing = False
        self.state.playbackRate = 1.0

        self.state.sequence += 1

        self.state.masterTimestamp = now
        self.state.lastUpdated = now

        logger.info(
            "Video loaded: %s "
            "(ID: %s, Duration: %.3fs)",
            video_name,
            video_id,
            self.state.duration,
        )

        return self.get_state()

    # ---------------------------------------------------------
    # UNLOAD VIDEO
    # ---------------------------------------------------------

    def unload_video(self) -> SessionState:

        now = self._now()

        self.state.videoId = None
        self.state.videoName = None
        self.state.videoUrl = None

        self.state.fileSize = 0
        self.state.mimeType = "video/mp4"

        self.state.duration = 0.0
        self.state.currentTime = 0.0

        self.state.playing = False
        self.state.playbackRate = 1.0

        self.state.sequence += 1

        self.state.masterTimestamp = now
        self.state.lastUpdated = now

        logger.info("Video unloaded")

        return self.get_state()

    # ---------------------------------------------------------
    # PLAY
    # ---------------------------------------------------------

    def play(
        self,
        position: Optional[float] = None,
        start_at: Optional[float] = None,
    ) -> SessionState:

        now = self._now()

        # Use supplied position.
        if position is not None:
            position = max(
                0.0,
                float(position),
            )

        # Otherwise continue from current authoritative position.
        else:
            position = self._calculate_position(now)

        # Clamp to duration.
        if self.state.duration > 0:
            position = min(
                position,
                float(self.state.duration),
            )

        # If caller did not provide a start timestamp,
        # schedule playback slightly in the future.
        if start_at is None:
            start_at = (
                now
                +
                DEFAULT_START_LEAD_MS
            )

        start_at = max(
            float(start_at),
            now,
        )

        self.state.currentTime = position
        self.state.playing = True

        self.state.sequence += 1

        # IMPORTANT:
        # Preserve the future startAt.
        self.state.masterTimestamp = start_at

        self.state.lastUpdated = now

        logger.info(
            "Playback scheduled: "
            "position=%.6fs "
            "startAt=%.3f "
            "sequence=%d",
            position,
            start_at,
            self.state.sequence,
        )

        return self.get_state()

    # ---------------------------------------------------------
    # PAUSE
    # ---------------------------------------------------------

    def pause(
        self,
        position: Optional[float] = None,
    ) -> SessionState:

        now = self._now()

        if position is not None:
            position = max(
                0.0,
                float(position),
            )

        else:
            position = self._calculate_position(now)

        if self.state.duration > 0:
            position = min(
                position,
                float(self.state.duration),
            )

        self.state.currentTime = position
        self.state.playing = False

        self.state.sequence += 1

        self.state.masterTimestamp = now
        self.state.lastUpdated = now

        logger.info(
            "Playback paused at %.6fs",
            position,
        )

        return self.get_state()

    # ---------------------------------------------------------
    # SEEK
    # ---------------------------------------------------------

    def seek(
        self,
        position: float,
    ) -> SessionState:

        now = self._now()

        position = max(
            0.0,
            float(position),
        )

        if self.state.duration > 0:
            position = min(
                position,
                float(self.state.duration),
            )

        self.state.currentTime = position

        self.state.sequence += 1

        self.state.masterTimestamp = now
        self.state.lastUpdated = now

        logger.info(
            "Playback seeked to %.6fs "
            "(playing=%s)",
            position,
            self.state.playing,
        )

        return self.get_state()

    # ---------------------------------------------------------
    # PLAYBACK RATE
    # ---------------------------------------------------------

    def set_rate(
        self,
        rate: float,
    ) -> SessionState:

        now = self._now()

        # Freeze current position before changing speed.
        current_position = self._calculate_position(now)

        rate = max(
            0.25,
            min(
                4.0,
                float(rate),
            ),
        )

        self.state.currentTime = current_position
        self.state.playbackRate = rate

        self.state.sequence += 1

        self.state.masterTimestamp = now
        self.state.lastUpdated = now

        logger.info(
            "Playback rate changed to %.3fx",
            rate,
        )

        return self.get_state()

    # ---------------------------------------------------------
    # HOST AUTHORITATIVE UPDATE
    # ---------------------------------------------------------

    def update_from_host(
        self,
        current_time: float,
        playing: bool,
        playback_rate: float = 1.0,
        master_timestamp: Optional[float] = None,
    ) -> SessionState:

        now = self._now()

        position = max(
            0.0,
            float(current_time),
        )

        if self.state.duration > 0:
            position = min(
                position,
                float(self.state.duration),
            )

        rate = max(
            0.25,
            min(
                4.0,
                float(playback_rate),
            ),
        )

        if master_timestamp is not None:
            timestamp = float(master_timestamp)

            if timestamp <= 0:
                timestamp = now

        else:
            timestamp = now

        self.state.currentTime = position
        self.state.playing = bool(playing)
        self.state.playbackRate = rate
        self.state.masterTimestamp = timestamp
        self.state.lastUpdated = now

        return self.get_state()

    # ---------------------------------------------------------
    # SYNC PAYLOAD
    # ---------------------------------------------------------

    def get_sync_payload(self) -> Dict[str, Any]:

        now = self._now()

        estimated_position = (
            self._calculate_position(now)
        )

        return {
            "version": PROTOCOL_VERSION,
            "type": "sync",

            "sequence": self.state.sequence,

            # Timeline anchor.
            "currentTime": round(
                float(self.state.currentTime),
                6,
            ),

            "playing": bool(
                self.state.playing
            ),

            "playbackRate": round(
                float(self.state.playbackRate),
                6,
            ),

            "masterTimestamp": round(
                float(self.state.masterTimestamp),
                3,
            ),

            "serverTime": round(
                now,
                3,
            ),

            # Useful diagnostic value.
            "estimatedPosition": round(
                float(estimated_position),
                6,
            ),

            "videoId": self.state.videoId,
            "videoName": self.state.videoName,
            "duration": self.state.duration,
        }


# =============================================================
# SINGLE AUTHORITATIVE SESSION INSTANCE
# =============================================================
#
# IMPORTANT:
#
# This is the ONE session instance used by the BeatSync-Pro
# server.
#
# websocket_manager.py imports this object.
# server/app.py imports this object.
# REST routes receive this same object.
#
# Therefore:
#
#     Host
#       |
#       v
#   WebSocket
#       |
#       v
#   session_manager
#       |
#       +---- authoritative timeline
#       |
#       +---- REST API state
#       |
#       +---- receiver sync state
#
# =============================================================

session_manager = SessionManager(
    room_token=DEFAULT_ROOM_TOKEN,
    room_id=DEFAULT_ROOM_ID,
)


__all__ = [
    "SessionManager",
    "session_manager",
    "PROTOCOL_VERSION",
    "DEFAULT_START_LEAD_MS",
    "DEFAULT_ROOM_TOKEN",
    "DEFAULT_ROOM_ID",
]
# ```

# ### இப்போ முக்கியம்

# இந்த change-க்கு பிறகு:

# ```
# text
# session.py
#     ↓
# session_manager  ← ONE instance
#     ↓
#     ├── websocket_manager.py
#     └── server/app.py
#              ↓
#           REST API
# ```

# என்று இருக்கும்.

# மேலும் உன் existing authoritative timeline logic — `play()`, future `startAt`, `pause()`, `seek()`, `set_rate()` — preserve பண்ணியிருக்கிறேன்.

# **இந்த file மட்டும் replace பண்ணு. Server இன்னும் start பண்ணாதே.**
# அதுக்கப்புறம் `ok` சொன்னா, அடுத்ததாக `app.py`-ஐ இந்த global `session_manager`-க்கு connect பண்ணுவோம்.
