using BeatSync.API.Models;

namespace BeatSync.API.Repositories;

public interface ITrackRepository
{
    Task<List<Track>> GetAllAsync();
    Task<Track?> GetByIdAsync(int id);
    Task<Track> AddAsync(Track track);
    Task DeleteAsync(int id);
}
