using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BeatSync.API.Migrations
{
    /// <inheritdoc />
    public partial class AddCinemaModeSupport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "MediaDuration",
                table: "Rooms",
                type: "float",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MediaTitle",
                table: "Rooms",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MediaType",
                table: "Rooms",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RoomMode",
                table: "Rooms",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "AudioSync");

            migrationBuilder.AddColumn<string>(
                name: "DeviceName",
                table: "Participants",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DevicePosition",
                table: "Participants",
                type: "nvarchar(30)",
                maxLength: 30,
                nullable: false,
                defaultValue: "FrontLeft");

            migrationBuilder.AddColumn<string>(
                name: "DeviceRole",
                table: "Participants",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "AudioSpeaker");

            migrationBuilder.AddColumn<bool>(
                name: "IsMuted",
                table: "Participants",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "Volume",
                table: "Participants",
                type: "int",
                nullable: false,
                defaultValue: 80);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MediaDuration",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "MediaTitle",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "MediaType",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "RoomMode",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "DeviceName",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "DevicePosition",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "DeviceRole",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "IsMuted",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "Volume",
                table: "Participants");
        }
    }
}
