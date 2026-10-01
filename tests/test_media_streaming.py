"""
Tests for Media Streaming & RFC 7233 HTTP Range Requests
"""

import os
import pytest
from fastapi.testclient import TestClient
from backend.media.streamer import MediaManager, media_manager
from backend.sync.session import SessionManager
from backend.signaling.websocket_manager import WebSocketManager
from backend.server.app import create_app


@pytest.fixture
def sample_file():
    path = os.path.abspath("sample_video.mp4")
    if not os.path.exists(path):
        # Create a small dummy video file if sample_video not present
        with open(path, "wb") as f:
            f.write(b"\x00" * 10000)
    return path


def test_range_header_parsing():
    mm = MediaManager()
    file_size = 100000

    # Normal range
    start, end = mm.parse_range_header("bytes=0-499", file_size)
    assert start == 0
    assert end == 499

    # Open end range
    start, end = mm.parse_range_header("bytes=1000-", file_size)
    assert start == 1000
    assert end == file_size - 1

    # Suffix range (last 500 bytes)
    start, end = mm.parse_range_header("bytes=-500", file_size)
    assert start == file_size - 500
    assert end == file_size - 1


def test_media_item_registration(sample_file):
    item = media_manager.register_file(sample_file, display_name="Test Video")
    assert item.video_id.startswith("vid-")
    assert item.display_name == "Test Video"
    assert item.file_size > 0
    assert item.mime_type == "video/mp4"


def test_http_range_streaming_206(sample_file):
    session_manager = SessionManager(room_token="TEST123")
    ws_manager = WebSocketManager(session_manager)
    app = create_app(session_manager, ws_manager)
    client = TestClient(app)

    item = media_manager.register_file(sample_file, display_name="Streaming Test")
    
    # 1. Full file request
    res_full = client.get(f"/media/{item.video_id}")
    assert res_full.status_code == 200
    assert res_full.headers["accept-ranges"] == "bytes"
    assert int(res_full.headers["content-length"]) == item.file_size

    # 2. HTTP Range request for first 1024 bytes (RFC 7233)
    headers = {"Range": "bytes=0-1023"}
    res_range = client.get(f"/media/{item.video_id}", headers=headers)
    assert res_range.status_code == 206
    assert res_range.headers["content-range"] == f"bytes 0-1023/{item.file_size}"
    assert res_range.headers["content-length"] == "1024"
    assert len(res_range.content) == 1024

    # 3. HTTP Range request for middle slice
    headers_mid = {"Range": "bytes=100-299"}
    res_mid = client.get(f"/media/{item.video_id}", headers=headers_mid)
    assert res_mid.status_code == 206
    assert res_mid.headers["content-range"] == f"bytes 100-299/{item.file_size}"
    assert res_mid.headers["content-length"] == "200"
    assert len(res_mid.content) == 200
