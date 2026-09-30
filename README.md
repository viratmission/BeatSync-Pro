# BeatSync Pro — Synchronized Real-Time Web Audio & Multi-Device Sync Cinema

**BeatSync Pro** is an advanced full-stack real-time entertainment application built with **Angular 22**, **ASP.NET Core 9.0 Web API**, **SignalR**, and **WebRTC / Web Audio API**. It supports both **Synchronized Music Rooms** and a cutting-edge **Multi-Device Sync Cinema Surround Experience**.

---

## 🎬 Product Overview: Multi-Device Sync Cinema

Transform any room into a personal wireless **5.1 / 7.1 Surround Sound Home Theater** using everyday devices:

```
                  📱 Phone 1 (Front Left)    📱 Phone 2 (Front Center)    📱 Phone 3 (Front Right)
                                                     🔊
                                            [ 💻 MASTER LAPTOP ]
                                              🎬 4K/HD Video Host
                                                     🔊
                  📱 Phone 4 (Surround Left)        👤 USERS             📱 Phone 5 (Surround Right)
                                                     🔊
                  📱 Phone 6 (Rear Left)     📱 Phone 7 (Rear Center)     📱 Phone 8 (Rear Right)
```

### Roles & Architecture
1. **Laptop (Authoritative Host)**:
   - Plays local or streamed video (HTML5 `<video>`, MP4/WebM/MKV).
   - Controls master playback (Play, Pause, Seek, Rate).
   - Captures audio via `HTMLVideoElement.captureStream()` or Web Audio API.
   - Monitors live connected phone speakers via an interactive **Theater Surround Map** and real-time telemetry panel.
2. **Phones / Tablets (Surround Speakers)**:
   - Act **strictly as wireless audio-only surround sound speakers**.
   - **CRITICAL BANDWIDTH SAVING**: Phones **never download the video stream**. They receive audio tracks exclusively via low-latency **WebRTC P2P streams** or chunked **HTTP Range requests** (~48kbps Opus audio per device).
   - Dynamic channel reassignment (Front Left, Front Center, Front Right, Surround Left, Surround Right, Rear Left, Rear Center, Rear Right).
   - Mobile autoplay unlock overlay & Screen Wake Lock so phones do not sleep mid-movie.
   - Local volume calibration and test chime sound generator.

### High-Precision Sync Engine
- **Clock Drift Calibration**: Clients compute RTT and clock offset through high-frequency ping-pong time requests to the backend.
- **Scheduled Playback**: When the Host presses Play, commands are broadcast with a future server timestamp (`ServerNow + 100ms`), allowing all phones to start playback synchronously, eliminating packet jitter.
- **Multi-Tier Drift Mitigation**:
  - **Tight Alignment (< 50ms)**: Standard $1.0\times$ playback speed.
  - **Smooth Rate Adjustment (50ms – 500ms)**: Sub-audible pitch-preserved speed adjustment ($1.05\times$ to catch up, $0.95\times$ to wait) without pops or audible stutter.
  - **Hard Seek (> 500ms)**: Instantaneous seek for major desync events.

---

## 🚀 Features Summary

### 1. Multi-Device Cinema Experience
- **Cinema Host Dashboard (`/cinema/host/:roomCode`)**:
  - HTML5 Video player with custom controls, local file picker, and sample trailer loader.
  - Interactive 8-channel theater seating diagram with live device placement dots.
  - Master timeline scrub bar, play/pause, seek, volume, and playback rate.
  - Live device telemetry table showing RTT, drift in ms, volume, and sync status for each phone.
- **Cinema Phone Speaker HUD (`/cinema/device/:roomCode`)**:
  - Dark cinema mode interface with glowing animated audio equalizer.
  - Channel badge and position switcher (FL, FC, FR, SL, SR, RL, RC, RR).
  - Tap-to-Unlock audio gesture banner for mobile iOS Safari & Android Chrome.
  - Local speaker volume slider and mute toggle.
  - Live audio drift counter and sync status indicator.
  - Test speaker output tone generator.

