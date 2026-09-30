using BeatSync.API.DTOs;
using BeatSync.API.Models;
using BeatSync.API.Repositories;

namespace BeatSync.API.Services;

public class ParticipantService : IParticipantService
{
    private readonly IParticipantRepository _participantRepository;
    private readonly IRoomRepository _roomRepository;

    public ParticipantService(IParticipantRepository participantRepository, IRoomRepository roomRepository)
    {
        _participantRepository = participantRepository;
        _roomRepository = roomRepository;
    }

    private static readonly string[] DefaultPositions = [
        "FrontLeft", "FrontRight", "FrontCenter", "SurroundLeft", "SurroundRight", "RearLeft", "RearCenter", "RearRight"
    ];

    public async Task<ParticipantDto> AddOrUpdateParticipantAsync(
        string roomCode,
        string username,
        string connectionId,
        bool isHost,
        string? deviceRole = null,
        string? devicePosition = null,
        string? deviceName = null,
        int volume = 80,
        bool isMuted = false)
    {
        var room = await _roomRepository.GetByCodeAsync(roomCode)
            ?? throw new InvalidOperationException($"Room with code '{roomCode}' was not found.");

        var existingInRoom = await _participantRepository.GetByRoomIdAsync(room.Id);

        // If room has no active participants, this user becomes the host
        bool userIsHost = isHost || !existingInRoom.Any(p => p.IsHost && p.IsConnected);

        // Auto-assign default surround position if not provided
        var assignedPosition = !string.IsNullOrWhiteSpace(devicePosition)
            ? devicePosition
            : DefaultPositions[existingInRoom.Count % DefaultPositions.Length];

        var assignedRole = !string.IsNullOrWhiteSpace(deviceRole)
            ? deviceRole
            : (userIsHost ? "HostVideo" : "AudioSpeaker");

        var assignedName = !string.IsNullOrWhiteSpace(deviceName)
            ? deviceName
            : $"Phone {existingInRoom.Count + 1}";

        // Check if a participant with this username already exists in room
        var existingParticipant = await _participantRepository.GetByRoomAndUsernameAsync(room.Id, username);

        if (existingParticipant != null)
        {
            existingParticipant.ConnectionId = connectionId;
            existingParticipant.IsConnected = true;
            if (userIsHost)
            {
                existingParticipant.IsHost = true;
            }
            if (!string.IsNullOrWhiteSpace(devicePosition))
            {
                existingParticipant.DevicePosition = devicePosition;
            }
            if (!string.IsNullOrWhiteSpace(deviceRole))
            {
                existingParticipant.DeviceRole = deviceRole;
            }
            existingParticipant.Volume = volume;
            existingParticipant.IsMuted = isMuted;
            await _participantRepository.UpdateAsync(existingParticipant);
            return MapToDto(existingParticipant);
        }

        var newParticipant = new Participant
        {
            RoomId = room.Id,
            Username = username.Trim(),
            ConnectionId = connectionId,
            JoinedAt = DateTime.UtcNow,
            IsHost = userIsHost,
            IsConnected = true,
            DeviceRole = assignedRole,
            DevicePosition = assignedPosition,
            DeviceName = assignedName,
            Volume = volume,
            IsMuted = isMuted
        };

        var created = await _participantRepository.AddAsync(newParticipant);
        return MapToDto(created);
    }

    public async Task<List<ParticipantDto>> GetParticipantsByRoomCodeAsync(string roomCode)
    {
        var room = await _roomRepository.GetByCodeAsync(roomCode);
        if (room == null) return [];

        var participants = await _participantRepository.GetByRoomIdAsync(room.Id);
        return participants.Select(MapToDto).ToList();
    }

    public async Task<ParticipantDto?> GetParticipantByConnectionIdAsync(string connectionId)
    {
        var participant = await _participantRepository.GetByConnectionIdAsync(connectionId);
        return participant == null ? null : MapToDto(participant);
    }

