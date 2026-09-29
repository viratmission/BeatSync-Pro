namespace BeatSync.API.Models;

public class Participant
{
    public int Id { get; set; }
    public int RoomId { get; set; }
    public Room? Room { get; set; }
    public required string Username { get; set; }
    public required string ConnectionId { get; set; }
    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
    public bool IsHost { get; set; }
    public bool IsConnected { get; set; } = true;
}
