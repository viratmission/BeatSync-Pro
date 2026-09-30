namespace BeatSync.API.DTOs;

public class WebRtcSignalDto
{
    public string? SenderConnectionId { get; set; }
    public string? SenderUsername { get; set; }
    public string? TargetConnectionId { get; set; }
    public required string SignalType { get; set; } // "offer", "answer", "candidate", "ready"
    public required string Data { get; set; } // Serialized JSON payload
}
