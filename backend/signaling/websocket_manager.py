"""
BeatSync-Pro LAN WebSocket Signaling Manager.

Protocol v2 responsibilities:

1. Register the laptop host.
2. Register receiver phones.
3. Maintain connected clients.
4. Relay WebRTC signaling messages.
5. Synchronize authoritative playback state.
6. Perform NTP-style clock ping/pong.
7. Broadcast session state.
8. Relay telemetry.
9. Enforce host-only playback control.
10. Cleanly remove disconnected clients.

This server is intentionally LAN-only.

No STUN.
No TURN.
No cloud signaling.
No external service dependency.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

from fastapi import WebSocket, WebSocketDisconnect

from backend.sync.clock import MasterClock
from backend.sync.session import session_manager
from shared.protocol.messages import (
    MessageType,
    PROTOCOL_VERSION,
    DEFAULT_ROOM_ID,
    DEFAULT_START_LEAD_MS,
    HEARTBEAT_INTERVAL_MS,
    CLIENT_TIMEOUT_MS,
)


logger = logging.getLogger("beatsync.websocket")


HOST_CLIENT_ID = "host-master"


@dataclass
class ConnectedClient:
    """
    Runtime information for one WebSocket client.
    """

    client_id: str
    websocket: WebSocket
    role: str = "receiver"
    device_name: str = "Unknown Device"
    room_id: str = DEFAULT_ROOM_ID
    ip_address: Optional[str] = None

    connected_at: float = 0.0
    last_seen: float = 0.0

    latency_ms: float = 0.0
    clock_offset_ms: float = 0.0
    drift_ms: float = 0.0
    calibration_offset_ms: float = 0.0
    playback_state: str = "paused"

    def __post_init__(self) -> None:
        now = MasterClock.now_ms()

        if self.connected_at <= 0:
            self.connected_at = now

        if self.last_seen <= 0:
            self.last_seen = now


class ConnectionManager:
    """
    Central WebSocket connection manager.

    One instance is shared by the entire FastAPI application.
    """

    def __init__(self) -> None:
        self.clients: Dict[str, ConnectedClient] = {}
        self.host_client_id: Optional[str] = None

        self._lock = asyncio.Lock()
        self._broadcast_task: Optional[asyncio.Task] = None
        self._heartbeat_task: Optional[asyncio.Task] = None

        self._running = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """
        Start background synchronization and heartbeat loops.
        """

        if self._running:
            return

        self._running = True

        self._broadcast_task = asyncio.create_task(
            self._periodic_session_broadcast()
        )

        self._heartbeat_task = asyncio.create_task(
            self._periodic_heartbeat()
        )

        logger.info("WebSocket manager started")

    async def stop(self) -> None:
        """
        Stop background tasks and close all connections.
        """

        self._running = False

        tasks = [
            self._broadcast_task,
            self._heartbeat_task,
        ]

        for task in tasks:
            if task is not None:
                task.cancel()

        for task in tasks:
            if task is not None:
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                except Exception:
                    logger.exception(
                        "Error while stopping WebSocket task"
                    )

        self._broadcast_task = None
        self._heartbeat_task = None

        async with self._lock:
            clients = list(self.clients.values())

            self.clients.clear()
            self.host_client_id = None

        for client in clients:
            try:
                await client.websocket.close()
            except Exception:
                pass

        logger.info("WebSocket manager stopped")

    # ------------------------------------------------------------------
    # Client registration
    # ------------------------------------------------------------------

    async def register(
        self,
        websocket: WebSocket,
        client_id: str,
        role: str,
        device_name: str,
        room_id: str,
        ip_address: Optional[str],
    ) -> ConnectedClient:
        """
        Register or replace a client connection.
        """

        now = MasterClock.now_ms()

        client = ConnectedClient(
            client_id=client_id,
            websocket=websocket,
            role=role,
            device_name=device_name or "Unknown Device",
            room_id=room_id or DEFAULT_ROOM_ID,
            ip_address=ip_address,
            connected_at=now,
            last_seen=now,
        )

        old_client: Optional[ConnectedClient] = None

        async with self._lock:
            old_client = self.clients.get(client_id)

            self.clients[client_id] = client

            if role == "host":
                self.host_client_id = client_id

        if old_client is not None and old_client.websocket is not websocket:
            try:
                await old_client.websocket.close()
            except Exception:
                pass

        logger.info(
            "Client registered: id=%s role=%s device=%s ip=%s",
            client_id,
            role,
            device_name,
            ip_address,
        )

        return client

    async def unregister(
        self,
        client_id: str,
        websocket: Optional[WebSocket] = None,
    ) -> None:
        """
        Remove a client safely.

        If websocket is provided, do not remove a newer connection
        that reused the same client ID.
        """

        removed = False
        removed_client: Optional[ConnectedClient] = None

        async with self._lock:
            current = self.clients.get(client_id)

            if current is None:
                return

            if websocket is not None and current.websocket is not websocket:
                return

            removed_client = self.clients.pop(client_id, None)

            if client_id == self.host_client_id:
                self.host_client_id = None

            removed = removed_client is not None

        if removed:
            logger.info(
                "Client disconnected: id=%s role=%s",
                client_id,
                removed_client.role if removed_client else "unknown",
            )

            await self.broadcast_client_list()

    # ------------------------------------------------------------------
    # Basic helpers
    # ------------------------------------------------------------------

    def get_host(self) -> Optional[ConnectedClient]:
        """
        Return the currently registered host.
        """

        if self.host_client_id is None:
            return None

        return self.clients.get(self.host_client_id)

    def get_client(self, client_id: str) -> Optional[ConnectedClient]:
        """
        Return a connected client by ID.
        """

        return self.clients.get(client_id)

    def get_receiver_clients(self) -> list[ConnectedClient]:
        """
        Return all currently connected receiver clients.
        """

        return [
            client
            for client in self.clients.values()
            if client.role == "receiver"
        ]

    def touch(self, client_id: str) -> None:
        """
        Update last-seen timestamp.
        """

        client = self.clients.get(client_id)

        if client is not None:
            client.last_seen = MasterClock.now_ms()

    # ------------------------------------------------------------------
    # Sending
    # ------------------------------------------------------------------

    async def send_json(
        self,
        websocket: WebSocket,
        message: Dict[str, Any],
    ) -> bool:
        """
        Send JSON safely.
        """

        try:
            await websocket.send_json(message)
            return True

        except Exception as exc:
            logger.warning(
                "WebSocket send failed: %s",
                exc,
            )
            return False

    async def send_to_client(
        self,
        client_id: str,
        message: Dict[str, Any],
    ) -> bool:
        """
        Send a message to one client.
        """

        client = self.clients.get(client_id)

        if client is None:
            return False

        return await self.send_json(
            client.websocket,
            message,
        )

    async def broadcast(
        self,
        message: Dict[str, Any],
        role: Optional[str] = None,
        exclude_client_id: Optional[str] = None,
    ) -> None:
        """
        Broadcast a message to connected clients.
        """

        clients = list(self.clients.values())

        send_tasks = []

        for client in clients:
            if exclude_client_id is not None:
                if client.client_id == exclude_client_id:
                    continue

            if role is not None:
                if client.role != role:
                    continue

            send_tasks.append(
                self.send_json(
                    client.websocket,
                    message,
                )
            )

        if send_tasks:
            await asyncio.gather(
                *send_tasks,
                return_exceptions=True,
            )

    # ------------------------------------------------------------------
    # Session state
    # ------------------------------------------------------------------

    def _session_payload(self) -> Dict[str, Any]:
        """
        Get authoritative session state.

        The session manager owns the playback timeline.
        """

        payload = session_manager.get_sync_payload()

        if isinstance(payload, dict):
            return payload

        if hasattr(payload, "model_dump"):
            return payload.model_dump()

        if hasattr(payload, "dict"):
            return payload.dict()

        return dict(payload)

    async def send_session_state(
        self,
        client_id: str,
    ) -> None:
        """
        Send the current authoritative session state to one client.
        """

        payload = self._session_payload()

        message = {
            "version": PROTOCOL_VERSION,
            "type": MessageType.SESSION_STATE.value,
            **payload,
        }

        await self.send_to_client(
            client_id,
            message,
        )

    async def broadcast_session_state(self) -> None:
        """
        Broadcast authoritative session state to all receivers.
        """

        payload = self._session_payload()

        message = {
            "version": PROTOCOL_VERSION,
            "type": MessageType.SESSION_STATE.value,
            **payload,
        }

        await self.broadcast(
            message,
            role="receiver",
        )

    # ------------------------------------------------------------------
    # Client list
    # ------------------------------------------------------------------

    def _client_to_dict(
        self,
        client: ConnectedClient,
    ) -> Dict[str, Any]:
        """
        Convert runtime client state into protocol data.
        """

        return {
            "clientId": client.client_id,
            "deviceName": client.device_name,
            "role": client.role,
            "connected": True,
            "ipAddress": client.ip_address,
            "latencyMs": round(client.latency_ms, 2),
            "clockOffsetMs": round(client.clock_offset_ms, 2),
            "driftMs": round(client.drift_ms, 2),
            "calibrationOffsetMs": round(
                client.calibration_offset_ms,
                2,
            ),
            "playbackState": client.playback_state,
            "joinedAt": client.connected_at,
            "lastSeen": client.last_seen,
        }

    def _client_list_payload(self) -> list[Dict[str, Any]]:
        return [
            self._client_to_dict(client)
            for client in self.clients.values()
            if client.role == "receiver"
        ]

    async def broadcast_client_list(self) -> None:
        """
        Send the current receiver list to host and receivers.
        """

        message = {
            "version": PROTOCOL_VERSION,
            "type": MessageType.CLIENT_LIST.value,
            "clients": self._client_list_payload(),
            "serverTime": MasterClock.now_ms(),
        }

        await self.broadcast(message)

    # ------------------------------------------------------------------
    # Welcome
    # ------------------------------------------------------------------

    async def send_welcome(
        self,
        client: ConnectedClient,
    ) -> None:
        """
        Send welcome message after successful registration.
        """

        session = self._session_payload()

        message = {
            "version": PROTOCOL_VERSION,
            "type": MessageType.WELCOME.value,
            "clientId": client.client_id,
            "role": client.role,
            "roomId": client.room_id,
            "serverTime": MasterClock.now_ms(),
            "clients": self._client_list_payload(),
            "session": session,
        }

        await self.send_json(
            client.websocket,
            message,
        )

    # ------------------------------------------------------------------
    # Authorization
    # ------------------------------------------------------------------

    def is_host(self, client_id: str) -> bool:
        return (
            self.host_client_id is not None
            and self.host_client_id == client_id
        )

    async def require_host(
        self,
        client_id: str,
        websocket: WebSocket,
    ) -> bool:
        """
        Ensure a playback-control message originates from the host.
        """

        if self.is_host(client_id):
            return True

        await self.send_json(
            websocket,
            {
                "version": PROTOCOL_VERSION,
                "type": MessageType.ERROR.value,
                "error": "Only the host can control playback.",
            },
        )

        return False

    # ------------------------------------------------------------------
    # Clock synchronization
    # ------------------------------------------------------------------

    async def handle_clock_ping(
        self,
        client: ConnectedClient,
        message: Dict[str, Any],
    ) -> None:
        """
        Handle NTP-style clock ping.

        Client sends:

            clientTime

        Server responds with:

            clientTime
            serverTime
            serverReceiveTime
            serverSendTime
        """

        client_time = message.get("clientTime")

        receive_time = MasterClock.now_ms()

        send_message = {
            "version": PROTOCOL_VERSION,
            "type": MessageType.CLOCK_PONG.value,
            "clientTime": client_time,
            "serverTime": receive_time,
            "serverReceiveTime": receive_time,
            "serverSendTime": MasterClock.now_ms(),
        }

        await self.send_json(
            client.websocket,
            send_message,
        )

    # ------------------------------------------------------------------
    # Playback control
    # ------------------------------------------------------------------

    async def handle_play(
        self,
        client: ConnectedClient,
        message: Dict[str, Any],
    ) -> None:
        if not await self.require_host(
            client.client_id,
            client.websocket,
        ):
            return

        position = message.get("position")

        start_at = message.get("startAt")

        playback_rate = message.get(
            "playbackRate",
            1.0,
        )

        result = session_manager.play(
            position=position,
            start_at=start_at,
        )

        if isinstance(result, dict):
            response = result
        elif hasattr(result, "model_dump"):
            response = result.model_dump()
        else:
            response = self._session_payload()

        response.update(
            {
                "version": PROTOCOL_VERSION,
                "type": MessageType.PLAY.value,
                "serverTime": MasterClock.now_ms(),
                "playbackRate": playback_rate,
            }
        )

        await self.broadcast(
            response,
            role="receiver",
        )

    async def handle_pause(
        self,
        client: ConnectedClient,
        message: Dict[str, Any],
    ) -> None:
        if not await self.require_host(
            client.client_id,
            client.websocket,
        ):
            return

        position = message.get("position")

        result = session_manager.pause(
            position=position,
        )

        if isinstance(result, dict):
            response = result
        elif hasattr(result, "model_dump"):
            response = result.model_dump()
        else:
            response = self._session_payload()

        response.update(
            {
                "version": PROTOCOL_VERSION,
                "type": MessageType.PAUSE.value,
                "serverTime": MasterClock.now_ms(),
            }
        )

        await self.broadcast(
            response,
            role="receiver",
        )

    async def handle_seek(
        self,
        client: ConnectedClient,
        message: Dict[str, Any],
    ) -> None:
        if not await self.require_host(
            client.client_id,
            client.websocket,
        ):
            return

        position = message.get(
            "position",
            message.get(
                "currentTime",
                0.0,
            ),
        )

        try:
            position = float(position)
        except (TypeError, ValueError):
            position = 0.0

        result = session_manager.seek(position)

        if isinstance(result, dict):
            response = result
        elif hasattr(result, "model_dump"):
            response = result.model_dump()
        else:
            response = self._session_payload()

        response.update(
            {
                "version": PROTOCOL_VERSION,
                "type": MessageType.SEEK.value,
                "position": position,
                "serverTime": MasterClock.now_ms(),
            }
        )

        await self.broadcast(
            response,
            role="receiver",
        )

    async def handle_set_rate(
        self,
        client: ConnectedClient,
        message: Dict[str, Any],
    ) -> None:
        if not await self.require_host(
            client.client_id,
            client.websocket,
        ):
            return

        playback_rate = message.get(
            "playbackRate",
            1.0,
        )

        try:
            playback_rate = float(playback_rate)
        except (TypeError, ValueError):
            playback_rate = 1.0

        playback_rate = max(
            0.25,
            min(
                playback_rate,
                4.0,
            ),
        )

        result = session_manager.set_rate(
            playback_rate,
        )

        if isinstance(result, dict):
            response = result
        elif hasattr(result, "model_dump"):
            response = result.model_dump()
        else:
            response = self._session_payload()

        response.update(
            {
                "version": PROTOCOL_VERSION,
                "type": MessageType.SET_RATE.value,
                "playbackRate": playback_rate,
                "serverTime": MasterClock.now_ms(),
            }
        )

        await self.broadcast(
            response,
            role="receiver",
        )

    async def handle_stop(
        self,
        client: ConnectedClient,
        message: Dict[str, Any],
    ) -> None:
        if not await self.require_host(
            client.client_id,
            client.websocket,
        ):
            return

        try:
            result = session_manager.pause(
                position=0.0,
            )
        except Exception:
            result = self._session_payload()

        if isinstance(result, dict):
            response = result
        elif hasattr(result, "model_dump"):
            response = result.model_dump()
        else:
            response = self._session_payload()

        response.update(
            {
                "version": PROTOCOL_VERSION,
                "type": MessageType.STOP.value,
                "position": 0.0,
                "serverTime": MasterClock.now_ms(),
            }
        )

        await self.broadcast(
            response,
            role="receiver",
        )

    # ------------------------------------------------------------------
    # Load / unload
    # ------------------------------------------------------------------

    async def handle_load(
        self,
        client: ConnectedClient,
        message: Dict[str, Any],
    ) -> None:
        if not await self.require_host(
            client.client_id,
            client.websocket,
        ):
            return

        video_id = message.get("videoId")
        video_name = message.get("videoName")
        video_url = message.get("videoUrl")
        duration = message.get("duration", 0.0)
        file_size = message.get("fileSize", 0)
        mime_type = message.get(
            "mimeType",
            "video/mp4",
        )

        result = session_manager.load_video(
            video_id=video_id,
            video_name=video_name,
            video_url=video_url,
            duration=duration,
            file_size=file_size,
            mime_type=mime_type,
        )

        if isinstance(result, dict):
            response = result
        elif hasattr(result, "model_dump"):
            response = result.model_dump()
        else:
            response = self._session_payload()

        response.update(
            {
                "version": PROTOCOL_VERSION,
                "type": MessageType.LOAD.value,
                "videoId": video_id,
                "videoName": video_name,
                "videoUrl": video_url,
                "duration": duration,
                "fileSize": file_size,
                "mimeType": mime_type,
                "serverTime": MasterClock.now_ms(),
            }
        )

        await self.broadcast(
            response,
            role="receiver",
        )

    async def handle_unload(
        self,
        client: ConnectedClient,
        message: Dict[str, Any],
    ) -> None:
        if not await self.require_host(
            client.client_id,
            client.websocket,
        ):
            return

        result = session_manager.unload_video()

        if isinstance(result, dict):
            response = result
        elif hasattr(result, "model_dump"):
            response = result.model_dump()
        else:
            response = self._session_payload()

        response.update(
            {
                "version": PROTOCOL_VERSION,
                "type": MessageType.UNLOAD.value,
                "serverTime": MasterClock.now_ms(),
            }
        )

        await self.broadcast(
            response,
            role="receiver",
        )

    # ------------------------------------------------------------------
    # Host sync
    # ------------------------------------------------------------------

    async def handle_sync(
        self,
        client: ConnectedClient,
        message: Dict[str, Any],
    ) -> None:
        """
        Accept a host timeline anchor.

        This does NOT create an independent receiver timeline.
        The server remains authoritative.
        """

        if not await self.require_host(
            client.client_id,
            client.websocket,
        ):
            return

        current_time = message.get(
            "currentTime",
            message.get(
                "position",
                0.0,
            ),
        )

        playing = bool(
            message.get(
                "playing",
                False,
            )
        )

        playback_rate = message.get(
            "playbackRate",
            1.0,
        )

        master_timestamp = message.get(
            "masterTimestamp",
        )

        try:
            current_time = float(current_time)
        except (TypeError, ValueError):
            current_time = 0.0

        try:
            playback_rate = float(playback_rate)
        except (TypeError, ValueError):
            playback_rate = 1.0

        session_manager.update_from_host(
            current_time=current_time,
            playing=playing,
            playback_rate=playback_rate,
            master_timestamp=master_timestamp,
        )

        await self.broadcast_session_state()

    # ------------------------------------------------------------------
    # Telemetry
    # ------------------------------------------------------------------

    async def handle_telemetry(
        self,
        client: ConnectedClient,
        message: Dict[str, Any],
    ) -> None:
        client.latency_ms = self._safe_float(
            message.get("latencyMs"),
            client.latency_ms,
        )

        client.clock_offset_ms = self._safe_float(
            message.get("clockOffsetMs"),
            client.clock_offset_ms,
        )

        client.drift_ms = self._safe_float(
            message.get("driftMs"),
            client.drift_ms,
        )

        client.calibration_offset_ms = self._safe_float(
            message.get("calibrationOffsetMs"),
            client.calibration_offset_ms,
        )

        playback_state = message.get(
            "playbackState"
        )

        if playback_state is not None:
            client.playback_state = str(
                playback_state
            )

        telemetry_message = {
            "version": PROTOCOL_VERSION,
            "type": MessageType.TELEMETRY.value,
            "client": self._client_to_dict(client),
            "serverTime": MasterClock.now_ms(),
        }

        host = self.get_host()

        if host is not None:
            await self.send_json(
                host.websocket,
                telemetry_message,
            )

    # ------------------------------------------------------------------
    # WebRTC signaling relay
    # ------------------------------------------------------------------

    async def relay_webrtc_message(
        self,
        client: ConnectedClient,
        message: Dict[str, Any],
    ) -> None:
        """
        Relay WebRTC signaling data directly through the LAN server.

        Supported:

            webrtc-offer
            webrtc-answer
            webrtc-candidate
        """

        message_type = message.get("type")

        target_client_id = (
            message.get("targetClientId")
            or message.get("target")
            or message.get("to")
        )

        if not target_client_id:
            await self.send_json(
                client.websocket,
                {
                    "version": PROTOCOL_VERSION,
                    "type": MessageType.ERROR.value,
                    "error": "WebRTC message is missing targetClientId.",
                },
            )
            return

        target = self.get_client(
            target_client_id
        )

        if target is None:
            await self.send_json(
                client.websocket,
                {
                    "version": PROTOCOL_VERSION,
                    "type": MessageType.ERROR.value,
                    "error": (
                        "WebRTC target client is not connected: "
                        f"{target_client_id}"
                    ),
                },
            )
            return

        forwarded = dict(message)

        forwarded["version"] = PROTOCOL_VERSION

        forwarded["fromClientId"] = (
            client.client_id
        )

        forwarded["targetClientId"] = (
            target_client_id
        )

        forwarded["serverTime"] = (
            MasterClock.now_ms()
        )

        await self.send_json(
            target.websocket,
            forwarded,
        )

    # ------------------------------------------------------------------
    # Generic message routing
    # ------------------------------------------------------------------

    async def handle_message(
        self,
        client: ConnectedClient,
        message: Dict[str, Any],
    ) -> None:
        """
        Route one incoming protocol message.
        """

        self.touch(client.client_id)

        message_type = message.get("type")

        if not message_type:
            await self.send_json(
                client.websocket,
                {
                    "version": PROTOCOL_VERSION,
                    "type": MessageType.ERROR.value,
                    "error": "Message type is missing.",
                },
            )
            return

        # --------------------------------------------------------------
        # Heartbeat
        # --------------------------------------------------------------

        if message_type == MessageType.PING.value:
            await self.send_json(
                client.websocket,
                {
                    "version": PROTOCOL_VERSION,
                    "type": MessageType.PONG.value,
                    "serverTime": MasterClock.now_ms(),
                },
            )
            return

        if message_type == MessageType.PONG.value:
            return

        # --------------------------------------------------------------
        # Clock synchronization
        # --------------------------------------------------------------

        if message_type == MessageType.CLOCK_PING.value:
            await self.handle_clock_ping(
                client,
                message,
            )
            return

        # --------------------------------------------------------------
        # Host timeline synchronization
        # --------------------------------------------------------------

        if message_type == MessageType.SYNC.value:
            await self.handle_sync(
                client,
                message,
            )
            return

        # --------------------------------------------------------------
        # Playback commands
        # --------------------------------------------------------------

        if message_type == MessageType.PLAY.value:
            await self.handle_play(
                client,
                message,
            )
            return

        if message_type == MessageType.PAUSE.value:
            await self.handle_pause(
                client,
                message,
            )
            return

        if message_type == MessageType.SEEK.value:
            await self.handle_seek(
                client,
                message,
            )
            return

        if message_type == MessageType.SET_RATE.value:
            await self.handle_set_rate(
                client,
                message,
            )
            return

        if message_type == MessageType.STOP.value:
            await self.handle_stop(
                client,
                message,
            )
            return

        # --------------------------------------------------------------
        # Media commands
        # --------------------------------------------------------------

        if message_type == MessageType.LOAD.value:
            await self.handle_load(
                client,
                message,
            )
            return

        if message_type == MessageType.UNLOAD.value:
            await self.handle_unload(
                client,
                message,
            )
            return

        # --------------------------------------------------------------
        # Telemetry
        # --------------------------------------------------------------

        if message_type == MessageType.TELEMETRY.value:
            await self.handle_telemetry(
                client,
                message,
            )
            return

        # --------------------------------------------------------------
        # Calibration
        # --------------------------------------------------------------

        if message_type == MessageType.CALIBRATE.value:
            if client.role == "receiver":
                offset = self._safe_float(
                    message.get("offsetMs"),
                    0.0,
                )

                client.calibration_offset_ms = offset

                await self.send_json(
                    client.websocket,
                    {
                        "version": PROTOCOL_VERSION,
                        "type": MessageType.CALIBRATE.value,
                        "offsetMs": offset,
                        "serverTime": MasterClock.now_ms(),
                    },
                )
            return

        # --------------------------------------------------------------
        # WebRTC signaling
        # --------------------------------------------------------------

        if message_type in {
            MessageType.WEBRTC_OFFER.value,
            MessageType.WEBRTC_ANSWER.value,
            MessageType.WEBRTC_CANDIDATE.value,
        }:
            await self.relay_webrtc_message(
                client,
                message,
            )
            return

        # --------------------------------------------------------------
        # Unknown message
        # --------------------------------------------------------------

        await self.send_json(
            client.websocket,
            {
                "version": PROTOCOL_VERSION,
                "type": MessageType.ERROR.value,
                "error": (
                    f"Unknown message type: {message_type}"
                ),
            },
        )

    # ------------------------------------------------------------------
    # WebSocket endpoint
    # ------------------------------------------------------------------

    async def websocket_endpoint(
        self,
        websocket: WebSocket,
    ) -> None:
        """
        Main FastAPI WebSocket endpoint.
        """

        await websocket.accept()

        client: Optional[ConnectedClient] = None

        try:
            await self.start()

            # ----------------------------------------------------------
            # Registration message
            # ----------------------------------------------------------

            raw_message = await websocket.receive_text()

            try:
                registration = json.loads(
                    raw_message
                )
            except json.JSONDecodeError:
                await self.send_json(
                    websocket,
                    {
                        "version": PROTOCOL_VERSION,
                        "type": MessageType.ERROR.value,
                        "error": "Invalid JSON registration message.",
                    },
                )

                await websocket.close()
                return

            message_type = registration.get("type")

            if message_type not in {
                MessageType.JOIN.value,
                MessageType.HOST.value,
            }:
                await self.send_json(
                    websocket,
                    {
                        "version": PROTOCOL_VERSION,
                        "type": MessageType.ERROR.value,
                        "error": (
                            "First WebSocket message must be "
                            "'host' or 'join'."
                        ),
                    },
                )

                await websocket.close()
                return

            version = registration.get(
                "version",
                PROTOCOL_VERSION,
            )

            if version not in {
                PROTOCOL_VERSION,
                1,
            }:
                await self.send_json(
                    websocket,
                    {
                        "version": PROTOCOL_VERSION,
                        "type": MessageType.ERROR.value,
                        "error": (
                            f"Unsupported protocol version: {version}"
                        ),
                    },
                )

                await websocket.close()
                return

            client_id = str(
                registration.get(
                    "clientId",
                    "",
                )
            ).strip()

            if not client_id:
                if message_type == MessageType.HOST.value:
                    client_id = HOST_CLIENT_ID
                else:
                    client_id = (
                        f"receiver-{int(time.time() * 1000)}"
                    )

            if message_type == MessageType.HOST.value:
                role = "host"
                device_name = registration.get(
                    "deviceName",
                    "Laptop Host",
                )
            else:
                role = "receiver"
                device_name = registration.get(
                    "deviceName",
                    "Unknown Device",
                )

            room_id = registration.get(
                "roomId",
                DEFAULT_ROOM_ID,
            )

            client_host = websocket.client

            ip_address = None

            if client_host is not None:
                ip_address = getattr(
                    client_host,
                    "host",
                    None,
                )

            # ----------------------------------------------------------
            # Host uniqueness
            # ----------------------------------------------------------

            if role == "host":
                existing_host = self.get_host()

                if (
                    existing_host is not None
                    and existing_host.client_id != client_id
                ):
                    await self.send_json(
                        websocket,
                        {
                            "version": PROTOCOL_VERSION,
                            "type": MessageType.ERROR.value,
                            "error": (
                                "Another host is already connected."
                            ),
                        },
                    )

                    await websocket.close()
                    return

            # ----------------------------------------------------------
            # Register client
            # ----------------------------------------------------------

            client = await self.register(
                websocket=websocket,
                client_id=client_id,
                role=role,
                device_name=device_name,
                room_id=room_id,
                ip_address=ip_address,
            )

            # ----------------------------------------------------------
            # Welcome
            # ----------------------------------------------------------

            await self.send_welcome(
                client
            )

            await self.broadcast_client_list()

            # Send current state to receiver explicitly.
            if client.role == "receiver":
                await self.send_session_state(
                    client.client_id
                )

            # ----------------------------------------------------------
            # Main receive loop
            # ----------------------------------------------------------

            while True:
                raw = await websocket.receive_text()

                try:
                    message = json.loads(raw)
                except json.JSONDecodeError:
                    await self.send_json(
                        websocket,
                        {
                            "version": PROTOCOL_VERSION,
                            "type": MessageType.ERROR.value,
                            "error": "Invalid JSON message.",
                        },
                    )
                    continue

                await self.handle_message(
                    client,
                    message,
                )

        except WebSocketDisconnect:
            logger.info(
                "WebSocket disconnected: %s",
                client.client_id if client else "unknown",
            )

        except Exception:
            logger.exception(
                "Unexpected WebSocket error: %s",
                client.client_id if client else "unknown",
            )

        finally:
            if client is not None:
                await self.unregister(
                    client.client_id,
                    websocket,
                )

    # ------------------------------------------------------------------
    # Background synchronization
    # ------------------------------------------------------------------

    async def _periodic_session_broadcast(self) -> None:
        """
        Periodically broadcast authoritative session state.

        Receivers also receive immediate updates for playback commands.
        This periodic broadcast protects against packet/message loss.
        """

        interval = 0.4

        while self._running:
            try:
                await asyncio.sleep(interval)

                if self.get_receiver_clients():
                    await self.broadcast_session_state()

            except asyncio.CancelledError:
                raise

            except Exception:
                logger.exception(
                    "Periodic session broadcast failed"
                )

    async def _periodic_heartbeat(self) -> None:
        """
        Remove stale clients and keep active WebSockets alive.
        """

        interval = HEARTBEAT_INTERVAL_MS / 1000.0

        while self._running:
            try:
                await asyncio.sleep(interval)

                now = MasterClock.now_ms()

                stale_clients = []

                for client in list(
                    self.clients.values()
                ):
                    age = now - client.last_seen

                    if age > CLIENT_TIMEOUT_MS:
                        stale_clients.append(
                            client.client_id
                        )
                        continue

                    await self.send_json(
                        client.websocket,
                        {
                            "version": PROTOCOL_VERSION,
                            "type": MessageType.PING.value,
                            "serverTime": now,
                        },
                    )

                for client_id in stale_clients:
                    client = self.get_client(
                        client_id
                    )

                    if client is not None:
                        try:
                            await client.websocket.close()
                        except Exception:
                            pass

                    await self.unregister(
                        client_id
                    )

            except asyncio.CancelledError:
                raise

            except Exception:
                logger.exception(
                    "Heartbeat loop failed"
                )

    # ------------------------------------------------------------------
    # Utility
    # ------------------------------------------------------------------

    @staticmethod
    def _safe_float(
        value: Any,
        default: float = 0.0,
    ) -> float:
        try:
            return float(value)
        except (
            TypeError,
            ValueError,
        ):
            return default


# ----------------------------------------------------------------------
# Global manager
# ----------------------------------------------------------------------

connection_manager = ConnectionManager()

# Backward-compatible aliases.
manager = connection_manager
websocket_manager = connection_manager
WebSocketManager = ConnectionManager


async def websocket_endpoint(
    websocket: WebSocket,
) -> None:
    """
    FastAPI-compatible WebSocket endpoint.

    backend/server/app.py can simply use:

        @app.websocket("/ws")
        async def websocket_route(websocket: WebSocket):
            await websocket_endpoint(websocket)
    """

    await connection_manager.websocket_endpoint(
        websocket
    )


__all__ = [
    "ConnectedClient",
    "ConnectionManager",
    "connection_manager",
    "manager",
    "websocket_manager",
    "websocket_endpoint",
]
# Backward compatibility
WebSocketManager = ConnectionManager