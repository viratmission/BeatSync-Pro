using System.ComponentModel.DataAnnotations;

namespace BeatSync.API.DTOs;

public class JoinRoomDto
{
    [Required]
    [StringLength(6, MinimumLength = 6, ErrorMessage = "Room code must be exactly 6 characters.")]
    [RegularExpression(@"^[A-Za-z0-9]+$", ErrorMessage = "Room code must be alphanumeric.")]
    public required string RoomCode { get; set; }

    [Required]
    [MinLength(2)]
    [MaxLength(30)]
    [RegularExpression(@"^[a-zA-Z0-9_\-]+$", ErrorMessage = "Username can only contain alphanumeric characters, underscores, and hyphens.")]
    public required string Username { get; set; }
}
