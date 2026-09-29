using BeatSync.API.DTOs;

namespace BeatSync.API.Services;

public interface ITrackService
{
    Task<List<TrackDto>> GetAllTracksAsync();
    Task<TrackDto?> GetTrackByIdAsync(int id);
    Task<TrackDto> CreateTrackAsync(TrackDto dto);
    Task<bool> DeleteTrackAsync(int id);
}
