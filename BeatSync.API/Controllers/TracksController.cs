using BeatSync.API.DTOs;
using BeatSync.API.Services;
using Microsoft.AspNetCore.Mvc;

namespace BeatSync.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class TracksController : ControllerBase
{
    private readonly ITrackService _trackService;
    private readonly IWebHostEnvironment _environment;

    public TracksController(ITrackService trackService, IWebHostEnvironment environment)
    {
        _trackService = trackService;
        _environment = environment;
    }

    [HttpGet]
    public async Task<ActionResult<List<TrackDto>>> GetAllTracks()
    {
        var tracks = await _trackService.GetAllTracksAsync();
        return Ok(tracks);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<TrackDto>> GetTrack(int id)
    {
        var track = await _trackService.GetTrackByIdAsync(id);
        if (track == null)
        {
            return NotFound(new { message = "Track not found." });
        }

        return Ok(track);
    }

    [HttpPost]
    public async Task<ActionResult<TrackDto>> CreateTrack([FromBody] TrackDto dto)
    {
        if (!ModelState.IsValid)
        {
            return BadRequest(ModelState);
        }

        var created = await _trackService.CreateTrackAsync(dto);
        return CreatedAtAction(nameof(GetTrack), new { id = created.Id }, created);
    }

    [HttpPost("upload")]
    public async Task<ActionResult<TrackDto>> UploadTrack([FromForm] IFormFile file, [FromForm] string title, [FromForm] string artist, [FromForm] double? duration)
    {
        if (file == null || file.Length == 0)
        {
            return BadRequest(new { message = "No audio file provided." });
        }

        var allowedExtensions = new[] { ".mp3", ".wav", ".ogg", ".m4a", ".aac" };
        var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!allowedExtensions.Contains(extension))
        {
            return BadRequest(new { message = $"Invalid file format '{extension}'. Allowed: mp3, wav, ogg, m4a, aac" });
        }

        // Limit file size to 25MB
        if (file.Length > 25 * 1024 * 1024)
        {
            return BadRequest(new { message = "Audio file exceeds maximum allowed size of 25MB." });
        }

        var uploadsDir = Path.Combine(_environment.WebRootPath ?? Path.Combine(_environment.ContentRootPath, "wwwroot"), "audio");
        if (!Directory.Exists(uploadsDir))
        {
            Directory.CreateDirectory(uploadsDir);
        }

        var safeFileName = $"{Guid.NewGuid():N}{extension}";
        var filePath = Path.Combine(uploadsDir, safeFileName);

        using (var stream = new FileStream(filePath, FileMode.Create))
        {
            await file.CopyToAsync(stream);
        }

        var audioUrl = $"/audio/{safeFileName}";
        var newTrack = new TrackDto
        {
            Title = string.IsNullOrWhiteSpace(title) ? Path.GetFileNameWithoutExtension(file.FileName) : title.Trim(),
            Artist = string.IsNullOrWhiteSpace(artist) ? "Unknown Artist" : artist.Trim(),
            AudioUrl = audioUrl,
            ArtworkUrl = null,
            Duration = duration.HasValue && duration.Value > 0 ? duration.Value : 180.0
        };

        var created = await _trackService.CreateTrackAsync(newTrack);
        return CreatedAtAction(nameof(GetTrack), new { id = created.Id }, created);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> DeleteTrack(int id)
    {
        var deleted = await _trackService.DeleteTrackAsync(id);
        if (!deleted)
        {
            return NotFound(new { message = "Track not found." });
        }

        return NoContent();
    }
}
