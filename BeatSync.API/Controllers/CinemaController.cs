using BeatSync.API.DTOs;
using BeatSync.API.Services;
using Microsoft.AspNetCore.Mvc;

namespace BeatSync.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class CinemaController : ControllerBase
{
    private readonly IRoomService _roomService;
    private readonly ISyncService _syncService;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<CinemaController> _logger;

    public CinemaController(
        IRoomService roomService,
        ISyncService syncService,
        IWebHostEnvironment env,
        ILogger<CinemaController> logger)
    {
        _roomService = roomService;
        _syncService = syncService;
        _env = env;
        _logger = logger;
    }

    [HttpGet("sample-media")]
    public ActionResult<object> GetSampleMedia()
    {
        return Ok(new
        {
            title = "Cinema Surround Sound Test Film",
            artist = "BeatSync Cinema Engine",
            duration = 60.0,
            audioUrl = "/audio/cinema_surround_demo.wav",
            description = "High-fidelity 60s procedural surround audio test featuring sub-bass pulses, brass horns, and frequency panning sweeps.",
            supportedFormats = new[] { "video/mp4", "video/webm", "video/ogg", "audio/wav", "audio/mp3" }
        });
    }

    [HttpPost("rooms/{roomCode}/media")]
    public async Task<ActionResult<RoomDto>> SetRoomMedia(string roomCode, [FromBody] SetMediaRequest request)
    {
        if (string.IsNullOrWhiteSpace(roomCode) || roomCode.Trim().Length != 6)
        {
            return BadRequest(new { message = "Invalid room code." });
        }

        var room = await _roomService.GetRoomByCodeAsync(roomCode.Trim().ToUpper());
        if (room == null || !room.IsActive)
        {
            return NotFound(new { message = "Room not found." });
        }

        // Update playback state with media metadata
        var cmd = new CinemaPlaybackCommandDto
        {
            CommandType = "LoadMedia",
            Position = 0,
            MediaTitle = request.Title,
            MediaDuration = request.Duration,
            UpdatedBy = request.Username
        };

        _syncService.ExecuteCinemaCommand(roomCode, cmd, request.Username);
        _logger.LogInformation("Room {RoomCode} media set to {Title} ({Duration}s)", roomCode, request.Title, request.Duration);

        return Ok(room);
    }

    [HttpPost("rooms/{roomCode}/audio")]
    [RequestSizeLimit(100 * 1024 * 1024)] // 100MB max audio track upload
    public async Task<ActionResult<object>> UploadRoomAudio(string roomCode, [FromForm] IFormFile file)
    {
        if (file == null || file.Length == 0)
        {
            return BadRequest(new { message = "No audio file uploaded." });
        }

        var normalizedCode = roomCode.Trim().ToUpper();
        var room = await _roomService.GetRoomByCodeAsync(normalizedCode);
        if (room == null || !room.IsActive)
        {
            return NotFound(new { message = "Room not found." });
        }

        var wwwroot = _env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot");
        var cinemaDir = Path.Combine(wwwroot, "audio", "cinema");
        if (!Directory.Exists(cinemaDir))
        {
            Directory.CreateDirectory(cinemaDir);
        }

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        var allowedExts = new[] { ".wav", ".mp3", ".ogg", ".m4a", ".aac", ".webm" };
        if (!allowedExts.Contains(ext))
        {
            return BadRequest(new { message = "Only audio formats (WAV, MP3, OGG, M4A, AAC, WEBM) are supported." });
        }

        var fileName = $"{normalizedCode}_{Guid.NewGuid():N}{ext}";
        var filePath = Path.Combine(cinemaDir, fileName);

        await using (var stream = new FileStream(filePath, FileMode.Create))
        {
            await file.CopyToAsync(stream);
        }

        var audioUrl = $"/audio/cinema/{fileName}";
        _logger.LogInformation("Cinema audio track uploaded for room {RoomCode}: {Url}", normalizedCode, audioUrl);

        return Ok(new
        {
            roomCode = normalizedCode,
            audioUrl = audioUrl,
            fileName = file.FileName,
            sizeBytes = file.Length
        });
    }

    [HttpGet("rooms/{roomCode}/audio")]
    public async Task<IActionResult> StreamRoomAudio(string roomCode)
    {
        var normalizedCode = roomCode.Trim().ToUpper();
        var wwwroot = _env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot");
        var cinemaDir = Path.Combine(wwwroot, "audio", "cinema");

        if (Directory.Exists(cinemaDir))
        {
            var files = Directory.GetFiles(cinemaDir, $"{normalizedCode}_*");
            if (files.Length > 0)
            {
                var latestFile = files.OrderByDescending(System.IO.File.GetCreationTimeUtc).First();
                return PhysicalFile(latestFile, "audio/wav", enableRangeProcessing: true);
            }
        }

        // Fallback to sample procedural cinema audio
        var fallbackPath = Path.Combine(wwwroot, "audio", "cinema_surround_demo.wav");
        if (System.IO.File.Exists(fallbackPath))
        {
            return PhysicalFile(fallbackPath, "audio/wav", enableRangeProcessing: true);
        }

        return NotFound(new { message = "No cinema audio found for this room." });
    }
}

public class SetMediaRequest
{
    public required string Title { get; set; }
    public double Duration { get; set; }
    public string? Username { get; set; }
}
