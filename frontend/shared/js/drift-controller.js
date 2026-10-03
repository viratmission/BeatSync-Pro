 /**
 * BeatSync-Pro Authoritative Playback Drift Controller
 *
 * The receiver never creates its own independent playback timeline.
 *
 * The authoritative timeline is:
 *
 *     currentTime
 *     +
 *     (synchronizedServerClock - masterTimestamp)
 *     * playbackRate
 *
 * The receiver continuously compares its local media position against
 * that timeline and corrects small differences with playback-rate
 * adjustments.
 *
 * Large differences are corrected with a controlled hard seek.
 */

class PlaybackSyncController {
  constructor(mediaElement, clockSync) {
    this.media = mediaElement;
    this.clockSync = clockSync;

    this.ensurePitchPreservation();

    // =============================================================
    // AUTHORITATIVE MASTER STATE
    // =============================================================

    this.masterState = {
      sequence: 0,

      videoId: null,
      videoUrl: null,

      // Position at masterTimestamp.
      currentTime: 0,

      playing: false,

      playbackRate: 1.0,

      // Server-authoritative epoch timestamp in milliseconds.
      masterTimestamp: 0,

      duration: 0,

      serverTime: 0
    };

    // =============================================================
    // DRIFT THRESHOLDS
    // =============================================================

    // <= 10ms: considered perfectly aligned.
    this.DRIFT_DEADZONE = 0.010;

    // <= 120ms: fine PI correction.
    this.DRIFT_FINE = 0.120;

    // <= 350ms: stronger rate correction.
    this.DRIFT_MODERATE = 0.350;

    // 350ms - 800ms: aggressive rate correction.
    this.DRIFT_RAPID = 0.800;

    // >= 800ms: controlled hard seek.
    this.DRIFT_SEEK = 0.800;

    // =============================================================
    // RATE LIMITS
    // =============================================================

    this.MIN_RATE_MULTIPLIER = 0.84;
    this.MAX_RATE_MULTIPLIER = 1.16;

    // =============================================================
    // HARDWARE CALIBRATION
    // =============================================================

    let savedOffset = 0;

    try {
      const stored =
        localStorage.getItem(
          "beatsync_calibration_offset"
        );

      if (stored !== null) {
        const parsed = parseFloat(stored);

        if (Number.isFinite(parsed)) {
          savedOffset = parsed;
        }
      }
    } catch (error) {
      console.warn(
        "[SyncController] Unable to read calibration:",
        error
      );
    }

    this.calibrationOffsetMs =
      savedOffset;

    // =============================================================
    // CONTROLLER STATE
    // =============================================================

    this.integralError = 0;

    this.lastDriftMs = 0;

    this.smoothedDriftMs = 0;

    this.isSeekingLocally = false;

    this.seekCooldownUntil = 0;

    this.scheduledPlayTimer = null;

    this.checkInterval = null;

    this.onTelemetryUpdate = null;

    this.lastExpectedTime = 0;

    this.lastEvaluationTime = 0;
  }

  // ===============================================================
  // MEDIA / AUDIO
  // ===============================================================

  ensurePitchPreservation() {
    if (!this.media) {
      return;
    }

    try {
      if (
        "preservesPitch"
        in this.media
      ) {
        this.media.preservesPitch = true;
      }

      if (
        "webkitPreservesPitch"
        in this.media
      ) {
        this.media.webkitPreservesPitch = true;
      }

      if (
        "mozPreservesPitch"
        in this.media
      ) {
        this.media.mozPreservesPitch = true;
      }
    } catch (error) {
      // Unsupported browser property.
    }
  }

  setMediaElement(el) {
    this.media = el;
    this.ensurePitchPreservation();
  }

  // ===============================================================
  // CALIBRATION
  // ===============================================================

