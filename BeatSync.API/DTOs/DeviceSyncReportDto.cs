namespace BeatSync.API.DTOs;

public class DeviceSyncReportDto
{
    public string? ConnectionId { get; set; }
    public string? Username { get; set; }
    public string? DevicePosition { get; set; }
    public double DriftMs { get; set; }
    public double Rtt { get; set; }
    public double ClockOffset { get; set; }
    public double PlaybackRate { get; set; }
    public string SyncStatus { get; set; } = "Excellent";
    public long LastSyncTime { get; set; }
}