### 2. Standard Audio Sync Rooms (`/room/:roomCode`)
- Synchronized multi-device music listening rooms.
- Built-in royalty-free procedural synthwave, lo-fi, and ambient tracks.
- Custom audio file upload (MP3, WAV, OGG, M4A, AAC).
- Spinning vinyl disc visualization and live presence list.
- Automatic host migration if the original room host disconnects.

---

## 🛠️ Tech Stack

### Frontend
- **Angular 22** (Standalone Components, Signals & RxJS)
- **TypeScript 5**
- **Vanilla CSS3** (Futuristic dark glassmorphism design system)
- **SignalR Client** (`@microsoft/signalr`)
- **WebRTC API** (RTCPeerConnection audio-only mesh)
- **Web Audio API** (Spatial panning, low-latency audio processing, sine wave test generator)

### Backend
- **ASP.NET Core 9.0 Web API**
- **C# 13**
- **SignalR Core** (Low-latency WebSockets hub)
- **Entity Framework Core 9.0**
- **Microsoft SQL Server / LocalDB**
- **HTTP Range Streaming** (RFC 7233 partial content audio delivery)

---

## 📁 Project Structure

```
BeatSync/
├── BeatSync.Client/                  # Angular 22 Frontend Application
│   ├── src/
│   │   ├── app/
│   │   │   ├── core/
│   │   │   │   ├── models/           # cinema.model.ts, room.model.ts, participant.model.ts, playback-state.model.ts
│   │   │   │   └── services/         # cinema.service.ts, signalr.service.ts, room.service.ts, audio-device.service.ts
│   │   │   ├── pages/
│   │   │   │   ├── home/             # Landing page (Join room, Host Cinema, Create Music Room)
│   │   │   │   ├── cinema-host/      # Laptop Host UI: Video player, 8-speaker theater map, telemetry
│   │   │   │   ├── cinema-device/    # Phone Speaker UI: Channel indicator, drift telemetry, volume
│   │   │   │   ├── room/             # Standard BeatSync music listening room
│   │   │   │   ├── login/            # Sign-in
│   │   │   │   └── profile/          # User preferences
│   │   │   ├── app.routes.ts         # Angular routes
│   │   │   └── app.config.ts
│   ├── angular.json
│   └── package.json
│
├── BeatSync.API/                     # ASP.NET Core 9.0 Web API & SignalR
│   ├── Controllers/
│   │   ├── CinemaController.cs       # Media metadata, sample trailer, and HTTP 206 range audio streaming
│   │   ├── RoomsController.cs        # Room creation, validation, and listing
│   │   ├── ParticipantsController.cs # Participants query and device updates
│   │   └── TracksController.cs       # Audio track retrieval & upload
│   ├── Hubs/
│   │   └── RoomHub.cs                # Real-time Cinema & Music SignalR hub
│   ├── Services/
│   │   ├── ISyncService.cs / SyncService.cs          # Cinema command distributor & state manager
│   │   ├── IRoomService.cs / RoomService.cs          # Room lifecycle
│   │   └── IParticipantService.cs / ParticipantService.cs # Speaker assignments
│   ├── Models/
│   │   ├── Room.cs                   # RoomMode: 'AudioSync' | 'Cinema', MediaTitle, MediaDuration
│   │   └── Participant.cs            # DeviceRole: 'HostVideo' | 'AudioSpeaker', DevicePosition
│   ├── DTOs/                         # CinemaPlaybackCommandDto, DevicePositionUpdateDto, DeviceSyncReportDto
│   ├── Data/
│   │   ├── BeatSyncDbContext.cs
│   │   ├── AudioGenerator.cs         # Generates procedural surround cinema test audio
│   │   └── DbInitializer.cs
│   └── wwwroot/                      # Compiled Angular browser bundle & audio assets
│
├── test-cinema-sync.js               # End-to-end 1 Host + 8 Phone Speaker Cinema simulation test
├── test-sync.js                      # Standard music room regression test
└── README.md
```

