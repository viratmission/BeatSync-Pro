namespace BeatSync.API.DTOs;

public class PlaybackStateDto
{
    public int TrackId { get; set; }
    public bool IsPlaying { get; set; }
    public double CurrentPosition { get; set; } // in seconds
    public long ServerTimestamp { get; set; } // Unix epoch milliseconds
    public double PlaybackRate { get; set; } = 1.0;
    public string? UpdatedBy { get; set; }
    public long? ScheduledPlayTime { get; set; } // Future server time when clients should trigger play
    public long Sequence { get; set; } = 0; // State version sequence
    public string? MediaTitle { get; set; }
    public double? Duration { get; set; }
}
