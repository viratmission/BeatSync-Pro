# BeatSync Clone — Synchronized Real-Time Web Audio

BeatSync Clone is a full-stack web application inspired by the core functionality and interaction patterns of [BeatSync](https://beatsync.gg/). It allows multiple users across different devices (laptops, phones, tablets) to join a shared room and synchronize audio playback with sub-millisecond precision.

---

## 🚀 Features

- **Minimal, Modern Landing Page (Phase 1)**
  - Clean brand identity with music wave aesthetic.
  - 6-character room code input with auto-capitalization and validation.
  - Random username generator (`productive-eagle`, `clever-tiger`, `silent-wolf`, `happy-panda`) with instant regeneration and custom editing.
  - One-click room creation and joining.
  - Native device speakers option checkbox.
  - Footer with Community, GitHub, and About dialogs.

- **Dynamic Routing (Phase 2)**
  - `/`: Home landing page.
  - `/room/:roomCode`: Real-time synchronized room page.
  - `/login`: User sign-in page.
  - `/profile`: User settings and device audio preferences.

- **Robust Room System & Multi-Participant Presence (Phases 3 & 4)**
  - Real database-backed rooms with unique 6-character codes.
  - Multiple simultaneous participants per room.
  - Host visually distinguished with a `HOST` badge.
  - Real-time `UserJoined` and `UserLeft` broadcast updates via SignalR.
  - Automatic disconnection handling and host migration if the original host leaves.

- **Interactive Room UI & Audio Player (Phase 5)**
  - Split responsive layout (Desktop: side-by-side player & participants; Mobile: sleek stacked card layout).
  - Vinyl disc visualizer with active spin animation on playback.
  - Master controls for host: Play, Pause, Seek, Previous, Next.
  - Participant status indicator: Displays who is hosting and listen-only synchronization status.
  - Real-time participants list with initials avatars and live status dots.

- **Audio Engine & Sample Tracks (Phase 6)**
  - Built-in royalty-free procedural audio tracks generated on first run:
    1. *Neon Horizon* (Synthwave Collective - 45s)
    2. *Midnight Beats* (Lo-Fi Chillroom - 50s)
    3. *Solar Echoes* (Ambient Pulse - 40s)
  - Custom audio file upload (MP3, WAV, OGG, M4A, AAC up to 25MB).
  - HTMLAudioElement and Web Audio API integration.

- **High-Precision Real-Time Clock & Audio Synchronization (Phases 7, 8, 9)**
  - **Clock Drift Calibration**: Clients periodically sample server timestamp via SignalR ping-pong round trips, calculating accurate network latency (RTT) and local clock offset.
  - **Projected Position Tracking**: When host plays, pauses, or seeks, state is broadcast with high-resolution server timestamps:
    $$\text{Expected Position} = \text{CurrentPosition} + (\text{ServerNow} - \text{ServerTimestamp}) \times \text{PlaybackRate}$$
  - **Dual-Tolerance Sync Engine**:
    - **Large Drift (> 1.2s)**: Direct hard seek (`audio.currentTime = expectedPosition`).
    - **Mild Drift (50ms – 1.2s)**: Smooth catch-up using subtle `audio.playbackRate` micro-adjustments ($1.05\times$ to catch up, $0.95\times$ to wait) without audio popping or audible stuttering.
    - **Tight Alignment (< 50ms)**: Preserves perfect $1.0\times$ speed.

- **Local Volume & Output Device Routing (Phases 10 & 11)**
  - Volume is strictly local to each device (`localStorage` persistence).
  - Native speaker device selection via `navigator.mediaDevices.enumerateDevices()` and `HTMLMediaElement.setSinkId()` with graceful fallback.

- **Clean Architecture & Enterprise Structure (Phases 12, 13, 14, 15, 16, 19)**
  - Controller → Service Layer → Repository Layer → SQL Server EF Core.
  - Data transfer objects (DTOs) with model validation attributes.
  - Global structured exception handling middleware.
  - Host permission verification on SignalR audio controls.

---

## 🛠️ Tech Stack

### Frontend
- **Angular 22** (Standalone Components, modern signals & RxJS)
- **TypeScript**
- **HTML5 & Vanilla CSS** (Curated light neutral palette, responsive flexbox/grid)
- **SignalR Client** (`@microsoft/signalr`)
- **Web Audio API & HTMLAudioElement**

### Backend
- **ASP.NET Core 9.0 Web API**
- **C# 13**
- **ASP.NET Core SignalR** (WebSockets / Server-Sent Events / Long Polling fallback)
- **Entity Framework Core 9.0**
- **Microsoft SQL Server / LocalDB**
- **Swagger / OpenAPI**

---

## 📁 Project Structure

```
BeatSync/
├── BeatSync.Client/                  # Angular 22 Frontend Application
│   ├── src/
│   │   ├── app/
│   │   │   ├── core/
│   │   │   │   ├── models/           # Typed TypeScript interfaces (Room, Participant, Track, PlaybackState)
│   │   │   │   └── services/         # RoomService, SignalRService, AudioService, AudioDeviceService, UserService
│   │   │   ├── shared/
│   │   │   │   └── components/       # HeaderComponent, FooterComponent, ToastComponent
│   │   │   ├── pages/
│   │   │   │   ├── home/             # Phase 1: Landing page with room code input & username generator
│   │   │   │   ├── room/             # Phase 5: Synchronized player & live participants panel
│   │   │   │   ├── login/            # Optional sign-in page
│   │   │   │   └── profile/          # User audio preferences
│   │   │   ├── app.routes.ts         # Route definitions
│   │   │   ├── app.config.ts         # Angular providers (HttpClient, Router)
│   │   │   └── app.ts                # Root application container
│   │   ├── index.html
│   │   └── styles.css                # Global design system & theme tokens
│   ├── angular.json
│   └── package.json
│
├── BeatSync.API/                     # ASP.NET Core 9.0 Web API & SignalR
│   ├── Controllers/
│   │   ├── RoomsController.cs        # REST endpoints for room CRUD & validation
│   │   ├── ParticipantsController.cs # REST endpoints for participants
│   │   └── TracksController.cs       # REST endpoints for track retrieval and audio upload
│   ├── Hubs/
│   │   └── RoomHub.cs                # Real-time SignalR Hub (Join, Leave, Play, Pause, Seek, ChangeTrack)
│   ├── Services/
│   │   ├── IRoomService.cs / RoomService.cs
│   │   ├── IParticipantService.cs / ParticipantService.cs
│   │   ├── ITrackService.cs / TrackService.cs
│   │   └── ISyncService.cs / SyncService.cs (Thread-safe concurrent in-memory playback coordinator)
│   ├── Repositories/
│   │   ├── IRoomRepository.cs / RoomRepository.cs
│   │   ├── IParticipantRepository.cs / ParticipantRepository.cs
│   │   └── ITrackRepository.cs / TrackRepository.cs
│   ├── Models/
│   │   ├── Room.cs                   # Room entity (Id, RoomCode, Name, HostUserId, CreatedAt, IsActive)
│   │   ├── Participant.cs            # Participant entity (Id, RoomId, Username, ConnectionId, IsHost, IsConnected)
│   │   └── Track.cs                  # Track entity (Id, Title, Artist, AudioUrl, ArtworkUrl, Duration)
│   ├── DTOs/
│   │   ├── CreateRoomDto.cs
│   │   ├── JoinRoomDto.cs
│   │   ├── RoomDto.cs
│   │   ├── ParticipantDto.cs
│   │   ├── TrackDto.cs
│   │   ├── PlaybackStateDto.cs
│   │   └── RoomStateDto.cs
│   ├── Data/
│   │   ├── BeatSyncDbContext.cs      # EF Core DbContext with model fluent configurations
│   │   ├── DbInitializer.cs          # Automatic database migrations and track seeding
│   │   └── AudioGenerator.cs         # Generates royalty-free procedural WAV files on startup
│   ├── Middleware/
│   │   └── ExceptionMiddleware.cs    # Global structured error handling middleware
│   ├── wwwroot/
│   │   ├── audio/                    # Playable procedural WAV files
│   │   └── artworks/                 # SVG artwork files
│   ├── appsettings.json              # SQL Server connection string & logging configuration
│   └── Program.cs                    # ASP.NET Core dependency injection, CORS, & SignalR mapping
│
├── test-sync.js                      # Multi-client automated SignalR synchronization test
└── README.md
```

---

## ⚙️ Prerequisites

Make sure the following tools are installed on your machine:
- [.NET 9.0 SDK](https://dotnet.microsoft.com/download/dotnet/9.0)
- [Node.js](https://nodejs.org/) (v18, v20, or v22+) & `npm`
- [SQL Server](https://www.microsoft.com/sql-server/) or **SQL Server LocalDB** (included with Visual Studio or SQL Server Express)
- `dotnet-ef` CLI tool:
  ```bash
  dotnet tool install --global dotnet-ef
  ```

---

## 🗄️ Database Setup (SQL Server LocalDB)

The application is pre-configured to use **SQL Server LocalDB**.

### Connection String in `BeatSync.API/appsettings.json`:
```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=(localdb)\\MSSQLLocalDB;Database=BeatSyncDb;Trusted_Connection=True;TrustServerCertificate=True;MultipleActiveResultSets=true;"
  }
}
```

> **Note:** If you are using a full SQL Server instance, simply update the `Server` name (e.g., `Server=localhost;Database=BeatSyncDb;User Id=sa;Password=YourPassword;...`).

### Apply EF Core Migrations:
Open a terminal in `BeatSync.API/`:
```bash
cd BeatSync.API
dotnet ef database update
```
*(The backend also automatically applies pending migrations and seeds initial sample tracks on startup via `DbInitializer.cs`.)*

---

## 🏃 How to Run the Backend (ASP.NET Core API)

1. Open a terminal in `BeatSync.API`:
   ```bash
   cd BeatSync.API
   dotnet restore
   dotnet run --urls "http://localhost:5000"
   ```
2. The backend will start on:
   - **API / SignalR**: `http://localhost:5000`
   - **Swagger UI**: `http://localhost:5000/swagger`
   - **SignalR Hub**: `http://localhost:5000/hubs/room`

---

## 💻 How to Run the Frontend (Angular)

1. Open a second terminal in `BeatSync.Client`:
   ```bash
   cd BeatSync.Client
   npm install
   npm start
   ```
   *(Or using Angular CLI directly: `ng serve --port 4200`)*

2. Open your browser and navigate to:
   ```
   http://localhost:4200
   ```

---

## 🧪 Testing the Application (Multi-User Verification)

### Automated SignalR Multi-Client Test
A test script is included to test end-to-end SignalR communication, join/leave events, synchronized playback, and seek events:
```bash
node test-sync.js
```
Expected output:
```
--- Starting BeatSync SignalR Multi-User Test ---
Host connected to SignalR Hub.
Listener connected to SignalR Hub.
Host joined room. Current participants: 1
[Host Event] UserJoined: silent-wolf IsHost: false
Listener joined room. Current participants: 2
Host triggering PLAY at 5.0 seconds...
[Listener Event] PlaybackStateChanged: { trackId: 1, isPlaying: true, currentPosition: 5, ... }
Host triggering SEEK to 22.5 seconds...
[Listener Event] SeekChanged to: 22.5 at server time: 1790675484865
Host triggering CHANGE TRACK to Track 2...
[Listener Event] TrackChanged to: Midnight Beats
Listener leaving room...
[Host Event] UserLeft: silent-wolf

--- Test Summary Results ---
1. Host received UserJoined: PASS
2. Listener received Play state: PASS
3. Listener received Seek event: PASS
4. Listener received TrackChange event: PASS
5. Host received UserLeft: PASS
Overall Result: ALL TESTS PASSED SUCCESSFULLY!
```

### Manual Multi-Window Browser Test
1. **Window 1 (Host)**:
   - Open `http://localhost:4200` in Google Chrome.
   - Note the generated username (e.g. `productive-eagle`) or click the shuffle icon to regenerate.
   - Click **"Create New Room"**.
   - You are navigated to `/room/ABC123`.
   - Notice the **"👑 You are the Host"** badge and your username in the **Participants** list.
   - Click the **Play (▶)** button. The vinyl disc will begin spinning and procedural music plays.
2. **Window 2 (Participant / Listener)**:
   - Open an Incognito window or second browser (e.g. Microsoft Edge / Firefox) to `http://localhost:4200`.
   - Your second user gets a unique username (e.g. `silent-wolf`).
   - Enter the 6-character room code from Window 1 into the input field and click **"Join Room"**.
   - Window 2 joins the room:
     - Shows **"🎧 Listening in sync with productive-eagle"**.
     - Shows both users in the **Participants** panel.
     - Audio plays in sync with the host's playback position.
3. **Test Seek & Track Synchronization**:
   - In Window 1, click anywhere on the progress bar.
   - Notice Window 2 immediately seeks to the exact same position!
   - In Window 1, change the track using the dropdown or the Next button.
   - Notice Window 2 changes to the new track and begins synchronized playback!
4. **Test Local Volume**:
   - Move the volume slider in Window 2.
   - Notice only Window 2's volume changes; Window 1's volume remains completely unaffected.
5. **Test Leave & Host Reassignment**:
   - Close or click "Leave" in Window 1.
   - Notice Window 2 receives a `UserLeft` notification and is automatically promoted to the new Host, transferring master playback controls!

---

## 🔒 Security & Validation Details

- Room codes and usernames are validated on both client and server (alphanumeric, length restrictions, prevention of dangerous input).
- SignalR playback commands (`Play`, `Pause`, `Seek`, `ChangeTrack`) are strictly authorized on the backend: only the connection ID matching the designated room host is permitted to alter master playback state.
- Uploaded audio files are strictly checked for valid audio extensions (`.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac`) and enforced to a 25MB maximum size.

---

## 📜 License
This is an open educational and learning recreation. All assets and procedural audio tracks are royalty-free and copyright-safe.
