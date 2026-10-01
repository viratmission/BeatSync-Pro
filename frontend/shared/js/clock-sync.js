/**
 * BeatSync-Pro High-Precision NTP-Style Client Clock Synchronization Engine
 * Calculates clock offset relative to master server using low-RTT samples.
 */

class ClientClockSync {
  constructor(wsSender) {
    this.send = wsSender;
    this.offsetMs = 0;
    this.rttMs = 0;
    this.samples = []; // array of { rtt, offset }
    this.maxSamples = 12;
    this.isCalibrated = false;
    this.pingInterval = null;
  }

  startCalibration() {
    this.samples = [];
    // Perform rapid initial calibration (6 pings spaced 120ms apart)
    let pingsSent = 0;
    const rapidPing = setInterval(() => {
      this.sendPing();
      pingsSent++;
      if (pingsSent >= 6) {
        clearInterval(rapidPing);
      }
    }, 120);

    // Then maintain continuous calibration every 2.5 seconds
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      this.sendPing();
    }, 2500);
  }

  stop() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  sendPing() {
    if (typeof this.send !== 'function') return;
    const t0 = performance.now() + performance.timeOrigin;
    this.send({
      version: 1,
      type: "clock-ping",
      clientTime: t0
    });
  }

  handlePong(data) {
    const t0 = data.clientTime;
    const t1 = data.serverTime;
    const t2 = performance.now() + performance.timeOrigin;

    const rtt = Math.max(0.5, t2 - t0);
    // Offset = serverTime - (clientSendTime + rtt/2)
    const offset = t1 - (t0 + (rtt / 2.0));

    this.samples.push({ rtt, offset });
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    // Sort by lowest RTT (NTP algorithm prioritizes lowest latency paths)
    const sorted = [...this.samples].sort((a, b) => a.rtt - b.rtt);
    // Discard top 30% highest latency outliers, take best 3-4 lowest RTT samples
    const bestCount = Math.max(1, Math.min(4, Math.floor(sorted.length * 0.7) || 1));
    const best = sorted.slice(0, bestCount);

    const avgOffset = best.reduce((acc, s) => acc + s.offset, 0) / best.length;
    const avgRtt = best.reduce((acc, s) => acc + s.rtt, 0) / best.length;

    // Smooth with moving average if already calibrated
    if (this.isCalibrated) {
      this.offsetMs = (this.offsetMs * 0.4) + (avgOffset * 0.6);
      this.rttMs = (this.rttMs * 0.4) + (avgRtt * 0.6);
    } else {
      this.offsetMs = avgOffset;
      this.rttMs = avgRtt;
      this.isCalibrated = true;
    }
  }

  /**
   * Returns authoritative server timestamp in milliseconds with sub-millisecond precision.
   */
  now() {
    return (performance.now() + performance.timeOrigin) + this.offsetMs;
  }

  getTelemetry() {
    return {
      rttMs: Math.round(this.rttMs * 10) / 10,
      offsetMs: Math.round(this.offsetMs * 10) / 10,
      calibrated: this.isCalibrated
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ClientClockSync };
}
