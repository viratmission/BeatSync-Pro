namespace BeatSync.API.DTOs;

public class PlaybackStateDto
{
    public int TrackId { get; set; }
    public bool IsPlaying { get; set; }
    public double CurrentPosition { get; set; } // in seconds
    public long ServerTimestamp { get; set; } // Unix epoch milliseconds
    public double PlaybackRate { get; set; } = 1.0;
    public string? UpdatedBy { get; set; }
}
