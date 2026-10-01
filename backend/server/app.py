"""
FastAPI Server Application for BeatSync-Pro.
Coordinates HTTP range streaming, WebSocket signaling, REST endpoints, and static web UI.
"""

import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, WebSocket, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse

from backend.sync.session import SessionManager
from backend.signaling.websocket_manager import WebSocketManager
from backend.media.streamer import media_manager
from backend.api.routes import create_routes


def create_app(session_manager: SessionManager, ws_manager: WebSocketManager, port: int = 8080) -> FastAPI:
    
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Startup
        ws_manager.start_background_tasks()
        yield
        # Shutdown
        ws_manager.stop_background_tasks()

    app = FastAPI(
        title="BeatSync-Pro Offline LAN Server",
        version="1.0.0",
        lifespan=lifespan
    )

    # Enable CORS for all local LAN devices
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Base frontend paths
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    frontend_dir = os.path.join(base_dir, "frontend")
    host_dir = os.path.join(frontend_dir, "host")
    receiver_dir = os.path.join(frontend_dir, "receiver")
    shared_dir = os.path.join(frontend_dir, "shared")

    # Mount static assets
    if os.path.exists(shared_dir):
        app.mount("/shared", StaticFiles(directory=shared_dir), name="shared")
    if os.path.exists(host_dir):
        app.mount("/static/host", StaticFiles(directory=host_dir), name="static_host")
    if os.path.exists(receiver_dir):
        app.mount("/static/receiver", StaticFiles(directory=receiver_dir), name="static_receiver")

    # Include REST API
    app.include_router(create_routes(session_manager, port), prefix="/api")

    # Root route: intelligent redirection or portal
    @app.get("/")
    async def root_index(request: Request):
        user_agent = request.headers.get("user-agent", "").lower()
        token = request.query_params.get("token", session_manager.state.roomToken)
        
        # If mobile device, redirect directly to receiver player
        is_mobile = any(keyword in user_agent for keyword in ["iphone", "android", "mobile", "ipad"])
        if is_mobile:
            return RedirectResponse(url=f"/player?token={token}")
        
        # Laptop / Desktop default: redirect to host dashboard
        return RedirectResponse(url=f"/host?token={token}")

    # Host dashboard page
    @app.get("/host")
    async def get_host_page():
        host_index = os.path.join(host_dir, "index.html")
        if not os.path.exists(host_index):
            raise HTTPException(status_code=404, detail="Host UI not found")
        return FileResponse(host_index, media_type="text/html")

    # Portal device selector page
    @app.get("/portal")
    async def get_portal_page():
        portal_path = os.path.join(frontend_dir, "portal.html")
        if not os.path.exists(portal_path):
            raise HTTPException(status_code=404, detail="Portal page not found")
        return FileResponse(portal_path, media_type="text/html")

    # Receiver player page
    @app.get("/player")
    async def get_player_page():
        receiver_index = os.path.join(receiver_dir, "index.html")
        if not os.path.exists(receiver_index):
            raise HTTPException(status_code=404, detail="Receiver UI not found")
        return FileResponse(receiver_index, media_type="text/html")

    # Media streaming endpoint with HTTP Range support
    @app.get("/media/{video_id}")
    async def stream_media(video_id: str, request: Request):
        return media_manager.create_streaming_response(video_id, request)

    # Real-time WebSocket signaling endpoint
    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        await ws_manager.handle_connection(websocket)

    return app
