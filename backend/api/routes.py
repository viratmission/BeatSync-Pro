"""
REST API Routes for BeatSync-Pro.
"""

import io
import os
import qrcode
import logging
from typing import Optional
from fastapi import APIRouter, Request, HTTPException, UploadFile, File, Form
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel

from backend.media.streamer import media_manager
from backend.sync.session import SessionManager
from backend.sync.clock import MasterClock
from backend.api.network import get_lan_ip_addresses, get_primary_lan_ip

logger = logging.getLogger("BeatSync.API")


class SelectVideoRequest(BaseModel):
    filePath: Optional[str] = None
    useSample: Optional[bool] = False
    displayName: Optional[str] = None
    duration: Optional[float] = 0.0


def create_routes(session_manager: SessionManager, server_port: int) -> APIRouter:
    api_router = APIRouter()
    
    @api_router.get("/health")
    async def get_health():
        return {
            "status": "ok",
            "version": "1.0.0",
            "serverTime": MasterClock.now_ms(),
            "mode": "offline-lan"
        }

    @api_router.get("/session")
    async def get_session():
        state = session_manager.get_state()
        return {
            "session": state.model_dump(),
            "serverTime": MasterClock.now_ms()
        }

    @api_router.get("/network-ips")
    async def get_network_ips():
        ips = get_lan_ip_addresses()
        primary = get_primary_lan_ip()
        token = session_manager.state.roomToken
        
        urls = []
        for item in ips:
            ip = item["ip"]
            urls.append({
                "ip": ip,
                "type": item["type"],
                "playerUrl": f"http://{ip}:{server_port}/player?token={token}",
                "hostUrl": f"http://{ip}:{server_port}/host?token={token}"
            })
            
        return {
            "primaryIp": primary,
            "port": server_port,
            "roomToken": token,
            "connectionUrls": urls
        }

    @api_router.get("/qr")
    async def get_qr_code(ip: Optional[str] = None):
        """Generates a high-contrast QR code PNG image locally without internet."""
        target_ip = ip or get_primary_lan_ip()
        token = session_manager.state.roomToken
        url = f"http://{target_ip}:{server_port}/player?token={token}"
        
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=8,
            border=2,
        )
        qr.add_data(url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="#000000", back_color="#ffffff")
        
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        return Response(content=buf.getvalue(), media_type="image/png")

    @api_router.get("/video")
    async def get_current_video():
        state = session_manager.get_state()
        if not state.videoId:
            return {"hasVideo": False, "video": None}
        
        item = media_manager.get_video(state.videoId)
        return {
            "hasVideo": True,
            "video": {
                "videoId": state.videoId,
                "videoName": state.videoName,
                "videoUrl": state.videoUrl,
                "duration": state.duration,
                "fileSize": item.file_size if item else 0,
                "mimeType": item.mime_type if item else "video/mp4",
                "filePath": item.file_path if item else None
            }
        }

    @api_router.post("/video/select")
    async def select_video(req: SelectVideoRequest):
        target_path = None
        display_name = req.displayName

        if req.useSample:
            # Check for sample_video.mp4 in workspace or parent directory
            candidates = [
                os.path.join(os.getcwd(), "sample_video.mp4"),
                os.path.join(os.getcwd(), "public", "sample_video.mp4"),
                os.path.abspath("sample_video.mp4")
            ]
            for c in candidates:
                if os.path.exists(c):
                    target_path = c
                    display_name = display_name or "Big Buck Bunny (Sample Demo)"
                    break
            if not target_path:
                raise HTTPException(status_code=404, detail="Sample video file not found on laptop")
        else:
            if not req.filePath or not os.path.exists(req.filePath):
                raise HTTPException(status_code=400, detail=f"File not found: {req.filePath}")
            target_path = req.filePath
            display_name = display_name or os.path.basename(target_path)

        item = media_manager.register_file(
            file_path=target_path,
            display_name=display_name,
            duration=req.duration or 0.0
        )
        
        video_url = f"/media/{item.video_id}"
        session_manager.load_video(
            video_id=item.video_id,
            video_name=item.display_name,
            video_url=video_url,
            duration=item.duration,
            file_size=item.file_size,
            mime_type=item.mime_type
        )
        
        return {
            "success": True,
            "video": {
                "videoId": item.video_id,
                "videoName": item.display_name,
                "videoUrl": video_url,
                "duration": item.duration,
                "fileSize": item.file_size,
                "mimeType": item.mime_type
            }
        }

    @api_router.post("/video/upload")
    async def upload_video(file: UploadFile = File(...)):
        """Allows direct local file selection/upload from the browser if path access is restricted."""
        upload_dir = os.path.join(os.getcwd(), "uploaded_media")
        os.makedirs(upload_dir, exist_ok=True)
        
        safe_name = os.path.basename(file.filename or "uploaded_video.mp4")
        save_path = os.path.join(upload_dir, safe_name)
        
        with open(save_path, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                f.write(chunk)
                
        item = media_manager.register_file(
            file_path=save_path,
            display_name=safe_name
        )
        
        video_url = f"/media/{item.video_id}"
        session_manager.load_video(
            video_id=item.video_id,
            video_name=item.display_name,
            video_url=video_url,
            duration=item.duration,
            file_size=item.file_size,
            mime_type=item.mime_type
        )
        
        return {
            "success": True,
            "video": {
                "videoId": item.video_id,
                "videoName": item.display_name,
                "videoUrl": video_url,
                "duration": item.duration,
                "fileSize": item.file_size,
                "mimeType": item.mime_type
            }
        }

    return api_router
