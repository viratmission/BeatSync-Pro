# ```python
"""
FastAPI Server Application for BeatSync-Pro.

Coordinates:

- Offline LAN web UI
- HTTP media streaming
- WebSocket signaling
- Authoritative playback session
- WebRTC signaling
- REST API

IMPORTANT:
The application uses ONE authoritative SessionManager instance
from backend.sync.session.

This guarantees that:

    REST API
    WebSocket signaling
    Host playback
    Receiver synchronization

all operate on the same playback timeline.
"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, WebSocket, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse

from backend.sync.session import session_manager
from backend.signaling.websocket_manager import connection_manager
from backend.media.streamer import media_manager
from backend.api.routes import create_routes


PORT = 8080


def create_app(
    port: int = PORT,
) -> FastAPI:

    # ---------------------------------------------------------
    # LIFESPAN
    # ---------------------------------------------------------

    @asynccontextmanager
    async def lifespan(app: FastAPI):

        await connection_manager.start()

        try:
            yield

        finally:
            await connection_manager.stop()

    # ---------------------------------------------------------
    # APPLICATION
    # ---------------------------------------------------------

    app = FastAPI(
        title="BeatSync-Pro Offline LAN Server",
        version="2.0.0",
        lifespan=lifespan,
    )

    # ---------------------------------------------------------
    # CORS
    # ---------------------------------------------------------

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ---------------------------------------------------------
    # PROJECT DIRECTORIES
    # ---------------------------------------------------------

    base_dir = os.path.abspath(
        os.path.join(
            os.path.dirname(__file__),
            "..",
            "..",
        )
    )

    frontend_dir = os.path.join(
        base_dir,
        "frontend",
    )

    host_dir = os.path.join(
        frontend_dir,
        "host",
    )

    receiver_dir = os.path.join(
        frontend_dir,
        "receiver",
    )

    shared_dir = os.path.join(
        frontend_dir,
        "shared",
    )

    # ---------------------------------------------------------
    # STATIC FILES
    # ---------------------------------------------------------

    if os.path.exists(shared_dir):
        app.mount(
            "/shared",
            StaticFiles(
                directory=shared_dir,
            ),
            name="shared",
        )

    if os.path.exists(host_dir):
        app.mount(
            "/static/host",
            StaticFiles(
                directory=host_dir,
            ),
            name="static_host",
        )

    if os.path.exists(receiver_dir):
        app.mount(
            "/static/receiver",
            StaticFiles(
                directory=receiver_dir,
            ),
            name="static_receiver",
        )

    # ---------------------------------------------------------
    # REST API
    # ---------------------------------------------------------

    app.include_router(
        create_routes(
            session_manager,
            port,
        ),
        prefix="/api",
    )

    # ---------------------------------------------------------
    # HEALTH CHECK
    # ---------------------------------------------------------

    @app.get("/health")
    async def health():
        return {
            "status": "ok",
            "service": "BeatSync-Pro",
            "protocol": 2,
            "mode": "offline-lan",
            "webrtc": True,
            "roomId": session_manager.state.roomId,
            "sessionId": session_manager.state.sessionId,
        }

    # ---------------------------------------------------------
    # ROOT ROUTE
    # ---------------------------------------------------------

    @app.get("/")
    async def root_index(
        request: Request,
    ):

        user_agent = (
            request.headers
            .get("user-agent", "")
            .lower()
        )

        token = request.query_params.get(
            "token",
            session_manager.state.roomToken,
        )

        mobile_keywords = (
            "iphone",
            "android",
            "mobile",
            "ipad",
        )

        is_mobile = any(
            keyword in user_agent
            for keyword in mobile_keywords
        )

        if is_mobile:
            return RedirectResponse(
                url=f"/player?token={token}"
            )

        return RedirectResponse(
            url=f"/host?token={token}"
        )

    # ---------------------------------------------------------
    # HOST PAGE
    # ---------------------------------------------------------

    @app.get("/host")
    async def get_host_page():

        host_index = os.path.join(
            host_dir,
            "index.html",
        )

        if not os.path.exists(host_index):
            raise HTTPException(
                status_code=404,
                detail="Host UI not found",
            )

        return FileResponse(
            host_index,
            media_type="text/html",
        )

    # ---------------------------------------------------------
    # PORTAL PAGE
    # ---------------------------------------------------------

    @app.get("/portal")
    async def get_portal_page():

        portal_path = os.path.join(
            frontend_dir,
            "portal.html",
        )

        if not os.path.exists(portal_path):
            raise HTTPException(
                status_code=404,
                detail="Portal page not found",
            )

        return FileResponse(
            portal_path,
            media_type="text/html",
        )

    # ---------------------------------------------------------
    # RECEIVER PAGE
    # ---------------------------------------------------------

    @app.get("/player")
    async def get_player_page():

        receiver_index = os.path.join(
            receiver_dir,
            "index.html",
        )

        if not os.path.exists(receiver_index):
            raise HTTPException(
                status_code=404,
                detail="Receiver UI not found",
            )

        return FileResponse(
            receiver_index,
            media_type="text/html",
        )

    # ---------------------------------------------------------
    # MEDIA STREAMING
    # ---------------------------------------------------------

    @app.get("/media/{video_id}")
    async def stream_media(
        video_id: str,
        request: Request,
    ):

        return media_manager.create_streaming_response(
            video_id,
            request,
        )

    # ---------------------------------------------------------
    # WEBSOCKET SIGNALING
    # ---------------------------------------------------------

    @app.websocket("/ws")
    async def websocket_endpoint(
        websocket: WebSocket,
    ):

        await connection_manager.websocket_endpoint(
            websocket
        )

    return app


# =============================================================
# DEFAULT APPLICATION
# =============================================================

app = create_app()


__all__ = [
    "app",
    "create_app",
]
# ```

# ### இப்போ architecture சரி

# ```text
#                     BeatSync-Pro
#                          │
#               ┌──────────┴──────────┐
#               │                     │
#         REST API              WebSocket
#               │                     │
#               └──────────┬──────────┘
#                          │
#                  session_manager
#                          │
#               Authoritative Timeline
#                          │
#              ┌───────────┴───────────┐
#              │                       │
#            Host                  Receivers
#              │                       │
#              └──── WebRTC Audio ─────┘
# ```

# இப்போ **server start பண்ணலாம்**, ஆனால் முதலில் import/syntax test மட்டும் செய்யலாம்.

# Project folder-ல்:

# ```powershell
# cd D:\BeatSync-Offline

# .\.venv\Scripts\python.exe -c "from backend.server.app import app; print('BEATSYNC BACKEND IMPORT: OK'); print(app.title)"
# ```

# Expected:

# ```text
# BEATSYNC BACKEND IMPORT: OK
# BeatSync-Pro Offline LAN Server
# ```

# **இந்த command-ஐ மட்டும் run பண்ணி output-ஐ அனுப்பு.** Error வந்தாலும் முழு error output அனுப்பு; அதைப் பார்த்து அடுத்த file-ஐ fix பண்ணுவோம்.
