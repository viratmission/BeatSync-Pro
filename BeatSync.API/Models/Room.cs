namespace BeatSync.API.Models;

public class Room
{
    public int Id { get; set; }
    public required string RoomCode { get; set; }
    public required string Name { get; set; }
    public required string HostUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public bool IsActive { get; set; } = true;
    public string RoomMode { get; set; } = "AudioSync"; // "AudioSync" or "Cinema"
    public string? MediaTitle { get; set; }
    public double? MediaDuration { get; set; }
    public string? MediaType { get; set; }

    public List<Participant> Participants { get; set; } = [];
}
