using System.ComponentModel.DataAnnotations;

namespace BeatSync.API.DTOs;

public class TrackDto
{
    public int Id { get; set; }

    [Required]
    [MaxLength(100)]
    public required string Title { get; set; }

    [Required]
    [MaxLength(100)]
    public required string Artist { get; set; }

    [Required]
    public required string AudioUrl { get; set; }

    public string? ArtworkUrl { get; set; }

    public double Duration { get; set; }
}
