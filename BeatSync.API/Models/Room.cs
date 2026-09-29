namespace BeatSync.API.Models;

public class Room
{
    public int Id { get; set; }
    public required string RoomCode { get; set; }
    public required string Name { get; set; }
    public required string HostUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public bool IsActive { get; set; } = true;

    public List<Participant> Participants { get; set; } = [];
}
