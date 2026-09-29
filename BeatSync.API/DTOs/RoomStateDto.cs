namespace BeatSync.API.DTOs;

public class RoomStateDto
{
    public required RoomDto Room { get; set; }
    public List<ParticipantDto> Participants { get; set; } = [];
    public TrackDto? CurrentTrack { get; set; }
    public required PlaybackStateDto PlaybackState { get; set; }
    public List<TrackDto> AvailableTracks { get; set; } = [];
}
