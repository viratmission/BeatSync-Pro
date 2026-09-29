using BeatSync.API.DTOs;
using BeatSync.API.Models;
using BeatSync.API.Repositories;

namespace BeatSync.API.Services;

public class TrackService : ITrackService
{
    private readonly ITrackRepository _trackRepository;

    public TrackService(ITrackRepository trackRepository)
    {
        _trackRepository = trackRepository;
    }

    public async Task<List<TrackDto>> GetAllTracksAsync()
    {
        var tracks = await _trackRepository.GetAllAsync();
        return tracks.Select(MapToDto).ToList();
    }

    public async Task<TrackDto?> GetTrackByIdAsync(int id)
    {
        var track = await _trackRepository.GetByIdAsync(id);
        return track == null ? null : MapToDto(track);
    }

    public async Task<TrackDto> CreateTrackAsync(TrackDto dto)
    {
        var track = new Track
        {
            Title = dto.Title.Trim(),
            Artist = dto.Artist.Trim(),
            AudioUrl = dto.AudioUrl.Trim(),
            ArtworkUrl = dto.ArtworkUrl?.Trim(),
            Duration = dto.Duration,
            CreatedAt = DateTime.UtcNow
        };

        var created = await _trackRepository.AddAsync(track);
        return MapToDto(created);
    }

    public async Task<bool> DeleteTrackAsync(int id)
    {
        var track = await _trackRepository.GetByIdAsync(id);
        if (track == null) return false;

        await _trackRepository.DeleteAsync(id);
        return true;
    }

    private static TrackDto MapToDto(Track track)
    {
        return new TrackDto
        {
            Id = track.Id,
            Title = track.Title,
            Artist = track.Artist,
            AudioUrl = track.AudioUrl,
            ArtworkUrl = track.ArtworkUrl,
            Duration = track.Duration
        };
    }
}
