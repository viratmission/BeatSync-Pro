using System.Collections.Concurrent;
using BeatSync.API.DTOs;

namespace BeatSync.API.Services;

public class SyncService : ISyncService
{
    private readonly ConcurrentDictionary<string, PlaybackStateDto> _roomStates = new(StringComparer.OrdinalIgnoreCase);

    public PlaybackStateDto GetPlaybackState(string roomCode)
    {
        var normalized = roomCode.Trim().ToUpper();
        if (_roomStates.TryGetValue(normalized, out var state))
        {
            // If playing, calculate updated projected current position
            if (state.IsPlaying)
            {
                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                var elapsedSec = (now - state.ServerTimestamp) / 1000.0;
                var projected = state.CurrentPosition + (elapsedSec * state.PlaybackRate);
                return new PlaybackStateDto
                {
                    TrackId = state.TrackId,
                    IsPlaying = true,
                    CurrentPosition = projected,
                    ServerTimestamp = now,
                    PlaybackRate = state.PlaybackRate,
                    UpdatedBy = state.UpdatedBy
                };
            }

            return state;
        }

        // Default initial state
        var defaultState = new PlaybackStateDto
        {
            TrackId = 1,
            IsPlaying = false,
            CurrentPosition = 0.0,
            ServerTimestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            PlaybackRate = 1.0,
            UpdatedBy = null
        };
        _roomStates[normalized] = defaultState;
        return defaultState;
    }

    public PlaybackStateDto UpdatePlaybackState(string roomCode, PlaybackStateDto state)
    {
        var normalized = roomCode.Trim().ToUpper();
        state.ServerTimestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        _roomStates[normalized] = state;
        return state;
    }

    public PlaybackStateDto Play(string roomCode, double position, int? trackId = null, string? updatedBy = null)
    {
        var normalized = roomCode.Trim().ToUpper();
        var current = GetPlaybackState(normalized);
        var activeTrackId = (trackId.HasValue && trackId.Value > 0) ? trackId.Value : current.TrackId;
        var newState = new PlaybackStateDto
        {
            TrackId = activeTrackId,
            IsPlaying = true,
            CurrentPosition = Math.Max(0.0, position),
            ServerTimestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            PlaybackRate = 1.0,
            UpdatedBy = updatedBy
        };
        _roomStates[normalized] = newState;
        return newState;
    }

    public PlaybackStateDto Pause(string roomCode, double position, int? trackId = null, string? updatedBy = null)
    {
        var normalized = roomCode.Trim().ToUpper();
        var current = GetPlaybackState(normalized);
        var activeTrackId = (trackId.HasValue && trackId.Value > 0) ? trackId.Value : current.TrackId;
        var newState = new PlaybackStateDto
        {
            TrackId = activeTrackId,
            IsPlaying = false,
            CurrentPosition = Math.Max(0.0, position),
            ServerTimestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            PlaybackRate = 1.0,
            UpdatedBy = updatedBy
        };
        _roomStates[normalized] = newState;
        return newState;
    }

    public PlaybackStateDto Seek(string roomCode, double position, int? trackId = null, string? updatedBy = null)
    {
        var normalized = roomCode.Trim().ToUpper();
        var current = GetPlaybackState(normalized);
        var activeTrackId = (trackId.HasValue && trackId.Value > 0) ? trackId.Value : current.TrackId;
        var newState = new PlaybackStateDto
        {
            TrackId = activeTrackId,
            IsPlaying = current.IsPlaying,
            CurrentPosition = Math.Max(0.0, position),
            ServerTimestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            PlaybackRate = current.PlaybackRate,
            UpdatedBy = updatedBy
        };
        _roomStates[normalized] = newState;
        return newState;
    }

    public PlaybackStateDto ChangeTrack(string roomCode, int trackId, string? updatedBy = null)
    {
        var normalized = roomCode.Trim().ToUpper();
        var current = GetPlaybackState(normalized);
        var newState = new PlaybackStateDto
        {
            TrackId = trackId,
            IsPlaying = current.IsPlaying,
            CurrentPosition = 0.0,
            ServerTimestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            PlaybackRate = 1.0,
            UpdatedBy = updatedBy
        };
        _roomStates[normalized] = newState;
        return newState;
    }

    public void RemoveRoom(string roomCode)
    {
        _roomStates.TryRemove(roomCode.Trim().ToUpper(), out _);
    }
}
