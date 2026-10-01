# BeatSync-Pro — Offline LAN Architecture Specification

BeatSync-Pro is an offline, multi-device synchronized cinema system designed for local area networks (Wi-Fi and mobile hotspots). The laptop acts as the authoritative master clock and timeline host, while multiple smartphones connected to the same LAN stream and decode the video locally with continuous timeline alignment.

---

## 1. Core Architecture Diagram

```text
                       LOCAL Wi-Fi / LAN
                              │
                    ┌─────────▼─────────┐
                    │     LAPTOP        │
                    │                   │
                    │   BeatSync-Pro    │
                    │   (Master Host)   │
                    │                   │
                    │  Local Movie File │
                    │       ↓           │
                    │  Master Clock     │
                    │       ↓           │
                    │ HTTP Range Server │
                    │ WebSocket Server  │
                    └───────┬───────────┘
                            │
             ┌──────────────┼──────────────┐
             │              │              │
             ▼              ▼              ▼
        ┌────────┐     ┌────────┐     ┌────────┐
        │ Phone 1│     │ Phone 2│     │ Phone 3│
        │        │     │        │     │        │
        │ Video  │     │ Video  │     │ Video  │
        │ Audio  │     │ Audio  │     │ Audio  │
        └────────┘     └────────┘     └────────┘
```

---

## 2. Media Distribution Strategy (RFC 7233 HTTP Range Streaming)

Rather than re-encoding video frames through WebRTC (which consumes massive laptop CPU and fails with 4K/high-bitrate movies), BeatSync-Pro uses **Local HTTP Range Serving**:

1. **Native Client Hardware Decoding**: Each mobile device streams the original MP4/WebM file over HTTP and uses its hardware video decoder (GPU/VPU).
2. **Chunked Partial Content**: The Python backend reads files asynchronously in 256 KB chunks using `Range: bytes=start-end` and returns `HTTP 206 Partial Content`.
3. **RAM Efficiency**: Multi-gigabyte movies are streamed directly from disk without buffering the file into RAM.
4. **Seeking**: Mobile video players can instantly seek to any keyframe using HTTP byte offsets.

---

## 3. High-Precision Master Timeline Synchronization

The master laptop owns the authoritative playback timeline.

### Synchronized Timeline State
```json
{
  "version": 1,
  "type": "sync",
  "sequence": 1042,
  "currentTime": 125.500,
  "playing": true,
  "playbackRate": 1.0,
  "masterTimestamp": 1720000000000,
  "serverTime": 1720000000750
}
```

### Expected Position Calculation
Each phone evaluates where it should currently be in the video:

$$\text{ExpectedTime} = \text{CurrentTime} + \left( \frac{\text{Clock}_{\text{master}}(t) - \text{MasterTimestamp}}{1000} \right) \times \text{PlaybackRate}$$

$$\text{Drift} = \text{LocalVideo.currentTime} - \text{ExpectedTime}$$

---

## 4. NTP-Style Clock Synchronization Protocol

Mobile phone hardware clocks drift and may not be set accurately. To establish a shared timeline, BeatSync-Pro implements a local NTP clock exchange:

1. Phone sends `clock-ping` with client send timestamp $t_0$.
2. Server responds immediately with `clock-pong` containing $t_0$ and server timestamp $t_1$.
3. Phone receives packet at client receive timestamp $t_2$.
4. Metrics calculated:
   $$\text{RTT} = t_2 - t_0$$
   $$\text{Offset} = t_1 - \left( t_0 + \frac{\text{RTT}}{2} \right)$$
5. The client gathers multiple samples and filters by lowest RTT, producing sub-millisecond clock alignment.

---

## 5. Multi-Tier Playback Drift Mitigation

To prevent visible stuttering or audio popping from frequent hard seeks, BeatSync-Pro applies a tiered correction algorithm:

| Drift Range | Action | Playback Rate | Audio Artifacts |
|---|---|---|---|
| $|\text{Drift}| < 40\text{ ms}$ | **Deadzone** | $1.0\times$ (Unmodified) | None |
| $40\text{ ms} \le |\text{Drift}| < 150\text{ ms}$ | **Micro Pitch Adjustment** | $1.025\times$ (Behind) / $0.975\times$ (Ahead) | None (Preserves pitch) |
| $150\text{ ms} \le |\text{Drift}| < 500\text{ ms}$ | **Moderate Adjustment** | $1.06\times$ (Behind) / $0.94\times$ (Ahead) | Negligible |
| $|\text{Drift}| \ge 500\text{ ms}$ | **Hard Controlled Seek** | Set `video.currentTime = expected` | Brief frame reposition |

---

## 6. Scheduled Simultaneous Start

When the host clicks **Play**, the server calculates a future timestamp:
$$\text{startAt} = \text{ServerNow} + 150\text{ ms}$$
This command is broadcast over WebSocket:
```json
{
  "version": 1,
  "type": "play",
  "position": 52.300,
  "startAt": 1720000000150
}
```
All phones schedule `video.play()` to execute precisely when their synchronized clock reaches `startAt`, starting video and audio simultaneously across all devices.

---

## 7. Offline WebRTC Fallback Mode

If local HTTP streaming is blocked by client browser policies, an offline WebRTC audio/video mesh can be initialized:
- Configuration: `new RTCPeerConnection({ iceServers: [] })`.
- Public STUN/TURN servers are strictly prohibited.
- Host candidates are exchanged over the local WebSocket signaling channel.
