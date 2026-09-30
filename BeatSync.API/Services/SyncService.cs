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
                    UpdatedBy = state.UpdatedBy,
                    ScheduledPlayTime = state.ScheduledPlayTime,
                    Sequence = state.Sequence,
                    MediaTitle = state.MediaTitle,
                    Duration = state.Duration
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
            UpdatedBy = null,
            Sequence = 1
        };
        _roomStates[normalized] = defaultState;
        return defaultState;
    }

    public PlaybackStateDto UpdatePlaybackState(string roomCode, PlaybackStateDto state)
    {
        var normalized = roomCode.Trim().ToUpper();
        state.ServerTimestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        state.Sequence++;
        _roomStates[normalized] = state;
        return state;
    }

    public PlaybackStateDto Play(string roomCode, double position, int? trackId = null, string? updatedBy = null, long? scheduledPlayTime = null, double playbackRate = 1.0)
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
            ScheduledPlayTime = scheduledPlayTime,
            PlaybackRate = playbackRate > 0 ? playbackRate : 1.0,
            UpdatedBy = updatedBy,
            Sequence = current.Sequence + 1,
            MediaTitle = current.MediaTitle,
            Duration = current.Duration
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
            ScheduledPlayTime = null,
            PlaybackRate = 1.0,
            UpdatedBy = updatedBy,
            Sequence = current.Sequence + 1,
            MediaTitle = current.MediaTitle,
            Duration = current.Duration
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
            ScheduledPlayTime = current.ScheduledPlayTime,
            PlaybackRate = current.PlaybackRate,
            UpdatedBy = updatedBy,
            Sequence = current.Sequence + 1,
            MediaTitle = current.MediaTitle,
            Duration = current.Duration
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
            ScheduledPlayTime = null,
            PlaybackRate = 1.0,
            UpdatedBy = updatedBy,
            Sequence = current.Sequence + 1,
            MediaTitle = current.MediaTitle,
            Duration = current.Duration
        };
        _roomStates[normalized] = newState;
        return newState;
    }

    public PlaybackStateDto ExecuteCinemaCommand(string roomCode, CinemaPlaybackCommandDto command, string? updatedBy = null)
    {
        var normalized = roomCode.Trim().ToUpper();
        var current = GetPlaybackState(normalized);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        var state = new PlaybackStateDto
        {
            TrackId = current.TrackId,
            ServerTimestamp = now,
            ScheduledPlayTime = command.ScheduledPlayTime,
            Sequence = current.Sequence + 1,
            UpdatedBy = updatedBy ?? command.UpdatedBy,
            MediaTitle = !string.IsNullOrWhiteSpace(command.MediaTitle) ? command.MediaTitle : current.MediaTitle,
            Duration = command.MediaDuration.HasValue ? command.MediaDuration.Value : current.Duration
        };

        switch (command.CommandType.ToLowerInvariant())
        {
            case "play":
                state.IsPlaying = true;
                state.CurrentPosition = Math.Max(0.0, command.Position);
                state.PlaybackRate = command.PlaybackRate > 0 ? command.PlaybackRate : 1.0;
                break;

            case "pause":
                state.IsPlaying = false;
                state.CurrentPosition = Math.Max(0.0, command.Position);
                state.PlaybackRate = 1.0;
                state.ScheduledPlayTime = null;
                break;

            case "seek":
                state.IsPlaying = current.IsPlaying;
                state.CurrentPosition = Math.Max(0.0, command.Position);
                state.PlaybackRate = current.PlaybackRate;
                break;

            case "rate":
                state.IsPlaying = current.IsPlaying;
                state.CurrentPosition = current.CurrentPosition;
                state.PlaybackRate = command.PlaybackRate > 0 ? command.PlaybackRate : 1.0;
                break;

            case "loadmedia":
                state.IsPlaying = false;
                state.CurrentPosition = 0.0;
                state.PlaybackRate = 1.0;
                state.MediaTitle = command.MediaTitle;
                state.Duration = command.MediaDuration;
                break;

            default:
                state.IsPlaying = current.IsPlaying;
                state.CurrentPosition = current.CurrentPosition;
                state.PlaybackRate = current.PlaybackRate;
                break;
        }

        _roomStates[normalized] = state;
        return state;
    }

    public void RemoveRoom(string roomCode)
    {
        _roomStates.TryRemove(roomCode.Trim().ToUpper(), out _);
    }
}
