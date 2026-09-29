using BeatSync.API.Data;
using BeatSync.API.Models;
using Microsoft.EntityFrameworkCore;

namespace BeatSync.API.Repositories;

public class RoomRepository : IRoomRepository
{
    private readonly BeatSyncDbContext _context;

    public RoomRepository(BeatSyncDbContext context)
    {
        _context = context;
    }

    public async Task<Room?> GetByIdAsync(int id)
    {
        return await _context.Rooms
            .Include(r => r.Participants)
            .FirstOrDefaultAsync(r => r.Id == id);
    }

    public async Task<Room?> GetByCodeAsync(string roomCode)
    {
        var normalized = roomCode.Trim().ToUpper();
        return await _context.Rooms
            .Include(r => r.Participants)
            .FirstOrDefaultAsync(r => r.RoomCode == normalized);
    }

    public async Task<bool> RoomCodeExistsAsync(string roomCode)
    {
        var normalized = roomCode.Trim().ToUpper();
        return await _context.Rooms.AnyAsync(r => r.RoomCode == normalized);
    }

    public async Task<Room> CreateAsync(Room room)
    {
        room.RoomCode = room.RoomCode.Trim().ToUpper();
        _context.Rooms.Add(room);
        await _context.SaveChangesAsync();
        return room;
    }

    public async Task UpdateAsync(Room room)
    {
        _context.Rooms.Update(room);
        await _context.SaveChangesAsync();
    }

    public async Task DeleteAsync(int id)
    {
        var room = await _context.Rooms.FindAsync(id);
        if (room != null)
        {
            _context.Rooms.Remove(room);
            await _context.SaveChangesAsync();
        }
    }

    public async Task<List<Room>> GetActiveRoomsAsync()
    {
        return await _context.Rooms
            .Where(r => r.IsActive)
            .Include(r => r.Participants)
            .OrderByDescending(r => r.CreatedAt)
            .ToListAsync();
    }
}
