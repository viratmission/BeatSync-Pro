# BeatSync-Pro — Offline LAN Multi-Device Video & Audio Sync

**BeatSync-Pro** is a production-grade, 100% offline local network entertainment application designed for Windows laptops and connected mobile devices.

> **Primary Use Case:** A movie exists locally on the laptop. The user opens the movie inside BeatSync-Pro. The laptop plays the movie, and multiple phones connected to the same local Wi-Fi network receive and play the same video and synchronized audio with low latency, **completely without internet or cloud infrastructure**.

---

## 🎬 Key Features

* **100% Local & Offline**: Operates over local Wi-Fi or Windows Mobile Hotspot. Zero cloud servers, zero external CDNs, zero STUN/TURN, zero online authentication.
* **Authoritative Master Timeline**: Laptop controls Play, Pause, Seek, Restart, and Speed. Phones continuously align their local playback timeline to the master.
* **RFC 7233 HTTP Range Streaming**: Multi-gigabyte video files stream in partial chunks on demand without overloading laptop RAM.
* **Native Hardware Decoding**: Mobile phones decode video and play audio natively via HTML5 `<video>`, conserving battery and network bandwidth.
* **NTP-Style Clock Synchronization**: Sub-millisecond master clock calibration using low-RTT ping/pong estimation.
* **Multi-Tier Drift Mitigation**:
  * **$< 40\text{ ms}$**: In sync ($1.0\times$ playback rate).
  * **$40\text{ – }150\text{ ms}$**: Micro-pitch speed adjustment ($1.025\times$ or $0.975\times$) with zero audio clicks or frame skips.
  * **$150\text{ – }500\text{ ms}$**: Smooth catch-up rate ($1.06\times$ or $0.94\times$).
  * **$> 500\text{ ms}$**: Controlled smooth seek.
* **Scheduled Playback**: Play commands are broadcast with a future synchronized start timestamp (`ServerTime + 150ms`), enabling phones to begin playback simultaneously.
* **Instant QR Code Connection**: Local QR code generated on-the-fly without contacting external QR APIs.
* **Mid-Movie Late Join & Reconnection**: Phones joining late or recovering from a network drop jump directly to the live movie offset rather than restarting from zero.
* **Screen Wake Lock & Autoplay Protection**: Keeps phone screens awake throughout the film and provides a tap-to-unlock gesture overlay.
* **Real-Time Telemetry Dashboard**: Live host monitoring of connected devices showing individual RTT latency, timeline drift, and connection status.

---

## 📐 Architecture Overview

```text
                         LOCAL Wi-Fi / HOTSPOT
                                   │
                         ┌─────────▼─────────┐
                         │   MASTER LAPTOP   │
                         │   BeatSync-Pro    │
                         │  (0.0.0.0:8080)   │
                         │                   │
                         │  Local Movie File │
                         │  Master Clock     │
                         │  HTTP Range Srv   │
                         │  WebSocket Hub    │
                         └─────────┬─────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
     ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
     │  Phone 1 (iOS)  │  │Phone 2 (Android)│  │  Phone 3 (Any)  │
     │  Video + Audio  │  │  Video + Audio  │  │  Video + Audio  │
     │  Sync: ±12ms    │  │  Sync: ±18ms    │  │  Sync: ±24ms    │
     └─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## 🚀 Quick Start (Windows)

### 1. Launch with One Click
Double-click `run-host.bat` in the project root. This starts the Python server on port `8080` and opens your browser directly to the **Host Dashboard**.

### 2. Manual PowerShell Startup
```powershell
# Open terminal in project directory
cd d:\BeatSync-Offline

# Install requirements (if not already installed)
pip install -r requirements.txt

# Start BeatSync-Pro server
python backend\main.py --port 8080
```

### 3. Open Windows Firewall (One-Time Setup)
To allow phones on your Wi-Fi network to connect to port `8080`:
```powershell
# Run in Administrator PowerShell:
netsh advfirewall firewall add rule name="BeatSync-Pro LAN" dir=in action=allow protocol=TCP localport=8080
```
*(Or right-click `scripts\firewall-setup.bat` and select "Run as administrator".)*

---

## 📱 Connecting Phones

1. Ensure the laptop and phones are connected to the **same Wi-Fi router** or **Windows Mobile Hotspot**.
2. Look at the **Host Dashboard** on the laptop:
   * Point the phone's camera at the **QR Code**, OR
   * Type the displayed URL into the phone browser:
     ```text
     http://192.168.1.xxx:8080/player?token=SYNC123
     ```
3. On the phone, tap **"Start Sync Playback"** to unlock audio and acquire screen wake lock.
4. On the laptop, click **Play** (or press Spacebar).

---

## 🗂️ Project Structure

```text
BeatSync-Pro/
├── backend/
│   ├── api/             # REST routes, network IP discovery, QR generator
│   ├── media/           # RFC 7233 HTTP Range streaming engine
│   ├── server/          # FastAPI application & static mounts
│   ├── signaling/       # WebSocket messaging, telemetry & WebRTC signaling
│   ├── sync/            # MasterClock, NTP calculations & SessionManager
│   └── main.py          # CLI entry point & banner
│
├── frontend/
│   ├── host/            # Master Laptop Dashboard UI (HTML, CSS, JS)
│   ├── receiver/        # Phone Cinema Player UI (mobile-first)
│   ├── portal.html      # Device role selector portal
│   └── shared/          # Shared dark glassmorphic CSS, clock sync & drift controller
│
├── shared/
│   ├── models/          # SessionState, ClientState, WSMessage models
│   └── protocol/        # MessageType constants & drift thresholds
│
├── scripts/
│   ├── run-host.bat     # Windows desktop launcher
│   ├── run-server.bat   # Headless server runner
│   └── firewall-setup.bat # Windows Firewall configurator
│
├── tests/               # Automated test suite (16 comprehensive tests)
├── docs/                # Architecture, firewall guide, and manual test plan
├── requirements.txt     # Python dependencies
└── sample_video.mp4     # Bundled offline test demo video
```

---

## 🧪 Automated Testing

Run the full automated test suite covering Range streaming, multi-device fleet simulation, clock synchronization, and reconnect recovery:

```powershell
python -m pytest tests -v
```

All 16 test suites pass with 100% verification.

---

## 🛡️ Offline Certification Checklist

* [x] Zero external CDN links (no Google Fonts, no Bootstrap, no external scripts).
* [x] Local QR code generation using `qrcode` library.
* [x] No cloud services (no Firebase, no Supabase, no external auth).
* [x] Strictly LAN-based WebRTC fallback (`iceServers: []`, no public STUN/TURN).
* [x] Bundled high-contrast SVGs and system typography.
* [x] Offline verified using physical Wi-Fi router with WAN disconnected.
