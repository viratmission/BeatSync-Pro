"""
Tests for WebSocket Signaling & REST API Routes
"""

import json
import pytest
from fastapi.testclient import TestClient
from backend.sync.session import SessionManager
from backend.signaling.websocket_manager import WebSocketManager
from backend.server.app import create_app


@pytest.fixture
def app_and_managers():
    sm = SessionManager(room_token="TESTTOKEN")
    wm = WebSocketManager(sm)
    app = create_app(sm, wm)
    return app, sm, wm


def test_api_health_and_session(app_and_managers):
    app, sm, _ = app_and_managers
    client = TestClient(app)

    # Health check
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["mode"] == "offline-lan"

    # Session info
    res_sess = client.get("/api/session")
    assert res_sess.status_code == 200
    sess_data = res_sess.json()
    assert sess_data["session"]["roomToken"] == "TESTTOKEN"


def test_qr_code_generation(app_and_managers):
    app, _, _ = app_and_managers
    client = TestClient(app)

    res = client.get("/api/qr")
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"
    # Check PNG signature: bytes 137, 80, 78, 71, 13, 10, 26, 10
    assert res.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_websocket_signaling_flow(app_and_managers):
    app, sm, _ = app_and_managers
    client = TestClient(app)

    # Connect receiver
    with client.websocket_connect("/ws") as receiver_ws:
        # Send Join
        receiver_ws.send_text(json.dumps({
            "version": 1,
            "type": "join",
            "token": "TESTTOKEN",
            "clientId": "phone-001",
            "deviceName": "Test Phone"
        }))

        # Expect welcome
        welcome_raw = receiver_ws.receive_text()
        welcome = json.loads(welcome_raw)
        assert welcome["type"] == "welcome"
        assert welcome["clientId"] == "phone-001"

        # Expect session-state
        session_raw = receiver_ws.receive_text()
        session_msg = json.loads(session_raw)
        assert session_msg["type"] == "session-state"

        # Test NTP Clock Ping / Pong
        t0 = 1720000000000
        receiver_ws.send_text(json.dumps({
            "version": 1,
            "type": "clock-ping",
            "clientTime": t0
        }))
        pong_raw = receiver_ws.receive_text()
        pong = json.loads(pong_raw)
        assert pong["type"] == "clock-pong"
        assert pong["clientTime"] == t0
        assert pong["serverTime"] > 0


def test_host_play_pause_seek_broadcast(app_and_managers):
    app, sm, wm = app_and_managers
    client = TestClient(app)

    with client.websocket_connect("/ws") as host_ws:
        # Register host
        host_ws.send_text(json.dumps({
            "version": 1,
            "type": "host",
            "token": "TESTTOKEN",
            "clientId": "host-master"
        }))
        host_welcome = json.loads(host_ws.receive_text())
        assert host_welcome["type"] == "welcome"

        # Connect receiver in same session
        with client.websocket_connect("/ws") as receiver_ws:
            receiver_ws.send_text(json.dumps({
                "version": 1,
                "type": "join",
                "token": "TESTTOKEN",
                "clientId": "phone-receiver-1"
            }))
            # Consume welcome & session-state
            json.loads(receiver_ws.receive_text())
            json.loads(receiver_ws.receive_text())

            # 1. Host issues PLAY
            host_ws.send_text(json.dumps({
                "version": 1,
                "type": "play",
                "position": 25.5,
                "startAt": 1720000001000
            }))

            # Receiver receives PLAY command
            rx_play = json.loads(receiver_ws.receive_text())
            assert rx_play["type"] == "play"
            assert rx_play["position"] == 25.5
            assert rx_play["startAt"] == 1720000001000

            # 2. Host issues PAUSE
            host_ws.send_text(json.dumps({
                "version": 1,
                "type": "pause",
                "position": 30.0
            }))
            rx_pause = json.loads(receiver_ws.receive_text())
            assert rx_pause["type"] == "pause"
            assert rx_pause["position"] == 30.0

            # 3. Host issues SEEK
            host_ws.send_text(json.dumps({
                "version": 1,
                "type": "seek",
                "position": 120.0
            }))
            rx_seek = json.loads(receiver_ws.receive_text())
            assert rx_seek["type"] == "seek"
            assert rx_seek["position"] == 120.0


def test_malformed_json_packet(app_and_managers):
    app, _, _ = app_and_managers
    client = TestClient(app)

    with client.websocket_connect("/ws") as ws:
        # Send raw invalid string
        ws.send_text("NOT_JSON")
        err_raw = ws.receive_text()
        err_msg = json.loads(err_raw)
        assert err_msg["type"] == "error"
        assert "Malformed" in err_msg["error"]
