using BeatSync.API.DTOs;

namespace BeatSync.API.Services;

public interface IParticipantService
{
    Task<ParticipantDto> AddOrUpdateParticipantAsync(string roomCode, string username, string connectionId, bool isHost);
    Task<List<ParticipantDto>> GetParticipantsByRoomCodeAsync(string roomCode);
    Task<ParticipantDto?> GetParticipantByConnectionIdAsync(string connectionId);
    Task<DisconnectResult> HandleDisconnectAsync(string connectionId);
    Task<bool> RemoveParticipantAsync(string roomCode, string connectionId);
    Task<bool> IsUserHostAsync(string roomCode, string connectionId);
    Task<ParticipantDto?> TransferHostAsync(string roomCode, string newHostConnectionId);
}

public class DisconnectResult
{
    public string? RoomCode { get; set; }
    public string? DisconnectedUsername { get; set; }
    public string? DisconnectedConnectionId { get; set; }
    public bool WasHost { get; set; }
    public bool HostChanged { get; set; }
    public string? NewHostUsername { get; set; }
    public List<ParticipantDto> RemainingParticipants { get; set; } = [];
}
