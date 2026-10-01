/**
 * BeatSync-Pro Mobile Receiver / Wireless Cinema Speaker Controller
 * Guaranteed Mobile Audio Playback & Ultra-Low-Latency Synchronization
 */

(function () {
  'use strict';

  // DOM Elements
  const receiverVideo = document.getElementById('receiverVideo');
  const videoPreviewWrapper = document.getElementById('videoPreviewWrapper');
  const speakerDisc = document.getElementById('speakerDisc');
  const speakerStatusText = document.getElementById('speakerStatusText');
  const visualizerCanvas = document.getElementById('visualizerCanvas');
  const canvasCtx = visualizerCanvas ? visualizerCanvas.getContext('2d') : null;

  const unlockAudioOverlay = document.getElementById('unlockAudioOverlay');
  const unlockBtn = document.getElementById('unlockBtn');
  const phoneMovieTitle = document.getElementById('phoneMovieTitle');
  const phoneDriftPill = document.getElementById('phoneDriftPill');
  const connStatusBadge = document.getElementById('connStatusBadge');

  const floatingStatus = document.getElementById('floatingStatus');
  const floatingBadge = document.getElementById('floatingBadge');
  const floatingMessage = document.getElementById('floatingMessage');

  const resyncBtn = document.getElementById('resyncBtn');
  const toggleVideoBtn = document.getElementById('toggleVideoBtn');
  const toggleHudBtn = document.getElementById('toggleHudBtn');
  const closeHudBtn = document.getElementById('closeHudBtn');
  const diagnosticHud = document.getElementById('diagnosticHud');
  const deviceNameInput = document.getElementById('deviceNameInput');

  const hudDrift = document.getElementById('hudDrift');
  const hudRtt = document.getElementById('hudRtt');
  const hudOffset = document.getElementById('hudOffset');
  const hudRate = document.getElementById('hudRate');
  const hudCalib = document.getElementById('hudCalib');
  const hudPhonePos = document.getElementById('hudPhonePos');

  // Calibrator DOM Elements
  const autoZeroBtn = document.getElementById('autoZeroBtn');
  const calibratorSlider = document.getElementById('calibratorSlider');
  const calibratorValueDisplay = document.getElementById('calibratorValueDisplay');
  const nudgeDownBtn = document.getElementById('nudgeDownBtn');
  const nudgeUpBtn = document.getElementById('nudgeUpBtn');
  const presetChips = document.querySelectorAll('.preset-chip');

  const receiverMuteBtn = document.getElementById('receiverMuteBtn');
  const receiverVolumeSlider = document.getElementById('receiverVolumeSlider');
  const volumePercentText = document.getElementById('volumePercentText');

  // State & Identity
  const roomToken = new URLSearchParams(window.location.search).get('token') || '';
  let clientId = localStorage.getItem('beatsync_client_id');
  if (!clientId) {
    clientId = 'phone-' + Math.random().toString(36).substring(2, 8);
    localStorage.setItem('beatsync_client_id', clientId);
  }

  let deviceName = localStorage.getItem('beatsync_device_name') || `Phone (${clientId.slice(-4)})`;
  deviceNameInput.value = deviceName;

  let ws = null;
  let clockSync = null;
  let syncController = null;
  let wakeLock = null;
  let isAudioUnlocked = false;
  let showVideoPreview = false;
  let telemetryInterval = null;
  let statusToastTimeout = null;
  let visualizerAnimFrame = null;

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "00:00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  function showStatusToast(badgeText, message, isWarning = false) {
    floatingBadge.textContent = badgeText;
    floatingBadge.className = isWarning ? 'badge badge-warning' : 'badge badge-offline';
    floatingMessage.textContent = message;
    floatingStatus.style.display = 'flex';
    floatingStatus.style.opacity = '1';

    if (statusToastTimeout) clearTimeout(statusToastTimeout);
    statusToastTimeout = setTimeout(() => {
      floatingStatus.style.opacity = '0';
      setTimeout(() => floatingStatus.style.display = 'none', 300);
    }, 2500);
  }

  // Request Screen Wake Lock so phone doesn't sleep while acting as wireless speaker
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('[WakeLock] Screen lock acquired');
      }
    } catch (err) {
      console.warn('[WakeLock] Screen wake lock not supported:', err);
    }
  }

  // Visualizer Animation
  function drawVisualizer() {
    if (!canvasCtx) return;
    const width = visualizerCanvas.width;
    const height = visualizerCanvas.height;
    canvasCtx.clearRect(0, 0, width, height);

    const isPlaying = !receiverVideo.paused && receiverVideo.currentTime > 0;
    const numBars = 32;
    const barWidth = width / numBars - 2;

    for (let i = 0; i < numBars; i++) {
      let barHeight = 4;
      if (isPlaying) {
        const timeFactor = Date.now() / 180;
        const wave = Math.sin(i * 0.4 + timeFactor) * Math.cos(i * 0.2 + timeFactor * 0.5);
        barHeight = Math.max(6, Math.abs(wave) * (height - 8));
      }

      const x = i * (barWidth + 2);
      const y = height - barHeight;

      const gradient = canvasCtx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, '#4f46e5');
      gradient.addColorStop(1, '#06b6d4');

      canvasCtx.fillStyle = isPlaying ? gradient : 'rgba(255, 255, 255, 0.1)';
      canvasCtx.fillRect(x, y, barWidth, barHeight);
    }

    visualizerAnimFrame = requestAnimationFrame(drawVisualizer);
  }

  // Initialize Clock & Drift Controller
  clockSync = new ClientClockSync((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  });

  syncController = new PlaybackSyncController(receiverVideo, clockSync);
  syncController.onTelemetryUpdate = (telemetry) => {
    const drift = telemetry.driftMs;
    const sign = drift >= 0 ? '+' : '';
    phoneDriftPill.textContent = `Sync: ${sign}${drift}ms`;

    const absDrift = Math.abs(drift);
    if (absDrift <= 20) {
      phoneDriftPill.style.color = 'var(--accent-emerald)';
      phoneDriftPill.style.borderColor = 'rgba(16, 185, 129, 0.35)';
      phoneDriftPill.style.background = 'rgba(16, 185, 129, 0.15)';
    } else if (absDrift <= 80) {
      phoneDriftPill.style.color = 'var(--accent-cyan)';
      phoneDriftPill.style.borderColor = 'rgba(6, 182, 212, 0.35)';
      phoneDriftPill.style.background = 'rgba(6, 182, 212, 0.15)';
    } else {
      phoneDriftPill.style.color = 'var(--accent-amber)';
      phoneDriftPill.style.borderColor = 'rgba(245, 158, 11, 0.35)';
      phoneDriftPill.style.background = 'rgba(245, 158, 11, 0.15)';
    }

    // Update HUD
    if (hudDrift) hudDrift.textContent = `${sign}${drift} ms`;
    if (hudRate) hudRate.textContent = `${telemetry.playbackRate.toFixed(2)}×`;
    if (hudCalib) {
      const cSign = (telemetry.calibrationOffsetMs || 0) >= 0 ? '+' : '';
      hudCalib.textContent = `${cSign}${telemetry.calibrationOffsetMs || 0} ms`;
    }
    if (hudPhonePos) hudPhonePos.textContent = formatTime(telemetry.localTime);

    // Update UI speaker status
    if (telemetry.playing) {
      speakerStatusText.textContent = "PLAYING";
      speakerStatusText.style.color = "var(--accent-cyan)";
      speakerDisc.classList.add('playing');
    } else {
      speakerStatusText.textContent = "PAUSED";
      speakerStatusText.style.color = "var(--text-muted)";
      speakerDisc.classList.remove('playing');
    }
  };

  // WebSocket Connection
  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      connStatusBadge.className = 'badge badge-offline badge-pulse';
      connStatusBadge.textContent = 'LAN';
      showStatusToast("Connected", "Speaker synced with Laptop");

      // Register with host
      ws.send(JSON.stringify({
        version: 1,
        type: "join",
        token: roomToken,
        clientId: clientId,
        deviceName: deviceName,
        role: "receiver"
      }));

      // Start NTP clock calibration
      clockSync.startCalibration();
      syncController.start();

      // Periodic telemetry report every 1.2 seconds
      if (telemetryInterval) clearInterval(telemetryInterval);
      telemetryInterval = setInterval(sendTelemetryReport, 1200);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (err) {
        console.error("Malformed message:", err);
      }
    };

    ws.onclose = () => {
      connStatusBadge.className = 'badge badge-danger';
      connStatusBadge.textContent = 'Offline';
      showStatusToast("Reconnecting", "Connection lost. Reconnecting...", true);

      clockSync.stop();
      syncController.stop();
      if (telemetryInterval) clearInterval(telemetryInterval);

      setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = (err) => {
      console.warn("WebSocket error:", err);
    };
  }

  function handleServerMessage(msg) {
    switch (msg.type) {
      case "welcome":
        if (msg.session) applySessionState(msg.session);
        break;

      case "session-state":
        applySessionState(msg);
        break;

      case "clock-pong":
        clockSync.handlePong(msg);
        hudRtt.textContent = `${Math.round(clockSync.rttMs)} ms`;
        hudOffset.textContent = `${Math.round(clockSync.offsetMs)} ms`;
        break;

      case "play":
        showStatusToast("Playing", "Master playing movie sound");
        syncController.onPlayCommand(msg);
        break;

      case "pause":
        showStatusToast("Paused", "Master paused sound");
        syncController.onPauseCommand(msg);
        break;

      case "seek":
        showStatusToast("Seek", `Seeked to ${formatTime(msg.position)}`);
        syncController.onSeekCommand(msg);
        break;

      case "setRate":
        syncController.masterState.playbackRate = msg.playbackRate || 1.0;
        if (receiverVideo) receiverVideo.playbackRate = syncController.masterState.playbackRate;
        break;

      case "load":
        applyLoadedMovie(msg);
        break;

      case "sync":
        syncController.onSyncMessage(msg);
        break;

      case "calibrate":
        if (msg.offsetMs !== undefined) {
          syncController.setCalibrationOffset(msg.offsetMs);
          updateCalibratorUI(msg.offsetMs);
          showStatusToast("Calibrated", `Offset set to ${msg.offsetMs >= 0 ? '+' : ''}${msg.offsetMs}ms`);
        }
        break;

      case "error":
        showStatusToast("Error", msg.error || "Server error", true);
        break;
    }
  }

  function applyLoadedMovie(movie) {
    phoneMovieTitle.textContent = movie.videoName || "Movie";
    showStatusToast("Loaded", `Loaded ${movie.videoName}`);

    const targetUrl = movie.videoUrl;
    if (receiverVideo.getAttribute('data-src') !== targetUrl) {
      receiverVideo.setAttribute('data-src', targetUrl);
      receiverVideo.src = targetUrl;
      receiverVideo.load();
    }
  }

  function applySessionState(state) {
    if (state.videoName) {
      phoneMovieTitle.textContent = state.videoName;
    }

    if (state.videoUrl) {
      const currentSrc = receiverVideo.getAttribute('data-src');
      if (currentSrc !== state.videoUrl) {
        receiverVideo.setAttribute('data-src', state.videoUrl);
        receiverVideo.src = state.videoUrl;
        receiverVideo.load();
      }
    }

    syncController.onSyncMessage(state);

    if (isAudioUnlocked) {
      const expected = syncController.getExpectedMasterTime();
      if (Math.abs(receiverVideo.currentTime - expected) > 0.1) {
        receiverVideo.currentTime = expected;
      }
      if (state.playing && receiverVideo.paused) {
        syncController.executePlay();
      }
    }
  }

  function sendTelemetryReport() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      version: 1,
      type: "telemetry",
      clientId: clientId,
      deviceName: deviceName,
      latencyMs: clockSync.rttMs,
      clockOffsetMs: clockSync.offsetMs,
      driftMs: syncController.lastDriftMs,
      calibrationOffsetMs: syncController.calibrationOffsetMs,
      playbackState: receiverVideo.paused ? "paused" : "playing"
    }));
  }

  // Audio / Gesture Unlock Handler
  function handleUnlock() {
    isAudioUnlocked = true;
    unlockAudioOverlay.style.display = 'none';

    // Request screen wake lock so phone doesn't sleep
    requestWakeLock();

    // Start visualizer animation loop
    if (!visualizerAnimFrame) {
      drawVisualizer();
    }

    // Set audio properties
    receiverVideo.muted = false;
    receiverVideo.volume = parseFloat(receiverVolumeSlider.value) || 1.0;

    // Explicit user-gesture playback priming
    const playPromise = receiverVideo.play();
    if (playPromise !== undefined) {
      playPromise.then(() => {
        console.log("[Audio] Successfully primed media playback!");
        if (!syncController.masterState.playing) {
          receiverVideo.pause();
        } else {
          const expected = syncController.getExpectedMasterTime();
          receiverVideo.currentTime = expected;
        }
      }).catch(err => {
        console.warn("[Audio] Prime play caught:", err);
      });
    }

    showStatusToast("Active", "Wireless Cinema Speaker Connected");
  }

  unlockBtn.addEventListener('click', handleUnlock);
  unlockAudioOverlay.addEventListener('click', handleUnlock);

  // Volume Slider
  receiverVolumeSlider.addEventListener('input', () => {
    const val = parseFloat(receiverVolumeSlider.value);
    receiverVideo.volume = val;
    receiverVideo.muted = val === 0;
    volumePercentText.textContent = `${Math.round(val * 100)}%`;
  });

  // Mute Button
  receiverMuteBtn.addEventListener('click', () => {
    receiverVideo.muted = !receiverVideo.muted;
    if (receiverVideo.muted) {
      receiverVolumeSlider.value = 0;
      volumePercentText.textContent = "0%";
      showStatusToast("Muted", "Speaker muted");
    } else {
      receiverVideo.volume = 1.0;
      receiverVolumeSlider.value = 1.0;
      volumePercentText.textContent = "100%";
      showStatusToast("Unmuted", "Speaker active");
    }
  });

  // Manual Resync
  resyncBtn.addEventListener('click', () => {
    syncController.resyncNow();
    showStatusToast("Resynced", "Aligning audio timeline...");
  });

  // Video Preview Toggle
  toggleVideoBtn.addEventListener('click', () => {
    showVideoPreview = !showVideoPreview;
    videoPreviewWrapper.style.display = showVideoPreview ? 'block' : 'none';
    toggleVideoBtn.style.background = showVideoPreview ? 'var(--accent-primary)' : 'rgba(255, 255, 255, 0.08)';

    if (showVideoPreview) {
      showStatusToast("Video Preview", "Video preview enabled");
    } else {
      showStatusToast("Sound Only", "Switched to Sound Only Mode");
    }
  });

  // HUD Drawer
  toggleHudBtn.addEventListener('click', () => {
    diagnosticHud.style.display = diagnosticHud.style.display === 'flex' ? 'none' : 'flex';
  });

  closeHudBtn.addEventListener('click', () => {
    diagnosticHud.style.display = 'none';
  });

  deviceNameInput.addEventListener('change', () => {
    const val = deviceNameInput.value.trim();
    if (val) {
      deviceName = val;
      localStorage.setItem('beatsync_device_name', deviceName);
      sendTelemetryReport();
    }
  });

  // Echo & Latency Calibrator Interaction
  function updateCalibratorUI(val) {
    if (calibratorSlider) calibratorSlider.value = val;
    if (calibratorValueDisplay) {
      const sign = val >= 0 ? '+' : '';
      calibratorValueDisplay.textContent = `${sign}${val}ms`;
    }
    if (hudCalib) {
      const sign = val >= 0 ? '+' : '';
      hudCalib.textContent = `${sign}${val} ms`;
    }
    if (presetChips) {
      presetChips.forEach(chip => {
        const chipVal = parseInt(chip.getAttribute('data-offset'), 10);
        if (chipVal === val) {
          chip.classList.add('active');
        } else {
          chip.classList.remove('active');
        }
      });
    }
  }

  // Set initial state from sync controller (loaded from localStorage)
  const initialCalibOffset = syncController.getCalibrationOffset();
  updateCalibratorUI(initialCalibOffset);

  if (calibratorSlider) {
    calibratorSlider.addEventListener('input', () => {
      const val = parseInt(calibratorSlider.value, 10);
      syncController.setCalibrationOffset(val);
      updateCalibratorUI(val);
    });
    calibratorSlider.addEventListener('change', () => {
      const val = parseInt(calibratorSlider.value, 10);
      showStatusToast("Calibrated", `Audio offset: ${val >= 0 ? '+' : ''}${val}ms`);
      sendTelemetryReport();
    });
  }

  if (nudgeDownBtn) {
    nudgeDownBtn.addEventListener('click', () => {
      let val = (parseInt(calibratorSlider.value, 10) || 0) - 10;
      val = Math.max(-250, Math.min(250, val));
      syncController.setCalibrationOffset(val);
      updateCalibratorUI(val);
      showStatusToast("Nudge -10ms", `Offset: ${val >= 0 ? '+' : ''}${val}ms`);
      sendTelemetryReport();
    });
  }

  if (nudgeUpBtn) {
    nudgeUpBtn.addEventListener('click', () => {
      let val = (parseInt(calibratorSlider.value, 10) || 0) + 10;
      val = Math.max(-250, Math.min(250, val));
      syncController.setCalibrationOffset(val);
      updateCalibratorUI(val);
      showStatusToast("Nudge +10ms", `Offset: ${val >= 0 ? '+' : ''}${val}ms`);
      sendTelemetryReport();
    });
  }

  if (presetChips) {
    presetChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const val = parseInt(chip.getAttribute('data-offset'), 10);
        syncController.setCalibrationOffset(val);
        updateCalibratorUI(val);
        showStatusToast("Preset Applied", `${chip.textContent.trim()}`);
        sendTelemetryReport();
      });
    });
  }

  if (autoZeroBtn) {
    autoZeroBtn.addEventListener('click', () => {
      const newOffset = syncController.autoZeroCalibration();
      updateCalibratorUI(newOffset);
      showStatusToast("Auto-Zeroed", `Drift zeroed: ${newOffset >= 0 ? '+' : ''}${newOffset}ms`);
      sendTelemetryReport();
    });
  }

  // Start visualizer background loop
  drawVisualizer();

  // Start connection
  connectWebSocket();
})();
