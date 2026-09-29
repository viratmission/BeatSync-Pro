using BeatSync.API.DTOs;

namespace BeatSync.API.Services;

public interface IRoomService
{
    Task<RoomDto> CreateRoomAsync(CreateRoomDto dto);
    Task<RoomDto?> GetRoomByCodeAsync(string roomCode);
    Task<bool> ValidateRoomAsync(string roomCode);
    Task<bool> DeactivateRoomAsync(string roomCode);
    Task<List<RoomDto>> GetActiveRoomsAsync();
}