---

## 🏃 Getting Started

### 1. Database & Migrations (SQL Server LocalDB)
Ensure .NET 9.0 SDK is installed:
```bash
cd BeatSync.API
dotnet ef database update
```
*(The API will automatically apply any pending migrations and seed sample audio on boot.)*

### 2. Run the Backend API
```bash
cd BeatSync.API
dotnet run --urls "http://localhost:5000"
```
The API is available at `http://localhost:5000`.

### 3. Run or Build the Frontend
In development:
```bash
cd BeatSync.Client
npm install
npm start
```
Or build and host directly via ASP.NET Core `wwwroot`:
```bash
cd BeatSync.Client
npm run build
Copy-Item -Path "dist\BeatSync.Client\browser\*" -Destination "..\BeatSync.API\wwwroot\" -Recurse -Force
```

---

## 🧪 Automated Testing

### 1. Cinema Surround Multi-Device Test (1 Host + 8 Phone Speakers)
Simulates a master laptop host and 8 wireless phone speakers joining across all surround channels, verifying scheduled play, seek, dynamic position updates, drift telemetry reporting, WebRTC signaling, and HTTP 206 range streaming:
```bash
node test-cinema-sync.js
```
**Output**:
```
===============================================================
  BEATSYNC PRO — MULTI-DEVICE SYNC CINEMA VERIFICATION TEST
  Simulating: 1 Laptop Host + 8 Wireless Phone Speakers
===============================================================
✓ Cinema Room created successfully: [NYPPDE] (Mode: Cinema)
✓ Host joined room [NYPPDE]. ConnectionId: ha_i0Ysv_noe-VLj1mk3Bw
✓ All 8 phone surround speakers connected and registered!
✓ Play broadcast verified: 8/8 phones received command: ALL PASS
✓ Seek broadcast verified: 8/8 phones received seek: ALL PASS
✓ Position change propagated to Host: PASS
✓ Host received 8/8 speaker telemetry reports
✓ Phone 1 received WebRTC offer: PASS
✓ Host received WebRTC answer back: PASS
✓ Pause broadcast verified: 8/8 phones received pause: ALL PASS
✓ Audio Range Streaming test: PASS (HTTP 206 / 200)

🎉 ALL 10 CINEMA SURROUND MULTI-DEVICE TESTS PASSED PERFECTLY!
```

### 2. Standard Audio Room Regression Test
Verifies that standard music rooms maintain 100% backward compatibility:
```bash
node test-sync.js
```
**Output**:
```
Overall Result: ALL TESTS PASSED SUCCESSFULLY!
```

---

## 📱 How to Experience Cinema Mode in Your Home

1. **Laptop (Host)**:
   - Go to `http://localhost:5000` (or your local IP / domain).
   - Click **"🎬 Host Cinema Surround"**.
   - Load any movie file (MP4/WebM) from your hard drive, or click **"Load Demo Cinema Trailer"**.
   - Note the 6-letter Room Code (e.g. `ABCXYZ`).
2. **Phones (Speakers)**:
   - On each phone's browser, navigate to the room link or enter the Room Code on the home page.
   - The app automatically detects Cinema mode and routes to the **Surround Speaker HUD**.
   - Tap **"🔊 Tap to Connect Audio"** to activate the phone speaker.
   - Position phones around your seating area:
     - Phone 1: Front Left
     - Phone 2: Front Center
     - Phone 3: Front Right
     - Phone 4: Surround Left
     - Phone 5: Surround Right
     - Phone 6: Rear Left
     - Phone 7: Rear Center
     - Phone 8: Rear Right
3. **Enjoy the Movie**:
   - Hit **Play** on the Laptop.
   - The laptop plays 4K/HD video and sound while every phone plays the synchronized audio stream in real-time surround sound!

---

## 📜 License
This project is open-source and intended for educational and multi-device synchronization research.