    public async Task<DisconnectResult> HandleDisconnectAsync(string connectionId)
    {
        var participant = await _participantRepository.GetByConnectionIdAsync(connectionId);
        if (participant == null || participant.Room == null)
        {
            return new DisconnectResult();
        }

        var roomId = participant.RoomId;
        var roomCode = participant.Room.RoomCode;
        var username = participant.Username;
        bool wasHost = participant.IsHost;

        participant.IsConnected = false;
        await _participantRepository.UpdateAsync(participant);

        var remaining = await _participantRepository.GetByRoomIdAsync(roomId);
        bool hostChanged = false;
        string? newHostUsername = null;

        if (wasHost && remaining.Count != 0)
        {
            var nextHost = remaining.OrderBy(p => p.JoinedAt).First();
            nextHost.IsHost = true;
            await _participantRepository.UpdateAsync(nextHost);
            hostChanged = true;
            newHostUsername = nextHost.Username;

            // Refresh remaining
            remaining = await _participantRepository.GetByRoomIdAsync(roomId);
        }

        return new DisconnectResult
        {
            RoomCode = roomCode,
            DisconnectedUsername = username,
            DisconnectedConnectionId = connectionId,
            WasHost = wasHost,
            HostChanged = hostChanged,
            NewHostUsername = newHostUsername,
            RemainingParticipants = remaining.Select(MapToDto).ToList()
        };
    }

    public async Task<bool> RemoveParticipantAsync(string roomCode, string connectionId)
    {
        var participant = await _participantRepository.GetByConnectionIdAsync(connectionId);
        if (participant == null) return false;

        await _participantRepository.RemoveAsync(participant.Id);
        return true;
    }

    public async Task<bool> IsUserHostAsync(string roomCode, string connectionId)
    {
        var room = await _roomRepository.GetByCodeAsync(roomCode);
        if (room == null) return false;

        var participant = await _participantRepository.GetByConnectionIdAsync(connectionId);
        return participant != null && participant.RoomId == room.Id && participant.IsHost && participant.IsConnected;
    }

    public async Task<ParticipantDto?> TransferHostAsync(string roomCode, string newHostConnectionId)
    {
        var room = await _roomRepository.GetByCodeAsync(roomCode);
        if (room == null) return null;

        var participants = await _participantRepository.GetByRoomIdAsync(room.Id);
        var target = participants.FirstOrDefault(p => p.ConnectionId == newHostConnectionId);
        if (target == null) return null;

        foreach (var p in participants)
        {
            p.IsHost = (p.Id == target.Id);
            await _participantRepository.UpdateAsync(p);
        }

        return MapToDto(target);
    }

    public async Task<ParticipantDto?> UpdateDevicePositionAsync(
        string roomCode,
        string connectionId,
        string position,
        int volume,
        bool isMuted,
        string? deviceName = null)
    {
        var participant = await _participantRepository.GetByConnectionIdAsync(connectionId);
        if (participant == null) return null;

        participant.DevicePosition = position;
        participant.Volume = volume;
        participant.IsMuted = isMuted;
        if (!string.IsNullOrWhiteSpace(deviceName))
        {
            participant.DeviceName = deviceName.Trim();
        }

        await _participantRepository.UpdateAsync(participant);
        return MapToDto(participant);
    }

    private static ParticipantDto MapToDto(Participant participant)
    {
        return new ParticipantDto
        {
            Id = participant.Id,
            RoomId = participant.RoomId,
            Username = participant.Username,
            ConnectionId = participant.ConnectionId,
            JoinedAt = participant.JoinedAt,
            IsHost = participant.IsHost,
            IsConnected = participant.IsConnected,
            DeviceRole = participant.DeviceRole ?? "AudioSpeaker",
            DevicePosition = participant.DevicePosition ?? "FrontLeft",
            DeviceName = participant.DeviceName,
            Volume = participant.Volume,
            IsMuted = participant.IsMuted
        };
    }
}
