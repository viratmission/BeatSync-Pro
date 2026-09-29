using BeatSync.API.Models;

namespace BeatSync.API.Repositories;

public interface IParticipantRepository
{
    Task<Participant?> GetByIdAsync(int id);
    Task<List<Participant>> GetByRoomIdAsync(int roomId);
    Task<Participant?> GetByConnectionIdAsync(string connectionId);
    Task<Participant?> GetByRoomAndUsernameAsync(int roomId, string username);
    Task<Participant> AddAsync(Participant participant);
    Task UpdateAsync(Participant participant);
    Task RemoveAsync(int id);
    Task RemoveByConnectionIdAsync(string connectionId);
    Task SetDisconnectedAsync(string connectionId);
    Task<Participant?> GetOldestConnectedParticipantAsync(int roomId);
}
