 /**
 * BeatSync-Pro High-Precision Client Clock Synchronization
 *
 * Synchronizes the browser clock with the authoritative server clock
 * using an NTP-style request/response calculation.
 *
 * Timeline:
 *
 *   clientSend = t0
 *   serverReceive = t1
 *   clientReceive = t2
 *
 * Estimated RTT:
 *
 *   RTT = t2 - t0
 *
 * Estimated clock offset:
 *
 *   offset = t1 - (t0 + RTT / 2)
 *
 * The synchronized clock returned by now() is:
 *
 *   localBrowserTime + serverOffset
 *
 * All timestamps are milliseconds.
 */

class ClientClockSync {
  constructor(wsSender) {
    this.send = wsSender;

    // ---------------------------------------------------------------
    // Clock state
    // ---------------------------------------------------------------

    this.offsetMs = 0;

    this.rttMs = 0;

    this.isCalibrated = false;

    // Samples:
    //
    // {
    //   rtt: number,
    //   offset: number,
    //   timestamp: number
    // }
    this.samples = [];

    this.maxSamples = 16;

    // ---------------------------------------------------------------
    // Calibration timers
    // ---------------------------------------------------------------

    this.rapidPingTimer = null;

    this.pingInterval = null;

    this.isRunning = false;

    // Number of rapid calibration packets.
    this.initialPingCount = 8;

    // Initial calibration interval.
    this.initialPingIntervalMs = 100;

    // Continuous calibration.
    //
    // One second is fast enough to react to LAN clock changes while
    // avoiding unnecessary WebSocket traffic.
    this.continuousPingIntervalMs = 1000;

    // ---------------------------------------------------------------
    // Offset smoothing
    // ---------------------------------------------------------------

    this.offsetSmoothing = 0.20;

    this.rttSmoothing = 0.20;

    // Maximum correction applied to an already calibrated clock
    // during one pong.
    //
    // This prevents one bad packet from suddenly moving the timeline.
    this.maxOffsetAdjustmentMs = 25;

    // ---------------------------------------------------------------
    // Telemetry
    // ---------------------------------------------------------------

    this.lastSampleTime = 0;

    this.bestSampleRttMs = 0;

    this.sampleCount = 0;
  }

  // ===============================================================
  // LOCAL CLOCK
  // ===============================================================

  /**
   * Return the browser's epoch-compatible high-resolution timestamp.
   *
   * performance.timeOrigin + performance.now()
   *
   * is preferred over Date.now() because performance.now() provides
   * much finer resolution and is monotonic during page lifetime.
   */
  localNow() {
    return (
      performance.timeOrigin +
      performance.now()
    );
  }

  // ===============================================================
  // CALIBRATION
  // ===============================================================

  startCalibration() {
    this.stop();

    this.samples = [];

    this.isRunning = true;

    this.isCalibrated = false;

    this.offsetMs = 0;

    this.rttMs = 0;

    this.sampleCount = 0;

    this.lastSampleTime = 0;

    this.bestSampleRttMs = 0;

    // -------------------------------------------------------------
    // Rapid initial calibration
    // -------------------------------------------------------------

    let pingsSent = 0;

    this.rapidPingTimer = setInterval(() => {
      if (!this.isRunning) {
        return;
      }

      this.sendPing();

      pingsSent++;

      if (pingsSent >= this.initialPingCount) {
        clearInterval(
          this.rapidPingTimer
        );

        this.rapidPingTimer = null;
      }
    }, this.initialPingIntervalMs);

    // Send the first ping immediately instead of waiting 100ms.
    this.sendPing();

    pingsSent = 1;

    // -------------------------------------------------------------
    // Continuous calibration
    // -------------------------------------------------------------

    this.pingInterval = setInterval(() => {
      if (!this.isRunning) {
        return;
      }

      this.sendPing();
    }, this.continuousPingIntervalMs);
  }

  stop() {
    this.isRunning = false;

    if (this.rapidPingTimer) {
      clearInterval(
        this.rapidPingTimer
      );

      this.rapidPingTimer = null;
    }

    if (this.pingInterval) {
      clearInterval(
        this.pingInterval
      );

      this.pingInterval = null;
    }
  }

  // ===============================================================
  // SEND CLOCK PING
  // ===============================================================

  sendPing() {
    if (
      typeof this.send !== "function"
    ) {
      return;
    }

    const clientTime = this.localNow();

    try {
      this.send({
        version: 2,
        type: "clock-ping",
        clientTime
      });

      this.lastSampleTime = clientTime;
    } catch (error) {
      console.warn(
        "[ClockSync] Failed to send clock ping:",
        error
      );
    }
  }

  // ===============================================================
  // HANDLE CLOCK PONG
  // ===============================================================

