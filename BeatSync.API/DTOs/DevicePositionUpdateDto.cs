namespace BeatSync.API.DTOs;

public class DevicePositionUpdateDto
{
    public string? ConnectionId { get; set; }
    public string? Username { get; set; }
    public required string DevicePosition { get; set; }
    public int Volume { get; set; } = 80;
    public bool IsMuted { get; set; } = false;
    public string? DeviceName { get; set; }
}
