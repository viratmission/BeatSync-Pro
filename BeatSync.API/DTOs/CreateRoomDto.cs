using System.ComponentModel.DataAnnotations;

namespace BeatSync.API.DTOs;

public class CreateRoomDto
{
    [MaxLength(50)]
    public string? Name { get; set; }

    [Required]
    [MinLength(2)]
    [MaxLength(30)]
    [RegularExpression(@"^[a-zA-Z0-9_\-]+$", ErrorMessage = "Username can only contain alphanumeric characters, underscores, and hyphens.")]
    public required string HostUsername { get; set; }

    [MaxLength(20)]
    public string RoomMode { get; set; } = "AudioSync"; // "AudioSync" or "Cinema"

    [MaxLength(200)]
    public string? MediaTitle { get; set; }

    public double? MediaDuration { get; set; }
}
