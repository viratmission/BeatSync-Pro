# BeatSync-Pro — End-to-End Manual Test Plan

Follow this verification procedure to validate all synchronization, streaming, and failure-recovery behaviors on physical devices.

---

## Prerequisites
- 1 Windows Laptop (Host)
- 1–3 Smartphones (iOS or Android)
- Connected to the same Wi-Fi router OR Windows Mobile Hotspot (No Internet needed)
- Windows Firewall configured for TCP port 8080 (`scripts\firewall-setup.bat`)

---

## Test Cases

### Test 1: Laptop + One Phone Baseline Playback
1. On the laptop, run `run-host.bat`.
2. The laptop browser opens `http://localhost:8080/host?token=...`.
3. Click **"Load Sample Demo Video"** or select a local `.mp4` file.
4. On Phone 1, scan the QR code displayed on the laptop or navigate to `http://<LAPTOP_IP>:8080/player?token=...`.
5. Tap **"Start Sync Playback"** on Phone 1 to unlock audio.
6. On the laptop, press **Play** (or Spacebar).
7. **Verification**:
   - Laptop video plays smoothly.
   - Phone 1 displays the identical video.
   - Phone 1 plays the movie audio through its speaker or headphones.
   - The laptop dashboard shows Phone 1 connected with drift within $\pm 40\text{ ms}$.

---

### Test 2: Second Phone Multi-Device Alignment
1. Keep the movie playing from Test 1.
2. On Phone 2, scan the QR code and tap to unlock audio.
3. **Verification**:
   - Phone 2 loads the movie and immediately synchronizes to the ongoing playback.
   - Both Phone 1 and Phone 2 play video and audio in tight unison without echo or noticeable drift.
   - The laptop dashboard lists both devices with individual drift measurements.

---

### Test 3: Synchronized Pause
1. While both phones are playing, click **Pause** on the laptop.
2. **Verification**:
   - Laptop video pauses instantly.
   - Phone 1 and Phone 2 pause within $\approx 100\text{ ms}$.
   - Floating toast on phones reads *"Master paused movie"*.

---

### Test 4: Synchronized Seeking
1. While paused (or playing), drag the laptop timeline scrubber to a new position (e.g., `00:35:00`).
2. **Verification**:
   - Laptop video jumps to `00:35:00`.
   - Both phones jump to the same time offset.
   - If playing, playback resumes synchronously on all devices.

---

### Test 5: Phone Disconnect Resilience
1. Turn off Wi-Fi on Phone 1 (or close its browser tab).
2. **Verification**:
   - The laptop host continues playing without interruption.
   - Phone 2 continues playing without interruption.
   - Laptop dashboard updates the active device list and removes Phone 1 after timeout.

---

### Test 6: Mid-Movie Reconnection / Late Join
1. Turn Wi-Fi back on Phone 1 and reopen the receiver URL.
2. Tap to unlock audio.
3. **Verification**:
   - Phone 1 receives the latest authoritative session state.
   - Phone 1 seeks directly to the current movie position instead of restarting from the beginning.
   - Playback aligns with the laptop and Phone 2.

---

### Test 7: 100% Offline / No-Internet Validation
1. Unplug the internet cable from your Wi-Fi router (or turn off cellular data sharing on your hotspot).
2. Verify Wi-Fi remains active locally between laptop and phones.
3. Perform play, pause, seek, and reload actions.
4. **Verification**:
   - The application functions completely without degradation.
   - Zero requests are sent to external CDNs or cloud servers.
   - Native QR code, styles, and streaming work 100% offline.
