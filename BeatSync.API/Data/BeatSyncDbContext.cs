using BeatSync.API.Models;
using Microsoft.EntityFrameworkCore;

namespace BeatSync.API.Data;

public class BeatSyncDbContext : DbContext
{
    public BeatSyncDbContext(DbContextOptions<BeatSyncDbContext> options) : base(options)
    {
    }

    public DbSet<Room> Rooms => Set<Room>();
    public DbSet<Participant> Participants => Set<Participant>();
    public DbSet<Track> Tracks => Set<Track>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Room>(entity =>
        {
            entity.HasKey(r => r.Id);
            entity.HasIndex(r => r.RoomCode).IsUnique();
            entity.Property(r => r.RoomCode).IsRequired().HasMaxLength(6);
            entity.Property(r => r.Name).IsRequired().HasMaxLength(100);
            entity.Property(r => r.HostUserId).IsRequired().HasMaxLength(50);
            entity.Property(r => r.CreatedAt).IsRequired();
            entity.Property(r => r.IsActive).IsRequired();

            entity.HasMany(r => r.Participants)
                  .WithOne(p => p.Room)
                  .HasForeignKey(p => p.RoomId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Participant>(entity =>
        {
            entity.HasKey(p => p.Id);
            entity.Property(p => p.Username).IsRequired().HasMaxLength(50);
            entity.Property(p => p.ConnectionId).IsRequired().HasMaxLength(100);
            entity.Property(p => p.JoinedAt).IsRequired();
            entity.Property(p => p.IsHost).IsRequired();
            entity.Property(p => p.IsConnected).IsRequired();
        });

        modelBuilder.Entity<Track>(entity =>
        {
            entity.HasKey(t => t.Id);
            entity.Property(t => t.Title).IsRequired().HasMaxLength(100);
            entity.Property(t => t.Artist).IsRequired().HasMaxLength(100);
            entity.Property(t => t.AudioUrl).IsRequired().HasMaxLength(500);
            entity.Property(t => t.ArtworkUrl).HasMaxLength(500);
            entity.Property(t => t.Duration).IsRequired();
        });
    }
}
