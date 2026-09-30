namespace BeatSync.API.DTOs;

public class CinemaPlaybackCommandDto
{
    public required string CommandType { get; set; } // "Play", "Pause", "Seek", "Rate", "LoadMedia"
    public double Position { get; set; }
    public double PlaybackRate { get; set; } = 1.0;
    public long ServerTimestamp { get; set; }
    public long? ScheduledPlayTime { get; set; }
    public long Sequence { get; set; }
    public string? MediaTitle { get; set; }
    public double? MediaDuration { get; set; }
    public string? UpdatedBy { get; set; }
}
