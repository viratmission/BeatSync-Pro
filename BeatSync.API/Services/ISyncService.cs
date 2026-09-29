using BeatSync.API.DTOs;

namespace BeatSync.API.Services;

public interface ISyncService
{
    PlaybackStateDto GetPlaybackState(string roomCode);
    PlaybackStateDto UpdatePlaybackState(string roomCode, PlaybackStateDto state);
    PlaybackStateDto Play(string roomCode, double position, int? trackId = null, string? updatedBy = null);
    PlaybackStateDto Pause(string roomCode, double position, int? trackId = null, string? updatedBy = null);
    PlaybackStateDto Seek(string roomCode, double position, int? trackId = null, string? updatedBy = null);
    PlaybackStateDto ChangeTrack(string roomCode, int trackId, string? updatedBy = null);
    void RemoveRoom(string roomCode);
}
