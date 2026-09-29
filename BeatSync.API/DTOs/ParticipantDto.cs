namespace BeatSync.API.DTOs;

public class ParticipantDto
{
    public int Id { get; set; }
    public int RoomId { get; set; }
    public required string Username { get; set; }
    public required string ConnectionId { get; set; }
    public DateTime JoinedAt { get; set; }
    public bool IsHost { get; set; }
    public bool IsConnected { get; set; }
}
