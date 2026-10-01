"""
BeatSync-Pro Offline LAN Video + Audio Sync
Main Application Server Entry Point
"""

import os
import sys
import argparse
import secrets
import webbrowser
import logging
import uvicorn

# Add workspace root to Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.sync.session import SessionManager
from backend.signaling.websocket_manager import WebSocketManager
from backend.media.streamer import media_manager
from backend.api.network import get_lan_ip_addresses, get_primary_lan_ip
from backend.server.app import create_app

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("BeatSync.Main")


# Ensure UTF-8 stdout encoding on Windows
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def print_banner(primary_ip: str, port: int, token: str, all_ips: list):
    host_url = f"http://localhost:{port}/host?token={token}"
    phone_url = f"http://{primary_ip}:{port}/player?token={token}"
    
    print("\n" + "=" * 68)
    print("       BEATSYNC-PRO -- OFFLINE LAN MULTI-DEVICE VIDEO & AUDIO SYNC")
    print("=" * 68)
    print("  [MODE]       100% OFFLINE LOCAL NETWORK (Internet Not Required)")
    print(f"  [SERVER]     Binding to 0.0.0.0:{port} (All Network Interfaces)")
    print(f"  [SECURITY]   Session Token: {token}")
    print("-" * 68)
    print("  [HOST] MASTER LAPTOP (Host Dashboard):")
    print(f"     -> {host_url}")
    print("\n  [CLIENT] CONNECT PHONES (On Same Wi-Fi):")
    print(f"     -> {phone_url}")
    print("     (Or scan the QR code displayed on the laptop host dashboard)")
    
    if len(all_ips) > 1:
        print("\n  [NETWORK] Other Detected Network Adapters:")
        for item in all_ips:
            if item["ip"] != primary_ip:
                print(f"     - http://{item['ip']}:{port}/player?token={token} ({item['type']})")
                
    print("=" * 68 + "\n")


def main():
    parser = argparse.ArgumentParser(description="BeatSync-Pro Offline LAN Server")
    parser.add_argument("--port", type=int, default=8080, help="Port to bind (default: 8080)")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host interface (default: 0.0.0.0)")
    parser.add_argument("--token", type=str, default=None, help="Custom room session token")
    parser.add_argument("--no-browser", action="store_true", help="Do not open browser automatically")
    parser.add_argument("--sample", action="store_true", default=True, help="Auto-load sample video if available")
    args = parser.parse_args()

    # Generate or set session token
    token = args.token or f"SYNC{secrets.randbelow(900) + 100}"
    
    # Initialize Core Singletons
    session_manager = SessionManager(room_token=token)
    ws_manager = WebSocketManager(session_manager)

    # Pre-register sample video if present
    sample_paths = [
        os.path.join(os.getcwd(), "sample_video.mp4"),
        os.path.abspath("sample_video.mp4"),
        os.path.join(os.path.dirname(__file__), "..", "sample_video.mp4")
    ]
    for p in sample_paths:
        if os.path.exists(p):
            try:
                item = media_manager.register_file(
                    file_path=p,
                    display_name="Big Buck Bunny (Sample Demo)"
                )
                session_manager.load_video(
                    video_id=item.video_id,
                    video_name=item.display_name,
                    video_url=f"/media/{item.video_id}",
                    duration=item.duration,
                    file_size=item.file_size,
                    mime_type=item.mime_type
                )
                logger.info(f"Loaded default sample video: {item.display_name}")
                break
            except Exception as e:
                logger.warning(f"Could not load sample video: {e}")

    # Build FastAPI application
    app = create_app(session_manager, ws_manager, port=args.port)

    # Network information
    primary_ip = get_primary_lan_ip()
    all_ips = get_lan_ip_addresses()

    # Print startup banner
    print_banner(primary_ip, args.port, token, all_ips)

    # Optionally launch browser to host dashboard
    if not args.no_browser:
        host_url = f"http://localhost:{args.port}/host?token={token}"
        try:
            webbrowser.open(host_url)
        except Exception:
            pass

    # Start Uvicorn Server
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="info",
        access_log=True
    )


if __name__ == "__main__":
    main()
