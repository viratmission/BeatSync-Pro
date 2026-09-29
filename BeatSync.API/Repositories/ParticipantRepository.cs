using BeatSync.API.Data;
using BeatSync.API.Models;
using Microsoft.EntityFrameworkCore;

namespace BeatSync.API.Repositories;

public class ParticipantRepository : IParticipantRepository
{
    private readonly BeatSyncDbContext _context;

    public ParticipantRepository(BeatSyncDbContext context)
    {
        _context = context;
    }

    public async Task<Participant?> GetByIdAsync(int id)
    {
        return await _context.Participants.FindAsync(id);
    }

    public async Task<List<Participant>> GetByRoomIdAsync(int roomId)
    {
        return await _context.Participants
            .Where(p => p.RoomId == roomId && p.IsConnected)
            .OrderBy(p => p.JoinedAt)
            .ToListAsync();
    }

    public async Task<Participant?> GetByConnectionIdAsync(string connectionId)
    {
        return await _context.Participants
            .Include(p => p.Room)
            .FirstOrDefaultAsync(p => p.ConnectionId == connectionId);
    }

    public async Task<Participant?> GetByRoomAndUsernameAsync(int roomId, string username)
    {
        return await _context.Participants
            .FirstOrDefaultAsync(p => p.RoomId == roomId && p.Username.ToLower() == username.ToLower());
    }

    public async Task<Participant> AddAsync(Participant participant)
    {
        _context.Participants.Add(participant);
        await _context.SaveChangesAsync();
        return participant;
    }

    public async Task UpdateAsync(Participant participant)
    {
        _context.Participants.Update(participant);
        await _context.SaveChangesAsync();
    }

    public async Task RemoveAsync(int id)
    {
        var participant = await _context.Participants.FindAsync(id);
        if (participant != null)
        {
            _context.Participants.Remove(participant);
            await _context.SaveChangesAsync();
        }
    }

    public async Task RemoveByConnectionIdAsync(string connectionId)
    {
        var participants = await _context.Participants
            .Where(p => p.ConnectionId == connectionId)
            .ToListAsync();

        if (participants.Count != 0)
        {
            _context.Participants.RemoveRange(participants);
            await _context.SaveChangesAsync();
        }
    }

    public async Task SetDisconnectedAsync(string connectionId)
    {
        var participant = await _context.Participants
            .FirstOrDefaultAsync(p => p.ConnectionId == connectionId);

        if (participant != null)
        {
            participant.IsConnected = false;
            await _context.SaveChangesAsync();
        }
    }

    public async Task<Participant?> GetOldestConnectedParticipantAsync(int roomId)
    {
        return await _context.Participants
            .Where(p => p.RoomId == roomId && p.IsConnected)
            .OrderBy(p => p.JoinedAt)
            .FirstOrDefaultAsync();
    }
}
