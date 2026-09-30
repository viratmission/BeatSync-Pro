namespace BeatSync.API.DTOs;

public class RoomDto
{
    public int Id { get; set; }
    public required string RoomCode { get; set; }
    public required string Name { get; set; }
    public required string HostUserId { get; set; }
    public DateTime CreatedAt { get; set; }
    public bool IsActive { get; set; }
    public int ParticipantCount { get; set; }
    public string RoomMode { get; set; } = "AudioSync";
    public string? MediaTitle { get; set; }
    public double? MediaDuration { get; set; }
    public string? MediaType { get; set; }
}
