using BeatSync.API.Models;
using Microsoft.EntityFrameworkCore;

namespace BeatSync.API.Data;

public static class DbInitializer
{
    public static async Task InitializeAsync(BeatSyncDbContext context, string wwwrootPath)
    {
        // Apply pending migrations or ensure database is created
        await context.Database.MigrateAsync();

        // Ensure sample audio files are generated on disk
        AudioGenerator.EnsureSampleTracksExist(wwwrootPath);

        // Seed initial tracks if empty
        if (!await context.Tracks.AnyAsync())
        {
            var sampleTracks = new List<Track>
            {
                new()
                {
                    Title = "Neon Horizon",
                    Artist = "Synthwave Collective",
                    AudioUrl = "/audio/neon_horizon.wav",
                    ArtworkUrl = "/artworks/synthwave.svg",
                    Duration = 45.0,
                    CreatedAt = DateTime.UtcNow
                },
                new()
                {
                    Title = "Midnight Beats",
                    Artist = "Lo-Fi Chillroom",
                    AudioUrl = "/audio/midnight_beats.wav",
                    ArtworkUrl = "/artworks/lofi.svg",
                    Duration = 50.0,
                    CreatedAt = DateTime.UtcNow
                },
                new()
                {
                    Title = "Solar Echoes",
                    Artist = "Ambient Pulse",
                    AudioUrl = "/audio/solar_echoes.wav",
                    ArtworkUrl = "/artworks/ambient.svg",
                    Duration = 40.0,
                    CreatedAt = DateTime.UtcNow
                }
            };

            await context.Tracks.AddRangeAsync(sampleTracks);
            await context.SaveChangesAsync();
        }
    }
}
