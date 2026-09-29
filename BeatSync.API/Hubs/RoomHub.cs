using BeatSync.API.DTOs;
using BeatSync.API.Services;
using Microsoft.AspNetCore.SignalR;

namespace BeatSync.API.Hubs;

public class RoomHub : Hub
{
    private readonly IRoomService _roomService;
    private readonly IParticipantService _participantService;
    private readonly ITrackService _trackService;
    private readonly ISyncService _syncService;
    private readonly ILogger<RoomHub> _logger;

    public RoomHub(
        IRoomService roomService,
        IParticipantService participantService,
        ITrackService trackService,
        ISyncService syncService,
        ILogger<RoomHub> logger)
    {
        _roomService = roomService;
        _participantService = participantService;
        _trackService = trackService;
        _syncService = syncService;
        _logger = logger;
    }

    public async Task<RoomStateDto> JoinRoom(string roomCode, string username)
    {
        if (string.IsNullOrWhiteSpace(roomCode) || string.IsNullOrWhiteSpace(username))
        {
            throw new HubException("Room code and username are required.");
        }

        var normalizedCode = roomCode.Trim().ToUpper();
        var room = await _roomService.GetRoomByCodeAsync(normalizedCode);
        if (room == null || !room.IsActive)
        {
            throw new HubException("Room not found or is no longer active.");
        }

        // Determine if user is host
        bool isHost = string.Equals(room.HostUserId, username.Trim(), StringComparison.OrdinalIgnoreCase);

        var participant = await _participantService.AddOrUpdateParticipantAsync(
            normalizedCode,
            username.Trim(),
            Context.ConnectionId,
            isHost
        );

        await Groups.AddToGroupAsync(Context.ConnectionId, normalizedCode);

        // Notify other participants in the room
        await Clients.OthersInGroup(normalizedCode).SendAsync("UserJoined", participant);

        // Get full state to return to joined user
        var participants = await _participantService.GetParticipantsByRoomCodeAsync(normalizedCode);
        var allTracks = await _trackService.GetAllTracksAsync();
        var playbackState = _syncService.GetPlaybackState(normalizedCode);

        // Ensure playbackState has a valid track
        var currentTrack = allTracks.FirstOrDefault(t => t.Id == playbackState.TrackId)
                           ?? allTracks.FirstOrDefault();

        if (currentTrack != null && playbackState.TrackId != currentTrack.Id)
        {
            playbackState.TrackId = currentTrack.Id;
        }

        var stateDto = new RoomStateDto
        {
            Room = room,
            Participants = participants,
            CurrentTrack = currentTrack,
            PlaybackState = playbackState,
            AvailableTracks = allTracks
        };

        _logger.LogInformation("User {Username} joined room {RoomCode} (IsHost: {IsHost})", username, normalizedCode, participant.IsHost);
        return stateDto;
    }

    public async Task LeaveRoom(string roomCode)
    {
        var normalizedCode = roomCode.Trim().ToUpper();
        var participant = await _participantService.GetParticipantByConnectionIdAsync(Context.ConnectionId);

        await Groups.RemoveFromGroupAsync(Context.ConnectionId, normalizedCode);

        if (participant != null)
        {
            await _participantService.RemoveParticipantAsync(normalizedCode, Context.ConnectionId);
            await Clients.Group(normalizedCode).SendAsync("UserLeft", participant.Username, Context.ConnectionId);

            // If the host leaves, handle reassignment
            var remaining = await _participantService.GetParticipantsByRoomCodeAsync(normalizedCode);
            if (participant.IsHost && remaining.Count != 0)
            {
                var newHost = remaining.First();
                await _participantService.TransferHostAsync(normalizedCode, newHost.ConnectionId);
                await Clients.Group(normalizedCode).SendAsync("HostChanged", newHost.Username, newHost.ConnectionId);
            }
        }
    }

