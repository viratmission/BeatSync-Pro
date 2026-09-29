using BeatSync.API.DTOs;
using BeatSync.API.Services;
using Microsoft.AspNetCore.Mvc;

namespace BeatSync.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class RoomsController : ControllerBase
{
    private readonly IRoomService _roomService;
    private readonly IParticipantService _participantService;
    private readonly ITrackService _trackService;
    private readonly ISyncService _syncService;

    public RoomsController(
        IRoomService roomService,
        IParticipantService participantService,
        ITrackService trackService,
        ISyncService syncService)
    {
        _roomService = roomService;
        _participantService = participantService;
        _trackService = trackService;
        _syncService = syncService;
    }

    [HttpGet]
    public async Task<ActionResult<List<RoomDto>>> GetActiveRooms()
    {
        var rooms = await _roomService.GetActiveRoomsAsync();
        return Ok(rooms);
    }

    [HttpGet("{roomCode}")]
    public async Task<ActionResult<RoomDto>> GetRoomByCode(string roomCode)
    {
        if (string.IsNullOrWhiteSpace(roomCode) || roomCode.Trim().Length != 6)
        {
            return BadRequest(new { message = "Room code must be exactly 6 characters." });
        }

        var room = await _roomService.GetRoomByCodeAsync(roomCode);
        if (room == null || !room.IsActive)
        {
            return NotFound(new { message = $"Room with code '{roomCode.ToUpper()}' not found." });
        }

        return Ok(room);
    }

    [HttpPost]
    public async Task<ActionResult<RoomDto>> CreateRoom([FromBody] CreateRoomDto dto)
    {
        if (!ModelState.IsValid)
        {
            return BadRequest(ModelState);
        }

        var room = await _roomService.CreateRoomAsync(dto);
        return CreatedAtAction(nameof(GetRoomByCode), new { roomCode = room.RoomCode }, room);
    }

    [HttpPost("{roomCode}/join")]
    public async Task<ActionResult<RoomStateDto>> JoinRoom(string roomCode, [FromBody] JoinRoomDto dto)
    {
        if (!ModelState.IsValid)
        {
            return BadRequest(ModelState);
        }

        var normalizedCode = roomCode.Trim().ToUpper();
        if (!string.Equals(normalizedCode, dto.RoomCode.Trim().ToUpper(), StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new { message = "Room code in URL does not match body." });
        }

        var room = await _roomService.GetRoomByCodeAsync(normalizedCode);
        if (room == null || !room.IsActive)
        {
            return NotFound(new { message = "Room not found or is no longer active." });
        }

        var participants = await _participantService.GetParticipantsByRoomCodeAsync(normalizedCode);
        var tracks = await _trackService.GetAllTracksAsync();
        var playbackState = _syncService.GetPlaybackState(normalizedCode);
        var currentTrack = tracks.FirstOrDefault(t => t.Id == playbackState.TrackId) ?? tracks.FirstOrDefault();

        var state = new RoomStateDto
        {
            Room = room,
            Participants = participants,
            CurrentTrack = currentTrack,
            PlaybackState = playbackState,
            AvailableTracks = tracks
        };

        return Ok(state);
    }

    [HttpPost("{roomCode}/leave")]
    public async Task<IActionResult> LeaveRoom(string roomCode, [FromQuery] string connectionId)
    {
        if (string.IsNullOrWhiteSpace(connectionId))
        {
            return BadRequest(new { message = "Connection ID is required." });
        }

        var removed = await _participantService.RemoveParticipantAsync(roomCode, connectionId);
        return Ok(new { success = removed });
    }

    [HttpGet("{roomCode}/participants")]
    public async Task<ActionResult<List<ParticipantDto>>> GetParticipants(string roomCode)
    {
        var valid = await _roomService.ValidateRoomAsync(roomCode);
        if (!valid)
        {
            return NotFound(new { message = "Room not found." });
        }

        var participants = await _participantService.GetParticipantsByRoomCodeAsync(roomCode);
        return Ok(participants);
    }
}
