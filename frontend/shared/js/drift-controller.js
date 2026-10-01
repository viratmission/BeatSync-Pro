/**
 * BeatSync-Pro High-Precision Audio & Timeline Drift Controller
 * Continuous Proportional-Integral (PI) Speed Control & Hardware Offset Calibration
 * Eliminates seek thrashing and provides seamless, zero-dropout sub-15ms audio synchronization.
 */

class PlaybackSyncController {
  constructor(mediaElement, clockSync) {
    this.media = mediaElement;
    this.clockSync = clockSync;

    // Enable pitch preservation for seamless micro-rate speed corrections
    this.ensurePitchPreservation();

    // Master timeline reference
    this.masterState = {
      sequence: 0,
      videoId: null,
      videoUrl: null,
      currentTime: 0,
      playing: false,
      playbackRate: 1.0,
      masterTimestamp: 0,
      duration: 0
    };

    // Tuned Audio Drift Thresholds (in seconds)
    // Ultra-tight 10ms deadband for zero-echo cinema synchronization
    this.DRIFT_DEADZONE = 0.010;   // 10ms: inaudible echo boundary, rate = 1.00x
    this.DRIFT_FINE = 0.120;       // 120ms: continuous PI speed regulation (0.93x - 1.07x)
    this.DRIFT_MODERATE = 0.350;   // 350ms: moderate continuous catch-up (0.89x - 1.11x)
    this.DRIFT_RAPID = 0.800;      // 800ms: rapid catch-up (0.84x - 1.16x)
    this.DRIFT_SEEK = 0.800;       // >= 800ms: hard seek (scrub/large jump only)

    // Hardware Latency Calibration Offset (in ms)
    // Positive offset advances receiver playback to cancel Android/iOS speaker and Bluetooth buffers
    const savedOffset = localStorage.getItem('beatsync_calibration_offset');
    this.calibrationOffsetMs = savedOffset !== null ? parseFloat(savedOffset) : 0;

    // PI Controller State
    this.integralError = 0;        // Integral accumulator to eliminate steady-state offset
    this.lastDriftMs = 0;
    this.smoothedDriftMs = 0;      // Low-pass filtered drift for stable telemetry
    this.isSeekingLocally = false;
    this.seekCooldownUntil = 0;
    this.scheduledPlayTimer = null;
    this.checkInterval = null;
    this.onTelemetryUpdate = null;
  }

  ensurePitchPreservation() {
    if (!this.media) return;
    try {
      if ('preservesPitch' in this.media) {
        this.media.preservesPitch = true;
      }
      if ('webkitPreservesPitch' in this.media) {
        this.media.webkitPreservesPitch = true;
      }
      if ('mozPreservesPitch' in this.media) {
        this.media.mozPreservesPitch = true;
      }
    } catch (e) {
      // Ignore unsupported browsers
    }
  }

  setMediaElement(el) {
    this.media = el;
    this.ensurePitchPreservation();
  }

  setCalibrationOffset(offsetMs) {
    this.calibrationOffsetMs = Number(offsetMs) || 0;
    this.integralError = 0; // Reset integrator on manual calibration
    localStorage.setItem('beatsync_calibration_offset', this.calibrationOffsetMs.toString());
    console.log(`[SyncController] Calibration offset set to ${this.calibrationOffsetMs}ms`);
  }

  getCalibrationOffset() {
    return this.calibrationOffsetMs;
  }

  /**
   * Automatically calculates and applies the exact offset needed to snap
   * the current steady-state drift directly to 0ms (Zero-Echo Sync).
   */
  autoZeroCalibration() {
    // Current drift indicates how far ahead (+) or behind (-) local playback is.
    // To make drift 0: newOffset = currentOffset - currentDrift
    const currentDrift = this.lastDriftMs;
    const newOffset = Math.round(this.calibrationOffsetMs - currentDrift);
    this.setCalibrationOffset(newOffset);
    this.integralError = 0;
    return newOffset;
  }

