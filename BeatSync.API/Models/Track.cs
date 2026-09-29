namespace BeatSync.API.Models;

public class Track
{
    public int Id { get; set; }
    public required string Title { get; set; }
    public required string Artist { get; set; }
    public required string AudioUrl { get; set; }
    public string? ArtworkUrl { get; set; }
    public double Duration { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
