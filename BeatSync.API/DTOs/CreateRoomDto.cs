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
}
