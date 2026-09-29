using BeatSync.API.Models;

namespace BeatSync.API.Repositories;

public interface IRoomRepository
{
    Task<Room?> GetByIdAsync(int id);
    Task<Room?> GetByCodeAsync(string roomCode);
    Task<bool> RoomCodeExistsAsync(string roomCode);
    Task<Room> CreateAsync(Room room);
    Task UpdateAsync(Room room);
    Task DeleteAsync(int id);
    Task<List<Room>> GetActiveRoomsAsync();
}