  handlePong(data) {
    if (!data) {
      return;
    }

    const t0 = Number(
      data.clientTime
    );

    const t1 = Number(
      data.serverTime
    );

    const t2 = this.localNow();

    // -------------------------------------------------------------
    // Validate timestamps
    // -------------------------------------------------------------

    if (
      !Number.isFinite(t0) ||
      !Number.isFinite(t1) ||
      !Number.isFinite(t2)
    ) {
      return;
    }

    // A response received before the request would be invalid.
    if (t2 < t0) {
      return;
    }

    // -------------------------------------------------------------
    // Calculate RTT
    // -------------------------------------------------------------

    const rtt = Math.max(
      0.1,
      t2 - t0
    );

    // Ignore obviously broken network samples.
    //
    // A LAN clock packet taking several seconds is not useful for
    // precision synchronization.
    if (rtt > 5000) {
      return;
    }

    // -------------------------------------------------------------
    // Calculate NTP-style clock offset
    // -------------------------------------------------------------

    const offset =
      t1 -
      (
        t0 +
        (rtt / 2)
      );

    if (!Number.isFinite(offset)) {
      return;
    }

    // -------------------------------------------------------------
    // Store sample
    // -------------------------------------------------------------

    const sample = {
      rtt,
      offset,
      timestamp: t2
    };

    this.samples.push(
      sample
    );

    if (
      this.samples.length >
      this.maxSamples
    ) {
      this.samples.shift();
    }

    this.sampleCount =
      this.samples.length;

    // -------------------------------------------------------------
    // Select low-latency samples
    // -------------------------------------------------------------

    const sortedSamples = [
      ...this.samples
    ].sort(
      (a, b) => a.rtt - b.rtt
    );

    /*
     * Lowest RTT samples are generally the most reliable for NTP-style
     * offset estimation because asymmetric queueing delay is smaller.
     *
     * We use approximately the best 50% but never fewer than 1 and
     * never more than 6 samples.
     */
    const bestCount = Math.max(
      1,
      Math.min(
        6,
        Math.ceil(
          sortedSamples.length * 0.5
        )
      )
    );

    const bestSamples =
      sortedSamples.slice(
        0,
        bestCount
      );

    // -------------------------------------------------------------
    // Weighted average
    // -------------------------------------------------------------

    let totalWeight = 0;

    let weightedOffset = 0;

    let weightedRtt = 0;

    for (
      const sample
      of bestSamples
    ) {
      /*
       * Lower RTT gets higher weight.
       *
       * +1 prevents division by zero.
       */
      const weight =
        1 /
        Math.max(
          1,
          sample.rtt
        );

      totalWeight += weight;

      weightedOffset +=
        sample.offset *
        weight;

      weightedRtt +=
        sample.rtt *
        weight;
    }

    if (totalWeight <= 0) {
      return;
    }

    const estimatedOffset =
      weightedOffset /
      totalWeight;

    const estimatedRtt =
      weightedRtt /
      totalWeight;

    // -------------------------------------------------------------
    // First calibration
    // -------------------------------------------------------------

    if (!this.isCalibrated) {
      this.offsetMs =
        estimatedOffset;

      this.rttMs =
        estimatedRtt;

      this.isCalibrated = true;

      this.bestSampleRttMs =
        bestSamples[0]?.rtt || 0;

      return;
    }

    // -------------------------------------------------------------
    // Continuous clock tracking
    // -------------------------------------------------------------

    /*
     * Smooth RTT telemetry.
     */
    this.rttMs =
      (
        this.rttMs *
        (1 - this.rttSmoothing)
      ) +
      (
        estimatedRtt *
        this.rttSmoothing
      );

    /*
     * Smooth clock offset.
     *
     * Do not instantly jump the receiver clock because one packet
     * can contain asymmetric Wi-Fi queueing delay.
     */
    let offsetDelta =
      estimatedOffset -
      this.offsetMs;

    /*
     * Limit one-step correction.
     *
     * Example:
     *
     * estimated offset = +100ms
     * current offset   = +10ms
     *
     * Instead of instantly jumping +90ms, move gradually.
     */
    offsetDelta = Math.max(
      -this.maxOffsetAdjustmentMs,
      Math.min(
        this.maxOffsetAdjustmentMs,
        offsetDelta
      )
    );

    this.offsetMs +=
      offsetDelta *
      this.offsetSmoothing;

    this.bestSampleRttMs =
      bestSamples[0]?.rtt || 0;
  }

  // ===============================================================
  // SYNCHRONIZED SERVER CLOCK
  // ===============================================================

  /**
   * Return the estimated authoritative server time.
   *
   * Example:
   *
   * browser clock = 12:00:00.100
   * server offset = +35ms
   *
   * now() = 12:00:00.135
   */
  now() {
    return (
      this.localNow() +
      this.offsetMs
    );
  }

  // ===============================================================
  // OFFSET / RTT
  // ===============================================================

  getOffset() {
    return this.offsetMs;
  }

  getRtt() {
    return this.rttMs;
  }

  // ===============================================================
  // TELEMETRY
  // ===============================================================

  getTelemetry() {
    return {
      rttMs: Math.round(
        this.rttMs * 10
      ) / 10,

      offsetMs: Math.round(
        this.offsetMs * 10
      ) / 10,

      bestRttMs: Math.round(
        this.bestSampleRttMs * 10
      ) / 10,

      sampleCount:
        this.sampleCount,

      calibrated:
        this.isCalibrated
    };
  }
}


// =================================================================
// CommonJS / Node compatibility
// =================================================================

if (
  typeof module !== "undefined" &&
  module.exports
) {
  module.exports = {
    ClientClockSync
  };
}