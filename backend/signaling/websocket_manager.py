"""
WebSocket Signaling & Timeline Broadcast Manager.
Coordinates real-time messaging, clock synchronization, telemetry, and device state.
"""

import asyncio
import json
import logging
import time
from typing import Dict, Optional, Any, List
from fastapi import WebSocket, WebSocketDisconnect

from shared.models.session import ClientState, WSMessage
from shared.protocol.messages import (
    MessageType,
    PROTOCOL_VERSION,
    SYNC_INTERVAL_MS,
    HEARTBEAT_INTERVAL_MS,
    CLIENT_TIMEOUT_MS,
)
from backend.sync.clock import MasterClock
from backend.sync.session import SessionManager

logger = logging.getLogger("BeatSync.Signaling")


class WebSocketManager:
    def __init__(self, session_manager: SessionManager):
        self.session_manager = session_manager
        # clientId -> (WebSocket, ClientState)
        self.clients: Dict[str, tuple[WebSocket, ClientState]] = {}
        # host WebSocket reference
        self.host_ws: Optional[WebSocket] = None
        self.host_client_id: Optional[str] = None
        self._sync_task: Optional[asyncio.Task] = None
        self._cleanup_task: Optional[asyncio.Task] = None

    def start_background_tasks(self):
        if self._sync_task is None or self._sync_task.done():
            self._sync_task = asyncio.create_task(self._periodic_sync_loop())
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._periodic_cleanup_loop())

    def stop_background_tasks(self):
        if self._sync_task and not self._sync_task.done():
            self._sync_task.cancel()
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()

    async def _send_json(self, ws: WebSocket, data: Dict[str, Any]):
        try:
            await ws.send_text(json.dumps(data))
        except Exception as e:
            logger.debug(f"Failed to send to websocket: {e}")

    async def broadcast_to_receivers(self, data: Dict[str, Any]):
        dead_clients = []
        for client_id, (ws, state) in list(self.clients.items()):
            if state.role == "receiver":
                try:
                    await ws.send_text(json.dumps(data))
                except Exception:
                    dead_clients.append(client_id)
        for dead_id in dead_clients:
            await self.disconnect_client(dead_id)

    async def broadcast_to_all(self, data: Dict[str, Any]):
        dead_clients = []
        for client_id, (ws, _) in list(self.clients.items()):
            try:
                await ws.send_text(json.dumps(data))
            except Exception:
                dead_clients.append(client_id)
        for dead_id in dead_clients:
            await self.disconnect_client(dead_id)

    async def send_to_host(self, data: Dict[str, Any]):
        if self.host_ws:
            try:
                await self.host_ws.send_text(json.dumps(data))
            except Exception as e:
                logger.warning(f"Failed to send to host: {e}")
                self.host_ws = None

    def get_client_list_payload(self) -> List[Dict[str, Any]]:
        client_list = []
        for client_id, (_, state) in self.clients.items():
            if state.role == "receiver":
                client_list.append(state.model_dump())
        return client_list

    async def broadcast_client_list(self):
        payload = {
            "version": PROTOCOL_VERSION,
            "type": MessageType.CLIENT_LIST.value,
            "clients": self.get_client_list_payload(),
            "serverTime": MasterClock.now_ms()
        }
        await self.send_to_host(payload)

    async def disconnect_client(self, client_id: str):
        if client_id in self.clients:
            _, state = self.clients.pop(client_id)
            logger.info(f"Client disconnected: {state.deviceName} [{client_id}]")
            if self.host_client_id == client_id:
                self.host_ws = None
                self.host_client_id = None
                logger.info("Host disconnected")
            await self.broadcast_client_list()

    async def _periodic_sync_loop(self):
        """Broadcasts authoritative timeline sync message every SYNC_INTERVAL_MS."""
        while True:
            try:
                await asyncio.sleep(SYNC_INTERVAL_MS / 1000.0)
                if self.clients:
                    sync_data = self.session_manager.get_sync_payload()
                    await self.broadcast_to_receivers(sync_data)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in sync loop: {e}")

    async def _periodic_cleanup_loop(self):
        """Cleans up timed-out receiver clients."""
        while True:
            try:
                await asyncio.sleep(HEARTBEAT_INTERVAL_MS / 1000.0)
                now = MasterClock.now_ms()
                to_remove = []
                for client_id, (_, state) in list(self.clients.items()):
                    # Never timeout host in cleanup loop; disconnection handles it
                    if state.role == "host":
                        continue
                    if now - state.lastSeen > CLIENT_TIMEOUT_MS:
                        to_remove.append(client_id)
                for client_id in to_remove:
                    logger.info(f"Client {client_id} timed out (lastSeen > {CLIENT_TIMEOUT_MS}ms)")
                    await self.disconnect_client(client_id)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in cleanup loop: {e}")

    async def handle_connection(self, websocket: WebSocket):
        await websocket.accept()
        current_client_id: Optional[str] = None
        client_ip = websocket.client.host if websocket.client else "unknown"

        try:
            while True:
                text_data = await websocket.receive_text()
                try:
                    raw_msg = json.loads(text_data)
                except Exception:
                    await self._send_json(websocket, {
                        "version": PROTOCOL_VERSION,
                        "type": MessageType.ERROR.value,
                        "error": "Malformed JSON packet"
                    })
                    continue

                msg_type = raw_msg.get("type")
                if not msg_type:
                    continue

                # 1. CLOCK PING (Highest priority for low latency NTP)
                if msg_type == MessageType.CLOCK_PING.value:
                    client_time = raw_msg.get("clientTime", 0)
                    server_now = MasterClock.now_ms()
                    await self._send_json(websocket, {
                        "version": PROTOCOL_VERSION,
                        "type": MessageType.CLOCK_PONG.value,
                        "clientTime": client_time,
                        "serverTime": server_now
                    })
                    if current_client_id and current_client_id in self.clients:
                        self.clients[current_client_id][1].lastSeen = server_now
                    continue

                # 2. HEARTBEAT PING
                if msg_type == MessageType.PING.value:
                    server_now = MasterClock.now_ms()
                    await self._send_json(websocket, {
                        "version": PROTOCOL_VERSION,
                        "type": MessageType.PONG.value,
                        "serverTime": server_now
                    })
                    if current_client_id and current_client_id in self.clients:
                        self.clients[current_client_id][1].lastSeen = server_now
                    continue

                # 3. JOIN (Receiver or Client)
                if msg_type == MessageType.JOIN.value:
                    client_id = raw_msg.get("clientId") or f"phone-{uuid_short()}"
                    current_client_id = client_id
                    device_name = raw_msg.get("deviceName", "Phone")
                    token = raw_msg.get("token")
                    role = raw_msg.get("role", "receiver")

                    # Verify token if configured
                    if token and token != self.session_manager.state.roomToken:
                        await self._send_json(websocket, {
                            "version": PROTOCOL_VERSION,
                            "type": MessageType.ERROR.value,
                            "error": "Invalid room token. Access denied."
                        })
                        await websocket.close(code=4003)
                        return

                    state = ClientState(
                        clientId=client_id,
                        deviceName=device_name,
                        role=role,
                        connected=True,
                        ipAddress=client_ip,
                        lastSeen=MasterClock.now_ms()
                    )
                    self.clients[client_id] = (websocket, state)
                    logger.info(f"Client joined: {device_name} [{client_id}] from {client_ip}")

                    # Reply with welcome and current session state
                    session_info = self.session_manager.get_state().model_dump()
                    await self._send_json(websocket, {
                        "version": PROTOCOL_VERSION,
                        "type": MessageType.WELCOME.value,
                        "clientId": client_id,
                        "serverTime": MasterClock.now_ms(),
                        "session": session_info
                    })
                    # Also immediately send session-state packet for instant playback alignment
                    await self._send_json(websocket, {
                        "version": PROTOCOL_VERSION,
                        "type": MessageType.SESSION_STATE.value,
                        **session_info,
                        "serverTime": MasterClock.now_ms()
                    })

                    # Notify host
                    await self.broadcast_client_list()
                    continue

                # 4. HOST REGISTRATION
                if msg_type == MessageType.HOST.value:
                    token = raw_msg.get("token")
                    if token and token != self.session_manager.state.roomToken:
                        await self._send_json(websocket, {
                            "version": PROTOCOL_VERSION,
                            "type": MessageType.ERROR.value,
                            "error": "Invalid host room token"
                        })
                        await websocket.close(code=4003)
                        return

                    host_id = raw_msg.get("clientId", "host-master")
                    current_client_id = host_id
                    self.host_ws = websocket
                    self.host_client_id = host_id

                    state = ClientState(
                        clientId=host_id,
                        deviceName="Master Laptop (Host)",
                        role="host",
                        connected=True,
                        ipAddress=client_ip,
                        lastSeen=MasterClock.now_ms()
                    )
                    self.clients[host_id] = (websocket, state)
                    logger.info(f"Master Host registered: [{host_id}] from {client_ip}")

                    session_info = self.session_manager.get_state().model_dump()
                    await self._send_json(websocket, {
                        "version": PROTOCOL_VERSION,
                        "type": MessageType.WELCOME.value,
                        "clientId": host_id,
                        "role": "host",
                        "serverTime": MasterClock.now_ms(),
                        "session": session_info,
                        "clients": self.get_client_list_payload()
                    })
                    continue

                # Update sender's lastSeen timestamp
                if current_client_id and current_client_id in self.clients:
                    self.clients[current_client_id][1].lastSeen = MasterClock.now_ms()

                # 4.5. LIVE SYNC FROM MASTER HOST
                if msg_type == MessageType.SYNC.value:
                    if current_client_id == self.host_client_id or (current_client_id in self.clients and self.clients[current_client_id][1].role == "host"):
                        c_time = float(raw_msg.get("currentTime", 0.0))
                        is_playing = bool(raw_msg.get("playing", False))
                        p_rate = float(raw_msg.get("playbackRate", 1.0))
                        m_ts = raw_msg.get("masterTimestamp")
                        if m_ts is not None:
                            try:
                                m_ts = float(m_ts)
                            except (ValueError, TypeError):
                                m_ts = None
                        self.session_manager.update_from_host(c_time, is_playing, p_rate, master_timestamp=m_ts)
                        payload = self.session_manager.get_sync_payload()
                        await self.broadcast_to_receivers(payload)
                    continue

                # 4.6. REMOTE CALIBRATION (from Host to Phone or vice-versa)
                if msg_type == "calibrate":
                    target_id = raw_msg.get("targetId")
                    offset_ms = raw_msg.get("offsetMs", 0)
                    if target_id and target_id in self.clients:
                        target_ws, _ = self.clients[target_id]
                        await self._send_json(target_ws, {
                            "version": PROTOCOL_VERSION,
                            "type": "calibrate",
                            "offsetMs": offset_ms
                        })
                    continue

                # 5. PLAY COMMAND (from Host)
                if msg_type == MessageType.PLAY.value:
                    pos = raw_msg.get("position")
                    start_at = raw_msg.get("startAt")
                    # If startAt was not provided, schedule it 150ms into the future for packet travel
                    if not start_at:
                        start_at = MasterClock.now_ms() + 150.0

                    new_state = self.session_manager.play(position=pos, start_at=start_at)
                    payload = {
                        "version": PROTOCOL_VERSION,
                        "type": MessageType.PLAY.value,
                        "position": pos if pos is not None else new_state.currentTime,
                        "startAt": start_at,
                        "playbackRate": new_state.playbackRate,
                        "sequence": new_state.sequence,
                        "serverTime": MasterClock.now_ms()
                    }
                    await self.broadcast_to_receivers(payload)
                    continue

                # 6. PAUSE COMMAND (from Host)
                if msg_type == MessageType.PAUSE.value:
                    pos = raw_msg.get("position")
                    new_state = self.session_manager.pause(position=pos)
                    payload = {
                        "version": PROTOCOL_VERSION,
                        "type": MessageType.PAUSE.value,
                        "position": new_state.currentTime,
                        "sequence": new_state.sequence,
                        "serverTime": MasterClock.now_ms()
                    }
                    await self.broadcast_to_receivers(payload)
                    continue

                # 7. SEEK COMMAND (from Host)
                if msg_type == MessageType.SEEK.value:
                    pos = float(raw_msg.get("position", 0.0))
                    new_state = self.session_manager.seek(pos)
                    payload = {
                        "version": PROTOCOL_VERSION,
                        "type": MessageType.SEEK.value,
                        "position": new_state.currentTime,
                        "playing": new_state.playing,
                        "sequence": new_state.sequence,
                        "serverTime": MasterClock.now_ms()
                    }
                    await self.broadcast_to_receivers(payload)
                    continue

                # 8. SET RATE COMMAND (from Host)
                if msg_type == MessageType.SET_RATE.value:
                    rate = float(raw_msg.get("playbackRate", 1.0))
                    new_state = self.session_manager.set_rate(rate)
                    payload = {
                        "version": PROTOCOL_VERSION,
                        "type": MessageType.SET_RATE.value,
                        "playbackRate": new_state.playbackRate,
                        "currentTime": new_state.currentTime,
                        "sequence": new_state.sequence,
                        "serverTime": MasterClock.now_ms()
                    }
                    await self.broadcast_to_receivers(payload)
                    continue

                # 9. LOAD VIDEO COMMAND (from Host)
                if msg_type == MessageType.LOAD.value:
                    v_id = raw_msg.get("videoId")
                    v_name = raw_msg.get("videoName", "Movie")
                    v_url = raw_msg.get("videoUrl", f"/media/{v_id}")
                    dur = float(raw_msg.get("duration", 0.0))
                    size = int(raw_msg.get("fileSize", 0))
                    mime = raw_msg.get("mimeType", "video/mp4")
                    new_state = self.session_manager.load_video(v_id, v_name, v_url, dur, size, mime)
                    payload = {
                        "version": PROTOCOL_VERSION,
                        "type": MessageType.LOAD.value,
                        "videoId": v_id,
                        "videoName": v_name,
                        "videoUrl": v_url,
                        "duration": dur,
                        "fileSize": size,
                        "mimeType": mime,
                        "sequence": new_state.sequence,
                        "serverTime": MasterClock.now_ms()
                    }
                    await self.broadcast_to_receivers(payload)
                    continue

                # 10. UNLOAD VIDEO COMMAND
                if msg_type == MessageType.UNLOAD.value:
                    new_state = self.session_manager.unload_video()
                    payload = {
                        "version": PROTOCOL_VERSION,
                        "type": MessageType.UNLOAD.value,
                        "sequence": new_state.sequence,
                        "serverTime": MasterClock.now_ms()
                    }
                    await self.broadcast_to_receivers(payload)
                    continue

                # 11. TELEMETRY REPORT (from Receiver)
                if msg_type == MessageType.TELEMETRY.value:
                    client_id = raw_msg.get("clientId")
                    if client_id and client_id in self.clients:
                        _, client_state = self.clients[client_id]
                        client_state.latencyMs = round(float(raw_msg.get("latencyMs", 0.0)), 1)
                        client_state.clockOffsetMs = round(float(raw_msg.get("clockOffsetMs", 0.0)), 1)
                        client_state.driftMs = round(float(raw_msg.get("driftMs", 0.0)), 1)
                        client_state.calibrationOffsetMs = round(float(raw_msg.get("calibrationOffsetMs", 0.0)), 1)
                        client_state.playbackState = raw_msg.get("playbackState", "playing")
                        client_state.deviceName = raw_msg.get("deviceName", client_state.deviceName)
                        client_state.lastSeen = MasterClock.now_ms()

                        # Forward live telemetry to host
                        telemetry_update = {
                            "version": PROTOCOL_VERSION,
                            "type": MessageType.TELEMETRY.value,
                            "client": client_state.model_dump(),
                            "serverTime": MasterClock.now_ms()
                        }
                        await self.send_to_host(telemetry_update)
                    continue

                # 12. OPTIONAL OFFLINE WEBRTC SIGNALING (Offer, Answer, Candidate)
                if msg_type in (MessageType.WEBRTC_OFFER.value, MessageType.WEBRTC_ANSWER.value, MessageType.WEBRTC_CANDIDATE.value):
                    target_id = raw_msg.get("targetId")
                    if target_id and target_id in self.clients:
                        target_ws, _ = self.clients[target_id]
                        await self._send_json(target_ws, {
                            **raw_msg,
                            "senderId": current_client_id
                        })
                    elif not target_id and self.host_ws and current_client_id != self.host_client_id:
                        # Forward to host by default if target not specified
                        await self.send_to_host({
                            **raw_msg,
                            "senderId": current_client_id
                        })
                    continue

        except WebSocketDisconnect:
            pass
        except Exception as e:
            logger.warning(f"WebSocket error for client {current_client_id}: {e}")
        finally:
            if current_client_id:
                await self.disconnect_client(current_client_id)


def uuid_short() -> str:
    import uuid
    return uuid.uuid4().hex[:6]
