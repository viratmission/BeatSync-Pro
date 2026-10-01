"""
High-performance HTTP Range media streaming service for large local video files.
Compliant with RFC 7233. Supports multi-gigabyte video files without loading into RAM.
"""

import os
import mimetypes
import uuid
import logging
from typing import Optional, Dict, Tuple, AsyncGenerator
from fastapi import Request, HTTPException
from fastapi.responses import StreamingResponse, Response

logger = logging.getLogger("BeatSync.Media")

# 256 KB chunk size for smooth low-latency streaming and low memory footprint
CHUNK_SIZE = 256 * 1024


class MediaItem:
    def __init__(self, video_id: str, file_path: str, display_name: str, duration: float = 0.0):
        self.video_id = video_id
        self.file_path = os.path.abspath(file_path)
        self.display_name = display_name
        self.duration = duration
        self.file_size = os.path.getsize(self.file_path) if os.path.exists(self.file_path) else 0
        
        # Determine MIME type
        mime, _ = mimetypes.guess_type(self.file_path)
        if not mime:
            ext = os.path.splitext(self.file_path)[1].lower()
            if ext == ".mkv":
                mime = "video/x-matroska"
            elif ext == ".mp4":
                mime = "video/mp4"
            elif ext == ".webm":
                mime = "video/webm"
            elif ext == ".mov":
                mime = "video/quicktime"
            else:
                mime = "video/mp4"
        self.mime_type = mime


class MediaManager:
    def __init__(self):
        self.videos: Dict[str, MediaItem] = {}

    def register_file(self, file_path: str, display_name: Optional[str] = None, duration: float = 0.0) -> MediaItem:
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Video file does not exist: {file_path}")
        
        abs_path = os.path.abspath(file_path)
        # Check if already registered
        for vid_id, item in self.videos.items():
            if item.file_path.lower() == abs_path.lower():
                return item

        video_id = f"vid-{uuid.uuid4().hex[:8]}"
        name = display_name or os.path.basename(file_path)
        item = MediaItem(video_id, abs_path, name, duration)
        self.videos[video_id] = item
        logger.info(f"Registered video: {name} [{video_id}] ({item.file_size / (1024*1024):.2f} MB)")
        return item

    def get_video(self, video_id: str) -> Optional[MediaItem]:
        return self.videos.get(video_id)

    def parse_range_header(self, range_header: str, file_size: int) -> Tuple[int, int]:
        """
        Parses Range: bytes=start-end
        Returns (start, end)
        """
        try:
            bytes_range = range_header.strip().lower()
            if not bytes_range.startswith("bytes="):
                raise ValueError("Invalid range prefix")
            range_values = bytes_range[6:].split("-")
            start_str, end_str = range_values[0], range_values[1]
            
            if start_str == "":
                # Suffix byte range: bytes=-500 (last 500 bytes)
                suffix_len = int(end_str)
                start = max(0, file_size - suffix_len)
                end = file_size - 1
            elif end_str == "":
                # Open range: bytes=500- (from 500 to end)
                start = int(start_str)
                end = file_size - 1
            else:
                start = int(start_str)
                end = int(end_str)

            # Cap end to file_size - 1
            if end >= file_size:
                end = file_size - 1
                
            if start > end or start >= file_size:
                raise ValueError("Unsatisfiable range")
                
            return start, end
        except Exception as e:
            logger.warning(f"Error parsing range header '{range_header}': {e}")
            raise HTTPException(
                status_code=416,
                detail="Requested Range Not Satisfiable",
                headers={"Content-Range": f"bytes */{file_size}"}
            )

    async def stream_file_chunks(self, file_path: str, start: int, end: int) -> AsyncGenerator[bytes, None]:
        """
        Asynchronously streams file chunks from start to end byte offsets without loading into RAM.
        """
        bytes_to_read = (end - start) + 1
        with open(file_path, "rb") as f:
            f.seek(start)
            while bytes_to_read > 0:
                current_chunk_size = min(CHUNK_SIZE, bytes_to_read)
                data = f.read(current_chunk_size)
                if not data:
                    break
                bytes_to_read -= len(data)
                yield data

    def create_streaming_response(self, video_id: str, request: Request) -> Response:
        """
        Generates HTTP 206 Partial Content or HTTP 200 Response for video playback.
        """
        item = self.get_video(video_id)
        if not item or not os.path.exists(item.file_path):
            raise HTTPException(status_code=404, detail="Video file not found")

        file_size = item.file_size
        range_header = request.headers.get("range")

        if range_header:
            start, end = self.parse_range_header(range_header, file_size)
            content_length = (end - start) + 1
            
            headers = {
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(content_length),
                "Content-Type": item.mime_type,
                "Cache-Control": "no-cache",
            }
            return StreamingResponse(
                self.stream_file_chunks(item.file_path, start, end),
                status_code=206,
                headers=headers,
                media_type=item.mime_type
            )
        else:
            # Full file requested
            headers = {
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
                "Content-Type": item.mime_type,
                "Cache-Control": "no-cache",
            }
            return StreamingResponse(
                self.stream_file_chunks(item.file_path, 0, file_size - 1),
                status_code=200,
                headers=headers,
                media_type=item.mime_type
            )


# Global media manager instance
media_manager = MediaManager()
