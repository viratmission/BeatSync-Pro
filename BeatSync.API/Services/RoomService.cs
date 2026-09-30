using System.Security.Cryptography;
using BeatSync.API.DTOs;
using BeatSync.API.Models;
using BeatSync.API.Repositories;

namespace BeatSync.API.Services;

public class RoomService : IRoomService
{
    private readonly IRoomRepository _roomRepository;
    private static readonly char[] CodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".ToCharArray();

    public RoomService(IRoomRepository roomRepository)
    {
        _roomRepository = roomRepository;
    }

    public async Task<RoomDto> CreateRoomAsync(CreateRoomDto dto)
    {
        string code;
        int attempts = 0;
        do
        {
            code = GenerateRoomCode();
            attempts++;
            if (attempts > 50)
            {
                throw new InvalidOperationException("Unable to generate a unique room code. Please try again.");
            }
        }
        while (await _roomRepository.RoomCodeExistsAsync(code));

        var room = new Room
        {
            RoomCode = code,
            Name = string.IsNullOrWhiteSpace(dto.Name) ? $"{dto.HostUsername}'s Room" : dto.Name.Trim(),
            HostUserId = dto.HostUsername.Trim(),
            CreatedAt = DateTime.UtcNow,
            IsActive = true,
            RoomMode = string.IsNullOrWhiteSpace(dto.RoomMode) ? "AudioSync" : dto.RoomMode.Trim(),
            MediaTitle = dto.MediaTitle,
            MediaDuration = dto.MediaDuration,
            MediaType = dto.RoomMode == "Cinema" ? "video" : "audio"
        };

        var created = await _roomRepository.CreateAsync(room);
        return MapToDto(created);
    }

    public async Task<RoomDto?> GetRoomByCodeAsync(string roomCode)
    {
        var room = await _roomRepository.GetByCodeAsync(roomCode);
        return room == null ? null : MapToDto(room);
    }

    public async Task<bool> ValidateRoomAsync(string roomCode)
    {
        if (string.IsNullOrWhiteSpace(roomCode) || roomCode.Trim().Length != 6)
        {
            return false;
        }

        var room = await _roomRepository.GetByCodeAsync(roomCode);
        return room != null && room.IsActive;
    }

    public async Task<bool> DeactivateRoomAsync(string roomCode)
    {
        var room = await _roomRepository.GetByCodeAsync(roomCode);
        if (room == null) return false;

        room.IsActive = false;
        await _roomRepository.UpdateAsync(room);
        return true;
    }

    public async Task<List<RoomDto>> GetActiveRoomsAsync()
    {
        var rooms = await _roomRepository.GetActiveRoomsAsync();
        return rooms.Select(MapToDto).ToList();
    }

    private static string GenerateRoomCode()
    {
        var chars = new char[6];
        var bytes = RandomNumberGenerator.GetBytes(6);
        for (int i = 0; i < 6; i++)
        {
            chars[i] = CodeAlphabet[bytes[i] % CodeAlphabet.Length];
        }
        return new string(chars);
    }

    private static RoomDto MapToDto(Room room)
    {
        return new RoomDto
        {
            Id = room.Id,
            RoomCode = room.RoomCode,
            Name = room.Name,
            HostUserId = room.HostUserId,
            CreatedAt = room.CreatedAt,
            IsActive = room.IsActive,
            ParticipantCount = room.Participants?.Count(p => p.IsConnected) ?? 0,
            RoomMode = room.RoomMode ?? "AudioSync",
            MediaTitle = room.MediaTitle,
            MediaDuration = room.MediaDuration,
            MediaType = room.MediaType
        };
    }
}
