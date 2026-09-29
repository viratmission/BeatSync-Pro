using BeatSync.API.DTOs;
using BeatSync.API.Repositories;
using Microsoft.AspNetCore.Mvc;

namespace BeatSync.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ParticipantsController : ControllerBase
{
    private readonly IParticipantRepository _participantRepository;

    public ParticipantsController(IParticipantRepository participantRepository)
    {
        _participantRepository = participantRepository;
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<ParticipantDto>> GetParticipant(int id)
    {
        var participant = await _participantRepository.GetByIdAsync(id);
        if (participant == null)
        {
            return NotFound(new { message = "Participant not found." });
        }

        return Ok(new ParticipantDto
        {
            Id = participant.Id,
            RoomId = participant.RoomId,
            Username = participant.Username,
            ConnectionId = participant.ConnectionId,
            JoinedAt = participant.JoinedAt,
            IsHost = participant.IsHost,
            IsConnected = participant.IsConnected
        });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> RemoveParticipant(int id)
    {
        var participant = await _participantRepository.GetByIdAsync(id);
        if (participant == null)
        {
            return NotFound(new { message = "Participant not found." });
        }

        await _participantRepository.RemoveAsync(id);
        return NoContent();
    }
}
