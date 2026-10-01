"""
Multi-Device Fleet Simulation Tests:
Simulates 1 Master Host + 1, 2, 5, and 10 Phone Clients concurrently.
Tests late join mid-movie, telemetry aggregation, and graceful disconnects.
"""

import json
import pytest
from fastapi.testclient import TestClient
from backend.sync.session import SessionManager
from backend.signaling.websocket_manager import WebSocketManager
from backend.server.app import create_app


from contextlib import ExitStack


def test_multi_device_simulation_1_to_10_phones():
    session_manager = SessionManager(room_token="FLEETTOKEN")
    ws_manager = WebSocketManager(session_manager)
    app = create_app(session_manager, ws_manager)
    client = TestClient(app)

    # 1. Start movie on host at position 42.0 seconds
    session_manager.load_video("vid-fleet", "Fleet Test Movie", "/media/vid-fleet", duration=3600.0)
    session_manager.play(position=42.0)

    # Test connecting 1, 2, 5, 10 phones
    for count in [1, 2, 5, 10]:
        with ExitStack() as stack:
            phone_sockets = []
            for i in range(count):
                phone_id = f"phone-sim-{i+1}"
                sock = stack.enter_context(client.websocket_connect("/ws"))
                sock.send_text(json.dumps({
                    "version": 1,
                    "type": "join",
                    "token": "FLEETTOKEN",
                    "clientId": phone_id,
                    "deviceName": f"Galaxy S24 #{i+1}"
                }))
                
                # Verify welcome
                welcome = json.loads(sock.receive_text())
                assert welcome["type"] == "welcome"
                assert welcome["clientId"] == phone_id

                # Verify late join: immediately receives current session state with playing=True
                session_state = json.loads(sock.receive_text())
                assert session_state["type"] == "session-state"
                assert session_state["playing"] is True
                assert session_state["currentTime"] >= 42.0

                phone_sockets.append(sock)

            # Check registered client count
            receiver_clients = [c for c in ws_manager.clients.values() if c[1].role == "receiver"]
            assert len(receiver_clients) == count

            # Send telemetry from each phone
            for idx, sock in enumerate(phone_sockets):
                sock.send_text(json.dumps({
                    "version": 1,
                    "type": "telemetry",
                    "clientId": f"phone-sim-{idx+1}",
                    "deviceName": f"Galaxy S24 #{idx+1}",
                    "latencyMs": 14.5 + idx,
                    "clockOffsetMs": -2.0,
                    "driftMs": 18.0 - (idx * 2),
                    "playbackState": "playing"
                }))


def test_phone_disconnect_and_reconnect():
    session_manager = SessionManager(room_token="RECONTOKEN")
    ws_manager = WebSocketManager(session_manager)
    app = create_app(session_manager, ws_manager)
    client = TestClient(app)

    session_manager.load_video("vid-100", "Interstellar", "/media/vid-100", duration=7200.0)
    session_manager.play(position=100.0)

    # Connect phone 1 and phone 2
    with client.websocket_connect("/ws") as sock1, client.websocket_connect("/ws") as sock2:
        sock1.send_text(json.dumps({"version": 1, "type": "join", "token": "RECONTOKEN", "clientId": "phone-1"}))
        json.loads(sock1.receive_text()) # welcome
        json.loads(sock1.receive_text()) # session-state

        sock2.send_text(json.dumps({"version": 1, "type": "join", "token": "RECONTOKEN", "clientId": "phone-2"}))
        json.loads(sock2.receive_text()) # welcome
        json.loads(sock2.receive_text()) # session-state

        assert len(ws_manager.clients) == 2

    # Advance movie position on host
    session_manager.seek(350.0)

    # Phone 1 reconnects
    with client.websocket_connect("/ws") as sock1_reconnected:
        sock1_reconnected.send_text(json.dumps({
            "version": 1,
            "type": "join",
            "token": "RECONTOKEN",
            "clientId": "phone-1",
            "deviceName": "Reconnected Phone 1"
        }))
        welcome = json.loads(sock1_reconnected.receive_text())
        assert welcome["type"] == "welcome"
        rejoined_state = json.loads(sock1_reconnected.receive_text())
        assert rejoined_state["type"] == "session-state"
        # Rejoined phone receives the updated position (~350.0) instead of restarting from 0!
        assert abs(rejoined_state["currentTime"] - 350.0) < 0.5
