using BeatSync.API.Data;
using BeatSync.API.Models;
using Microsoft.EntityFrameworkCore;

namespace BeatSync.API.Repositories;

public class TrackRepository : ITrackRepository
{
    private readonly BeatSyncDbContext _context;

    public TrackRepository(BeatSyncDbContext context)
    {
        _context = context;
    }

    public async Task<List<Track>> GetAllAsync()
    {
        return await _context.Tracks
            .OrderBy(t => t.Id)
            .ToListAsync();
    }

    public async Task<Track?> GetByIdAsync(int id)
    {
        return await _context.Tracks.FindAsync(id);
    }

    public async Task<Track> AddAsync(Track track)
    {
        _context.Tracks.Add(track);
        await _context.SaveChangesAsync();
        return track;
    }

    public async Task DeleteAsync(int id)
    {
        var track = await _context.Tracks.FindAsync(id);
        if (track != null)
        {
            _context.Tracks.Remove(track);
            await _context.SaveChangesAsync();
        }
    }
}