    public async Task Play(string roomCode, double position)
    {
        var normalizedCode = roomCode.Trim().ToUpper();
        await AssertIsHostAsync(normalizedCode);

        var participant = await _participantService.GetParticipantByConnectionIdAsync(Context.ConnectionId);
        var state = _syncService.Play(normalizedCode, position, participant?.Username);

        _logger.LogInformation("Room {RoomCode} PLAY triggered at {Position}s by {Host}", normalizedCode, position, participant?.Username);
        await Clients.Group(normalizedCode).SendAsync("PlaybackStateChanged", state);
    }

    public async Task Pause(string roomCode, double position)
    {
        var normalizedCode = roomCode.Trim().ToUpper();
        await AssertIsHostAsync(normalizedCode);

        var participant = await _participantService.GetParticipantByConnectionIdAsync(Context.ConnectionId);
        var state = _syncService.Pause(normalizedCode, position, participant?.Username);

        _logger.LogInformation("Room {RoomCode} PAUSE triggered at {Position}s by {Host}", normalizedCode, position, participant?.Username);
        await Clients.Group(normalizedCode).SendAsync("PlaybackStateChanged", state);
    }

    public async Task Seek(string roomCode, double position)
    {
        var normalizedCode = roomCode.Trim().ToUpper();
        await AssertIsHostAsync(normalizedCode);

        var participant = await _participantService.GetParticipantByConnectionIdAsync(Context.ConnectionId);
        var state = _syncService.Seek(normalizedCode, position, participant?.Username);

        _logger.LogInformation("Room {RoomCode} SEEK to {Position}s by {Host}", normalizedCode, position, participant?.Username);
        await Clients.Group(normalizedCode).SendAsync("SeekChanged", position, state.ServerTimestamp);
        await Clients.Group(normalizedCode).SendAsync("PlaybackStateChanged", state);
    }

    public async Task ChangeTrack(string roomCode, int trackId)
    {
        var normalizedCode = roomCode.Trim().ToUpper();
        await AssertIsHostAsync(normalizedCode);

        var track = await _trackService.GetTrackByIdAsync(trackId);
        if (track == null)
        {
            throw new HubException("Track not found.");
        }

        var participant = await _participantService.GetParticipantByConnectionIdAsync(Context.ConnectionId);
        var state = _syncService.ChangeTrack(normalizedCode, trackId, participant?.Username);

        _logger.LogInformation("Room {RoomCode} Track changed to {TrackTitle} by {Host}", normalizedCode, track.Title, participant?.Username);
        await Clients.Group(normalizedCode).SendAsync("TrackChanged", track, state);
    }

    public Task<long> GetServerTime()
    {
        return Task.FromResult(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var result = await _participantService.HandleDisconnectAsync(Context.ConnectionId);

        if (!string.IsNullOrEmpty(result.RoomCode))
        {
            await Clients.Group(result.RoomCode).SendAsync("UserLeft", result.DisconnectedUsername, Context.ConnectionId);

            if (result.HostChanged && !string.IsNullOrEmpty(result.NewHostUsername))
            {
                var newHost = result.RemainingParticipants.FirstOrDefault(p => p.IsHost);
                await Clients.Group(result.RoomCode).SendAsync("HostChanged", result.NewHostUsername, newHost?.ConnectionId);
            }

            var updatedRoom = await _roomService.GetRoomByCodeAsync(result.RoomCode);
            if (updatedRoom != null)
            {
                var allTracks = await _trackService.GetAllTracksAsync();
                var playbackState = _syncService.GetPlaybackState(result.RoomCode);
                var currentTrack = allTracks.FirstOrDefault(t => t.Id == playbackState.TrackId) ?? allTracks.FirstOrDefault();

                var stateDto = new RoomStateDto
                {
                    Room = updatedRoom,
                    Participants = result.RemainingParticipants,
                    CurrentTrack = currentTrack,
                    PlaybackState = playbackState,
                    AvailableTracks = allTracks
                };

                await Clients.Group(result.RoomCode).SendAsync("RoomStateUpdated", stateDto);
            }
        }

        await base.OnDisconnectedAsync(exception);
    }

    private async Task AssertIsHostAsync(string roomCode)
    {
        bool isHost = await _participantService.IsUserHostAsync(roomCode, Context.ConnectionId);
        if (!isHost)
        {
            throw new HubException("Only the host can control playback.");
        }
    }
}