  start() {
    if (this.checkInterval) clearInterval(this.checkInterval);
    // Drift check loop running every 100ms for rapid, responsive continuous speed regulation
    this.checkInterval = setInterval(() => {
      this.evaluateDrift();
    }, 100);
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.scheduledPlayTimer) {
      clearTimeout(this.scheduledPlayTimer);
      this.scheduledPlayTimer = null;
    }
  }

  /**
   * Computes expected master playback time in seconds, factoring in:
   * 1. Authoritative NTP master clock elapsed time
   * 2. Master playback speed rate
   * 3. Hardware speaker output delay calibration offset
   */
  getExpectedMasterTime() {
    if (!this.masterState.playing) {
      return this.masterState.currentTime;
    }

    const currentMasterClock = this.clockSync.now();
    // If masterTimestamp is scheduled in future (startAt), wait at start position
    if (currentMasterClock < this.masterState.masterTimestamp) {
      return this.masterState.currentTime;
    }

    const elapsedSeconds = (currentMasterClock - this.masterState.masterTimestamp) / 1000.0;
    // Add calibration offset (converted to seconds) so the audio is emitted at the physical speaker in sync
    const effectiveElapsed = elapsedSeconds + (this.calibrationOffsetMs / 1000.0);
    const projected = this.masterState.currentTime + (effectiveElapsed * this.masterState.playbackRate);

    if (this.masterState.duration > 0 && projected > this.masterState.duration) {
      return this.masterState.duration;
    }
    return Math.max(0, projected);
  }

  /**
   * Safe playback rate setter ensuring preservesPitch is never dropped by the browser.
   */
  applyPlaybackRate(targetRate) {
    if (!this.media) return;
    this.ensurePitchPreservation();
    if (Math.abs(this.media.playbackRate - targetRate) > 0.003) {
      this.media.playbackRate = targetRate;
    }
  }

  /**
   * Evaluates drift and applies continuous proportional-integral (PI) speed adjustment.
   */
  evaluateDrift() {
    if (!this.media || !this.media.src || this.media.readyState < 1) {
      return;
    }

    // 1. If master is paused:
    if (!this.masterState.playing) {
      if (!this.media.paused) {
        this.media.pause();
      }
      this.integralError = 0;
      // Keep aligned to master pause position
      const pauseDiff = Math.abs(this.media.currentTime - this.masterState.currentTime);
      if (pauseDiff > 0.05 && !this.isSeekingLocally && Date.now() > this.seekCooldownUntil) {
        this.media.currentTime = this.masterState.currentTime;
      }
      this.applyPlaybackRate(1.0);
      this.lastDriftMs = Math.round((this.media.currentTime - this.masterState.currentTime) * 1000);
      this.smoothedDriftMs = this.lastDriftMs;

      if (typeof this.onTelemetryUpdate === 'function') {
        this.onTelemetryUpdate({
          driftMs: this.lastDriftMs,
          expectedTime: this.masterState.currentTime,
          localTime: this.media.currentTime,
          playbackRate: 1.0,
          playing: false,
          calibrationOffsetMs: this.calibrationOffsetMs
        });
      }
      return;
    }

    // 2. If master is playing:
    // If currently performing an asynchronous seek or in cooldown, wait for media engine to settle
    if (this.isSeekingLocally || Date.now() < this.seekCooldownUntil) {
      return;
    }

    // If master is playing but local media is paused (and ready), attempt play
    if (this.media.paused && this.media.readyState >= 2) {
      this.executePlay();
    }

    const expected = this.getExpectedMasterTime();
    const local = this.media.currentTime;
    const driftSec = local - expected;
    const instantDriftMs = Math.round(driftSec * 1000);
    this.lastDriftMs = instantDriftMs;

    // Smooth drift with a fast exponential moving average (alpha = 0.4) for telemetry stability
    this.smoothedDriftMs = Math.round((this.smoothedDriftMs * 0.6) + (instantDriftMs * 0.4));

    const absDrift = Math.abs(driftSec);
    const masterRate = this.masterState.playbackRate || 1.0;
    let targetRate = masterRate;

    // Accumulate integral error in close/moderate tracking zones to eliminate steady-state offsets
    if (absDrift <= this.DRIFT_MODERATE) {
      this.integralError += (driftSec * 0.10); // dt = 100ms = 0.10s
      // Anti-windup clamping to prevent overshoot
      this.integralError = Math.max(-0.08, Math.min(0.08, this.integralError));
    } else {
      this.integralError = 0;
    }

    // Tier 1: Perfect Alignment (<= 10ms) - Inaudible echo threshold
    if (absDrift <= this.DRIFT_DEADZONE) {
      targetRate = masterRate;
      this.integralError *= 0.90; // Gently decay integral error in deadzone
    }
    // Tier 2: Continuous Proportional-Integral (PI) Fine Tracking (10ms - 120ms)
    // Continuously scales rate with drift error:
    // At -60ms: rate = 1.0 + (0.060 * 0.85) = ~1.051x (+5.1%)
    // Closes 60ms gap in ~1.1 seconds smoothly with ZERO dropouts, then gently returns to 1.000x!
    else if (absDrift <= this.DRIFT_FINE) {
      const Kp = 0.85; // Proportional gain
      const Ki = 0.25; // Integral gain
      const correction = (-driftSec * Kp) - (this.integralError * Ki);
      const clampedCorrection = Math.max(-0.075, Math.min(0.075, correction));
      targetRate = masterRate * (1.0 + clampedCorrection);
    }
    // Tier 3: Moderate Catch-Up (120ms - 350ms)
    // Smooth continuous catch-up (+10% / -10%) WITHOUT SEEKING!
    else if (absDrift <= this.DRIFT_MODERATE) {
      const Kp = 0.40;
      const correction = Math.max(-0.11, Math.min(0.11, -driftSec * Kp));
      targetRate = masterRate * (1.0 + correction);
    }
    // Tier 4: High Desync (350ms - 800ms)
    // Rapid continuous catch-up (+16% / -16%)
    else if (absDrift < this.DRIFT_SEEK) {
      if (driftSec < 0) {
        targetRate = masterRate * 1.16;
      } else {
        targetRate = masterRate * 0.84;
      }
    }
    // Tier 5: Major jump or scrub (>= 800ms) -> Hard Seek
    // Only used for scrubbing or chapter skips! Uses one-time seeked listener with cooldown.
    else {
      this.executeHardSeek(expected);
      this.integralError = 0;
    }

    this.applyPlaybackRate(targetRate);

    // Telemetry callback
    if (typeof this.onTelemetryUpdate === 'function') {
      this.onTelemetryUpdate({
        driftMs: this.lastDriftMs,
        expectedTime: expected,
        localTime: local,
        playbackRate: this.media.playbackRate,
        playing: !this.media.paused,
        calibrationOffsetMs: this.calibrationOffsetMs
      });
    }
  }

  /**
   * Executes a hard seek safely with cooldown and seeked event listening
   * to prevent mobile browsers from entering seek-buffering loops.
   */
  executeHardSeek(targetPosition) {
    if (this.isSeekingLocally) return;

    this.isSeekingLocally = true;
    this.seekCooldownUntil = Date.now() + 800; // 800ms grace period after seek

    const onSeeked = () => {
      this.media.removeEventListener('seeked', onSeeked);
      this.isSeekingLocally = false;
      this.applyPlaybackRate(this.masterState.playbackRate);
    };

    this.media.addEventListener('seeked', onSeeked, { once: true });
    this.media.currentTime = targetPosition;

    // Safety timeout in case seeked event doesn't fire
    setTimeout(() => {
      if (this.isSeekingLocally) {
        this.isSeekingLocally = false;
        this.applyPlaybackRate(this.masterState.playbackRate);
      }
    }, 1200);
  }

  /**
   * Handle incoming master sync state.
   */
  onSyncMessage(msg) {
    if (msg.sequence && msg.sequence < this.masterState.sequence) {
      return;
    }

    this.masterState.sequence = msg.sequence || this.masterState.sequence;
    this.masterState.currentTime = msg.currentTime !== undefined ? msg.currentTime : this.masterState.currentTime;
    this.masterState.playing = msg.playing !== undefined ? msg.playing : this.masterState.playing;
    this.masterState.playbackRate = msg.playbackRate || 1.0;
    this.masterState.masterTimestamp = msg.masterTimestamp || msg.serverTime || this.clockSync.now();
    if (msg.duration) this.masterState.duration = msg.duration;
    if (msg.videoId) this.masterState.videoId = msg.videoId;
    if (msg.videoUrl) this.masterState.videoUrl = msg.videoUrl;

    // Apply immediate pause alignment
    if (!this.masterState.playing) {
      if (!this.media.paused) this.media.pause();
      if (Math.abs(this.media.currentTime - this.masterState.currentTime) > 0.05 && Date.now() > this.seekCooldownUntil) {
        this.media.currentTime = this.masterState.currentTime;
      }
      this.lastDriftMs = 0;
      this.integralError = 0;
    }
  }

  /**
   * Handle scheduled play command with generous scheduling window.
   */
  onPlayCommand(msg) {
    if (msg.sequence && msg.sequence < this.masterState.sequence) return;
    this.masterState.sequence = msg.sequence || this.masterState.sequence + 1;
    this.masterState.playing = true;
    this.masterState.currentTime = msg.position !== undefined ? msg.position : this.masterState.currentTime;
    this.masterState.playbackRate = msg.playbackRate || 1.0;
    this.masterState.masterTimestamp = msg.startAt || this.clockSync.now();
    this.integralError = 0;

    if (this.scheduledPlayTimer) {
      clearTimeout(this.scheduledPlayTimer);
      this.scheduledPlayTimer = null;
    }

    // Pre-seek audio to start position if not already aligned
    if (msg.position !== undefined && Math.abs(this.media.currentTime - msg.position) > 0.1) {
      this.media.currentTime = msg.position;
    }

    const currentClock = this.clockSync.now();
    const delayMs = (msg.startAt || currentClock) - currentClock;

    if (delayMs > 5) {
      this.scheduledPlayTimer = setTimeout(() => {
        this.executePlay();
      }, delayMs);
    } else {
      this.executePlay();
    }
  }

  executePlay() {
    const expected = this.getExpectedMasterTime();
    // Only pre-align if offset is large (> 250ms) to avoid seek stutters on play
    if (Math.abs(this.media.currentTime - expected) > 0.25) {
      this.media.currentTime = expected;
    }
    this.applyPlaybackRate(this.masterState.playbackRate);
    const playPromise = this.media.play();
    if (playPromise !== undefined) {
      playPromise.catch(err => {
        console.warn("[SyncController] Autoplay waiting for unlock:", err);
      });
    }
  }

  /**
   * Handle pause command.
   */
  onPauseCommand(msg) {
    if (this.scheduledPlayTimer) {
      clearTimeout(this.scheduledPlayTimer);
      this.scheduledPlayTimer = null;
    }

    this.masterState.playing = false;
    this.integralError = 0;
    if (msg.position !== undefined) {
      this.masterState.currentTime = msg.position;
      this.media.currentTime = msg.position;
    }
    this.media.pause();
    this.applyPlaybackRate(1.0);
    this.lastDriftMs = 0;

    if (typeof this.onTelemetryUpdate === 'function') {
      this.onTelemetryUpdate({
        driftMs: 0,
        expectedTime: this.masterState.currentTime,
        localTime: this.media.currentTime,
        playbackRate: 1.0,
        playing: false,
        calibrationOffsetMs: this.calibrationOffsetMs
      });
    }
  }

  /**
   * Handle seek command.
   */
  onSeekCommand(msg) {
    if (msg.position !== undefined) {
      this.masterState.currentTime = msg.position;
      this.masterState.masterTimestamp = this.clockSync.now();
      this.executeHardSeek(msg.position);
      this.lastDriftMs = 0;
      this.integralError = 0;
    }
  }

  /**
   * Force manual resynchronization.
   */
  resyncNow() {
    const expected = this.getExpectedMasterTime();
    this.executeHardSeek(expected);
    this.lastDriftMs = 0;
    this.integralError = 0;
    if (this.masterState.playing && this.media.paused) {
      this.media.play().catch(() => {});
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PlaybackSyncController };
}