  setCalibrationOffset(offsetMs) {
    const value =
      Number(offsetMs);

    this.calibrationOffsetMs =
      Number.isFinite(value)
        ? value
        : 0;

    this.integralError = 0;

    try {
      localStorage.setItem(
        "beatsync_calibration_offset",
        String(this.calibrationOffsetMs)
      );
    } catch (error) {
      console.warn(
        "[SyncController] Unable to save calibration:",
        error
      );
    }

    console.log(
      `[SyncController] Calibration offset set to ${this.calibrationOffsetMs}ms`
    );
  }

  getCalibrationOffset() {
    return this.calibrationOffsetMs;
  }

  autoZeroCalibration() {
    const currentDrift =
      this.lastDriftMs;

    const newOffset = Math.round(
      this.calibrationOffsetMs -
      currentDrift
    );

    this.setCalibrationOffset(
      newOffset
    );

    this.integralError = 0;

    return newOffset;
  }

  // ===============================================================
  // LIFECYCLE
  // ===============================================================

  start() {
    this.stop();

    this.lastEvaluationTime =
      performance.now();

    this.checkInterval =
      setInterval(() => {
        this.evaluateDrift();
      }, 100);
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(
        this.checkInterval
      );

      this.checkInterval = null;
    }

    if (this.scheduledPlayTimer) {
      clearTimeout(
        this.scheduledPlayTimer
      );

      this.scheduledPlayTimer = null;
    }
  }

  // ===============================================================
  // EXPECTED MASTER POSITION
  // ===============================================================

  /**
   * Calculate where the receiver should currently be.
   *
   * Important:
   *
   * calibrationOffsetMs is used only as a physical output-latency
   * compensation. It must NOT modify the server's masterTimestamp.
   *
   * Therefore:
   *
   * master timeline:
   *
   *     currentTime
   *       +
   *     elapsed * playbackRate
   *
   * hardware compensation:
   *
   *     expected + calibrationOffset
   */

  getExpectedMasterTime() {
    const state =
      this.masterState;

    if (!state.playing) {
      return this.clampTime(
        state.currentTime
      );
    }

    if (
      !Number.isFinite(
        state.masterTimestamp
      )
    ) {
      return this.clampTime(
        state.currentTime
      );
    }

    const currentMasterClock =
      this.clockSync.now();

    // -------------------------------------------------------------
    // Scheduled future start
    // -------------------------------------------------------------

    if (
      currentMasterClock <
      state.masterTimestamp
    ) {
      return this.clampTime(
        state.currentTime
      );
    }

    const elapsedSeconds =
      (
        currentMasterClock -
        state.masterTimestamp
      ) / 1000.0;

    let projected =
      state.currentTime +
      (
        elapsedSeconds *
        state.playbackRate
      );

    // -------------------------------------------------------------
    // Hardware output latency compensation
    // -------------------------------------------------------------

    projected +=
      this.calibrationOffsetMs /
      1000.0;

    return this.clampTime(
      projected
    );
  }

  clampTime(value) {
    let result =
      Number(value);

    if (!Number.isFinite(result)) {
      result = 0;
    }

    result = Math.max(
      0,
      result
    );

    if (
      this.masterState.duration > 0
    ) {
      result = Math.min(
        result,
        this.masterState.duration
      );
    }

    return result;
  }

  // ===============================================================
  // PLAYBACK RATE
  // ===============================================================

  applyPlaybackRate(targetRate) {
    if (!this.media) {
      return;
    }

    this.ensurePitchPreservation();

    let rate =
      Number(targetRate);

    if (!Number.isFinite(rate)) {
      rate = 1.0;
    }

    rate = Math.max(
      0.25,
      Math.min(
        4.0,
        rate
      )
    );

    if (
      Math.abs(
        this.media.playbackRate -
        rate
      ) > 0.003
    ) {
      this.media.playbackRate =
        rate;
    }
  }

  // ===============================================================
  // DRIFT EVALUATION
  // ===============================================================

  evaluateDrift() {
    if (
      !this.media ||
      !this.media.src ||
      this.media.readyState < 1
    ) {
      return;
    }

    // =============================================================
    // MASTER PAUSED
    // =============================================================

    if (
      !this.masterState.playing
    ) {
      this.handlePausedMaster();
      return;
    }

    // =============================================================
    // WAIT FOR LOCAL SEEK
    // =============================================================

    if (
      this.isSeekingLocally ||
      Date.now() <
      this.seekCooldownUntil
    ) {
      return;
    }

    // =============================================================
    // LOCAL MEDIA SHOULD BE PLAYING
    // =============================================================

    if (
      this.media.paused &&
      this.media.readyState >= 2
    ) {
      this.executePlay();
    }

    // =============================================================
    // EXPECTED / LOCAL POSITION
    // =============================================================

    const expected =
      this.getExpectedMasterTime();

    const local =
      this.media.currentTime;

    const driftSec =
      local - expected;

    const instantDriftMs =
      Math.round(
        driftSec * 1000
      );

    this.lastExpectedTime =
      expected;

    this.lastDriftMs =
      instantDriftMs;

    // =============================================================
    // SMOOTH TELEMETRY
    // =============================================================

    this.smoothedDriftMs =
      Math.round(
        (
          this.smoothedDriftMs * 0.60
        ) +
        (
          instantDriftMs * 0.40
        )
      );

    const absDrift =
      Math.abs(driftSec);

    const masterRate =
      Number(
        this.masterState.playbackRate
      ) || 1.0;

    let targetRate =
      masterRate;

    // =============================================================
    // PI INTEGRAL
    // =============================================================

    if (
      absDrift <=
      this.DRIFT_MODERATE
    ) {
      this.integralError +=
        driftSec * 0.10;

      this.integralError =
        Math.max(
          -0.08,
          Math.min(
            0.08,
            this.integralError
          )
        );
    } else {
      this.integralError = 0;
    }

    // =============================================================
    // TIER 1: PERFECT
    // =============================================================

    if (
      absDrift <=
      this.DRIFT_DEADZONE
    ) {
      targetRate =
        masterRate;

      this.integralError *=
        0.90;
    }

    // =============================================================
    // TIER 2: FINE PI CORRECTION
    // =============================================================

    else if (
      absDrift <=
      this.DRIFT_FINE
    ) {
      const Kp = 0.85;
      const Ki = 0.25;

      const correction =
        (
          -driftSec * Kp
        ) -
        (
          this.integralError *
          Ki
        );

      const clampedCorrection =
        Math.max(
          -0.075,
          Math.min(
            0.075,
            correction
          )
        );

      targetRate =
        masterRate *
        (
          1.0 +
          clampedCorrection
        );
    }

    // =============================================================
    // TIER 3: MODERATE CORRECTION
    // =============================================================

    else if (
      absDrift <=
      this.DRIFT_MODERATE
    ) {
      const Kp = 0.40;

      const correction =
        Math.max(
          -0.11,
          Math.min(
            0.11,
            -driftSec * Kp
          )
        );

      targetRate =
        masterRate *
        (
          1.0 +
          correction
        );
    }

    // =============================================================
    // TIER 4: RAPID CORRECTION
    // =============================================================

    else if (
      absDrift <
      this.DRIFT_RAPID
    ) {
      if (driftSec < 0) {
        // Receiver is behind.
        targetRate =
          masterRate *
          1.16;
      } else {
        // Receiver is ahead.
        targetRate =
          masterRate *
          0.84;
      }
    }

    // =============================================================
    // TIER 5: HARD RESYNC
    // =============================================================

    else {
      this.executeHardSeek(
        expected
      );

      this.integralError = 0;

      return;
    }

    // -------------------------------------------------------------
    // Clamp target rate.
    // -------------------------------------------------------------

    const minRate =
      masterRate *
      this.MIN_RATE_MULTIPLIER;

    const maxRate =
      masterRate *
      this.MAX_RATE_MULTIPLIER;

    targetRate =
      Math.max(
        minRate,
        Math.min(
          maxRate,
          targetRate
        )
      );

    this.applyPlaybackRate(
      targetRate
    );

    this.emitTelemetry(
      expected
    );
  }

  // ===============================================================
  // PAUSED MASTER
  // ===============================================================

  handlePausedMaster() {
    if (!this.media) {
      return;
    }

    if (!this.media.paused) {
      this.media.pause();
    }

    this.integralError = 0;

    const target =
      this.clampTime(
        this.masterState.currentTime
      );

    const pauseDiff =
      Math.abs(
        this.media.currentTime -
        target
      );

    if (
      pauseDiff > 0.05 &&
      !this.isSeekingLocally &&
      Date.now() >
        this.seekCooldownUntil
    ) {
      try {
        this.media.currentTime =
          target;
      } catch (error) {
        console.warn(
          "[SyncController] Pause alignment failed:",
          error
        );
      }
    }

    this.applyPlaybackRate(
      1.0
    );

    this.lastDriftMs =
      Math.round(
        (
          this.media.currentTime -
          target
        ) * 1000
      );

    this.smoothedDriftMs =
      this.lastDriftMs;

    this.emitTelemetry(
      target,
      false
    );
  }

  // ===============================================================
  // TELEMETRY
  // ===============================================================

  emitTelemetry(
    expectedTime,
    playing = !this.media.paused
  ) {
    if (
      typeof this.onTelemetryUpdate !==
      "function"
    ) {
      return;
    }

    this.onTelemetryUpdate({
      driftMs:
        this.lastDriftMs,

      expectedTime:
        expectedTime,

      localTime:
        this.media.currentTime,

      playbackRate:
        this.media.playbackRate,

      playing:
        playing,

      calibrationOffsetMs:
        this.calibrationOffsetMs
    });
  }

  // ===============================================================
  // HARD SEEK
  // ===============================================================

  executeHardSeek(
    targetPosition
  ) {
    if (
      !this.media ||
      this.isSeekingLocally
    ) {
      return;
    }

    const target =
      this.clampTime(
        targetPosition
      );

    this.isSeekingLocally =
      true;

    this.seekCooldownUntil =
      Date.now() + 800;

    const onSeeked = () => {
      this.media.removeEventListener(
        "seeked",
        onSeeked
      );

      this.isSeekingLocally =
        false;

      this.applyPlaybackRate(
        this.masterState.playbackRate
      );

      this.lastDriftMs = 0;

      this.integralError = 0;
    };

    this.media.addEventListener(
      "seeked",
      onSeeked,
      {
        once: true
      }
    );

    try {
      this.media.currentTime =
        target;
    } catch (error) {
      this.isSeekingLocally =
        false;

      console.warn(
        "[SyncController] Hard seek failed:",
        error
      );
    }

    setTimeout(() => {
      if (
        this.isSeekingLocally
      ) {
        this.isSeekingLocally =
          false;

        this.applyPlaybackRate(
          this.masterState.playbackRate
        );
      }
    }, 1200);
  }

  // ===============================================================
  // SEQUENCE VALIDATION
  // ===============================================================

  isStaleSequence(sequence) {
    if (
      sequence === undefined ||
      sequence === null
    ) {
      return false;
    }

    const incoming =
      Number(sequence);

    if (!Number.isFinite(incoming)) {
      return false;
    }

    return (
      incoming <
      this.masterState.sequence
    );
  }

  updateSequence(sequence) {
    if (
      sequence === undefined ||
      sequence === null
    ) {
      return;
    }

    const value =
      Number(sequence);

    if (
      Number.isFinite(value)
    ) {
      this.masterState.sequence =
        value;
    }
  }

  // ===============================================================
  // GENERIC SYNC MESSAGE
  // ===============================================================

  onSyncMessage(msg) {
    if (!msg) {
      return;
    }

    if (
      this.isStaleSequence(
        msg.sequence
      )
    ) {
      return;
    }

    this.updateSequence(
      msg.sequence
    );

    // -------------------------------------------------------------
    // Anchor position
    // -------------------------------------------------------------

    if (
      msg.currentTime !== undefined
    ) {
      const currentTime =
        Number(
          msg.currentTime
        );

      if (
        Number.isFinite(
          currentTime
        )
      ) {
        this.masterState.currentTime =
          this.clampIncomingTime(
            currentTime
          );
      }
    }

    // -------------------------------------------------------------
    // Playing state
    // -------------------------------------------------------------

    if (
      msg.playing !== undefined
    ) {
      this.masterState.playing =
        Boolean(
          msg.playing
        );
    }

    // -------------------------------------------------------------
    // Playback rate
    // -------------------------------------------------------------

    if (
      msg.playbackRate !== undefined
    ) {
      const rate =
        Number(
          msg.playbackRate
        );

      if (
        Number.isFinite(rate) &&
        rate > 0
      ) {
        this.masterState.playbackRate =
          rate;
      }
    }

    // -------------------------------------------------------------
    // IMPORTANT:
    //
    // Always use server-provided masterTimestamp.
    //
    // Never replace it with clockSync.now() if a valid timestamp
    // exists.
    // -------------------------------------------------------------

    if (
      msg.masterTimestamp !== undefined
    ) {
      const timestamp =
        Number(
          msg.masterTimestamp
        );

      if (
        Number.isFinite(timestamp) &&
        timestamp > 0
      ) {
        this.masterState.masterTimestamp =
          timestamp;
      }
    }
    else if (
      msg.serverTime !== undefined
    ) {
      const serverTime =
        Number(
          msg.serverTime
        );

      if (
        Number.isFinite(serverTime) &&
        serverTime > 0
      ) {
        this.masterState.masterTimestamp =
          serverTime;
      }
    }

    // -------------------------------------------------------------
    // Server time telemetry
    // -------------------------------------------------------------

    if (
      msg.serverTime !== undefined
    ) {
      const serverTime =
        Number(
          msg.serverTime
        );

      if (
        Number.isFinite(serverTime)
      ) {
        this.masterState.serverTime =
          serverTime;
      }
    }

    // -------------------------------------------------------------
    // Duration
    // -------------------------------------------------------------

    if (
      msg.duration !== undefined
    ) {
      const duration =
        Number(
          msg.duration
        );

      if (
        Number.isFinite(duration) &&
        duration >= 0
      ) {
        this.masterState.duration =
          duration;
      }
    }

    // -------------------------------------------------------------
    // Video metadata
    // -------------------------------------------------------------

    if (
      msg.videoId !== undefined
    ) {
      this.masterState.videoId =
        msg.videoId;
    }

    if (
      msg.videoUrl !== undefined
    ) {
      this.masterState.videoUrl =
        msg.videoUrl;
    }

    // -------------------------------------------------------------
    // Immediate paused alignment
    // -------------------------------------------------------------

    if (
      !this.masterState.playing
    ) {
      this.handlePausedMaster();
    }
  }

  // ===============================================================
  // PLAY COMMAND
  // ===============================================================

  onPlayCommand(msg) {
    if (!msg) {
      return;
    }

    if (
      this.isStaleSequence(
        msg.sequence
      )
    ) {
      return;
    }

    this.updateSequence(
      msg.sequence
    );

    // -------------------------------------------------------------
    // Position
    // -------------------------------------------------------------

    if (
      msg.position !== undefined
    ) {
      const position =
        Number(
          msg.position
        );

      if (
        Number.isFinite(position)
      ) {
        this.masterState.currentTime =
          this.clampIncomingTime(
            position
          );
      }
    }
    else if (
      msg.currentTime !== undefined
    ) {
      const position =
        Number(
          msg.currentTime
        );

      if (
        Number.isFinite(position)
      ) {
        this.masterState.currentTime =
          this.clampIncomingTime(
            position
          );
      }
    }

    // -------------------------------------------------------------
    // Playback rate
    // -------------------------------------------------------------

    if (
      msg.playbackRate !== undefined
    ) {
      const rate =
        Number(
          msg.playbackRate
        );

      if (
        Number.isFinite(rate) &&
        rate > 0
      ) {
        this.masterState.playbackRate =
          rate;
      }
    }

    // -------------------------------------------------------------
    // Authoritative start timestamp
    // -------------------------------------------------------------

    const startTimestamp =
      msg.startAt !== undefined
        ? Number(msg.startAt)
        : Number(msg.masterTimestamp);

    if (
      Number.isFinite(
        startTimestamp
      ) &&
      startTimestamp > 0
    ) {
      this.masterState.masterTimestamp =
        startTimestamp;
    }

    this.masterState.playing =
      true;

    this.integralError = 0;

    // -------------------------------------------------------------
    // Cancel old scheduled start
    // -------------------------------------------------------------

    if (
      this.scheduledPlayTimer
    ) {
      clearTimeout(
        this.scheduledPlayTimer
      );

      this.scheduledPlayTimer =
        null;
    }

    // -------------------------------------------------------------
    // Pre-position receiver
    // -------------------------------------------------------------

    const startPosition =
      this.masterState.currentTime;

    if (
      Number.isFinite(
        startPosition
      ) &&
      Math.abs(
        this.media.currentTime -
        startPosition
      ) > 0.10
    ) {
      try {
        this.media.currentTime =
          startPosition;
      } catch (error) {
        console.warn(
          "[SyncController] Unable to pre-position media:",
          error
        );
      }
    }

    // -------------------------------------------------------------
    // Calculate delay using synchronized server clock
    // -------------------------------------------------------------

    const currentClock =
      this.clockSync.now();

    const delayMs =
      this.masterState.masterTimestamp -
      currentClock;

    if (
      delayMs > 5
    ) {
      this.scheduledPlayTimer =
        setTimeout(() => {
          this.scheduledPlayTimer =
            null;

          this.executePlay();
        }, delayMs);
    }
    else {
      this.executePlay();
    }
  }

  // ===============================================================
  // EXECUTE PLAY
  // ===============================================================

  executePlay() {
    if (!this.media) {
      return;
    }

    const expected =
      this.getExpectedMasterTime();

    // Only perform an immediate alignment when the error is large.
    if (
      Math.abs(
        this.media.currentTime -
        expected
      ) > 0.25
    ) {
      try {
        this.media.currentTime =
          expected;
      } catch (error) {
        console.warn(
          "[SyncController] Play alignment failed:",
          error
        );
      }
    }

    this.applyPlaybackRate(
      this.masterState.playbackRate
    );

    const playPromise =
      this.media.play();

    if (
      playPromise !== undefined
    ) {
      playPromise.catch(
        (error) => {
          console.warn(
            "[SyncController] Playback waiting for user unlock:",
            error
          );
        }
      );
    }
  }

  // ===============================================================
  // PAUSE COMMAND
  // ===============================================================

  onPauseCommand(msg) {
    if (!msg) {
      return;
    }

    if (
      this.isStaleSequence(
        msg.sequence
      )
    ) {
      return;
    }

    this.updateSequence(
      msg.sequence
    );

    if (
      this.scheduledPlayTimer
    ) {
      clearTimeout(
        this.scheduledPlayTimer
      );

      this.scheduledPlayTimer =
        null;
    }

    // -------------------------------------------------------------
    // Position
    // -------------------------------------------------------------

    const position =
      msg.position !== undefined
        ? Number(msg.position)
        : Number(msg.currentTime);

    if (
      Number.isFinite(position)
    ) {
      this.masterState.currentTime =
        this.clampIncomingTime(
          position
        );
    }

    // -------------------------------------------------------------
    // Authoritative timestamp
    // -------------------------------------------------------------

    if (
      msg.masterTimestamp !== undefined
    ) {
      const timestamp =
        Number(
          msg.masterTimestamp
        );

      if (
        Number.isFinite(timestamp) &&
        timestamp > 0
      ) {
        this.masterState.masterTimestamp =
          timestamp;
      }
    }

    this.masterState.playing =
      false;

    this.integralError = 0;

    // -------------------------------------------------------------
    // Immediate pause
    // -------------------------------------------------------------

    try {
      this.media.pause();

      this.media.currentTime =
        this.masterState.currentTime;
    } catch (error) {
      console.warn(
        "[SyncController] Pause alignment failed:",
        error
      );
    }

    this.applyPlaybackRate(
      1.0
    );

    this.lastDriftMs = 0;

    this.emitTelemetry(
      this.masterState.currentTime,
      false
    );
  }

  // ===============================================================
  // SEEK COMMAND
  // ===============================================================

  onSeekCommand(msg) {
    if (!msg) {
      return;
    }

    if (
      this.isStaleSequence(
        msg.sequence
      )
    ) {
      return;
    }

    this.updateSequence(
      msg.sequence
    );

    // -------------------------------------------------------------
    // New authoritative position
    // -------------------------------------------------------------

    const position =
      msg.position !== undefined
        ? Number(msg.position)
        : Number(msg.currentTime);

    if (
      !Number.isFinite(position)
    ) {
      return;
    }

    this.masterState.currentTime =
      this.clampIncomingTime(
        position
      );

    // -------------------------------------------------------------
    // Preserve playing state when provided
    // -------------------------------------------------------------

    if (
      msg.playing !== undefined
    ) {
      this.masterState.playing =
        Boolean(
          msg.playing
        );
    }

    // -------------------------------------------------------------
    // Playback rate
    // -------------------------------------------------------------

    if (
      msg.playbackRate !== undefined
    ) {
      const rate =
        Number(
          msg.playbackRate
        );

      if (
        Number.isFinite(rate) &&
        rate > 0
      ) {
        this.masterState.playbackRate =
          rate;
      }
    }

    // -------------------------------------------------------------
    // CRITICAL:
    //
    // Use the server's masterTimestamp.
    //
    // Do NOT use:
    //
    //     this.clockSync.now()
    //
    // when server already supplied an authoritative timestamp.
    // -------------------------------------------------------------

    if (
      msg.masterTimestamp !== undefined
    ) {
      const timestamp =
        Number(
          msg.masterTimestamp
        );

      if (
        Number.isFinite(timestamp) &&
        timestamp > 0
      ) {
        this.masterState.masterTimestamp =
          timestamp;
      }
    }
    else if (
      msg.serverTime !== undefined
    ) {
      const serverTime =
        Number(
          msg.serverTime
        );

      if (
        Number.isFinite(serverTime) &&
        serverTime > 0
      ) {
        this.masterState.masterTimestamp =
          serverTime;
      }
    }
    else {
      // Legacy fallback only.
      this.masterState.masterTimestamp =
        this.clockSync.now();
    }

    this.integralError = 0;

    // -------------------------------------------------------------
    // Immediate hard alignment
    // -------------------------------------------------------------

    this.executeHardSeek(
      this.getExpectedMasterTime()
    );
  }

  // ===============================================================
  // FORCE RESYNC
  // ===============================================================

  resyncNow() {
    const expected =
      this.getExpectedMasterTime();

    this.executeHardSeek(
      expected
    );

    this.lastDriftMs = 0;

    this.integralError = 0;

    if (
      this.masterState.playing &&
      this.media.paused
    ) {
      this.media
        .play()
        .catch(() => {});
    }
  }

  // ===============================================================
  // SAFE INCOMING POSITION
  // ===============================================================

  clampIncomingTime(
    value
  ) {
    let position =
      Number(value);

    if (
      !Number.isFinite(position)
    ) {
      position = 0;
    }

    position =
      Math.max(
        0,
        position
      );

    if (
      this.masterState.duration > 0
    ) {
      position =
        Math.min(
          position,
          this.masterState.duration
        );
    }

    return position;
  }
}


// =================================================================
// CommonJS compatibility
// =================================================================

if (
  typeof module !== "undefined" &&
  module.exports
) {
  module.exports = {
    PlaybackSyncController
  };
}