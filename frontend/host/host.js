/**
 * BeatSync-Pro Master Laptop Host Controller
 */

(function () {
  'use strict';

  // DOM Elements
  const masterVideo = document.getElementById('masterVideo');
  const videoWrapper = document.getElementById('videoWrapper');
  const emptyVideoState = document.getElementById('emptyVideoState');
  const movieTitleDisplay = document.getElementById('movieTitleDisplay');
  const codecStatusBadge = document.getElementById('codecStatusBadge');
  const codecAlertBox = document.getElementById('codecAlertBox');

  const playPauseBtn = document.getElementById('playPauseBtn');
  const playIcon = document.getElementById('playIcon');
  const pauseIcon = document.getElementById('pauseIcon');
  const playPauseText = document.getElementById('playPauseText');
  const restartBtn = document.getElementById('restartBtn');
  const stepBackBtn = document.getElementById('stepBackBtn');
  const stepForwardBtn = document.getElementById('stepForwardBtn');

  const scrubberSlider = document.getElementById('scrubberSlider');
  const currentTimeDisplay = document.getElementById('currentTimeDisplay');
  const durationDisplay = document.getElementById('durationDisplay');

  const muteToggleBtn = document.getElementById('muteToggleBtn');
  const volumeSlider = document.getElementById('volumeSlider');
  const rateSelect = document.getElementById('rateSelect');
  const fullscreenBtn = document.getElementById('fullscreenBtn');

  const browseFileBtn = document.getElementById('browseFileBtn');
  const localFileInput = document.getElementById('localFileInput');
  const filePathInput = document.getElementById('filePathInput');
  const loadFromPathBtn = document.getElementById('loadFromPathBtn');
  const loadSampleBtn = document.getElementById('loadSampleBtn');

  const roomTokenDisplay = document.getElementById('roomTokenDisplay');
  const activeClientsCount = document.getElementById('activeClientsCount');
  const phoneUrlText = document.getElementById('phoneUrlText');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const qrCodeImg = document.getElementById('qrCodeImg');
  const adapterSelect = document.getElementById('adapterSelect');
  const adapterSelectorRow = document.getElementById('adapterSelectorRow');
  const devicesListContainer = document.getElementById('devicesListContainer');
  const avgDriftText = document.getElementById('avgDriftText');
  const logScrollArea = document.getElementById('logScrollArea');

  // State
  let ws = null;
  let roomToken = new URLSearchParams(window.location.search).get('token') || 'BEAT123';
  let isScrubbing = false;
  let connectedClients = new Map(); // clientId -> state
  let syncBroadcastInterval = null;
  let currentLoadedVideo = null;

  function appendLog(category, message) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const now = new Date().toTimeString().split(' ')[0];
    entry.innerHTML = `<span class="log-time">[${now}]</span> <strong>${category}:</strong> <span>${message}</span>`;
    logScrollArea.appendChild(entry);
    logScrollArea.scrollTop = logScrollArea.scrollHeight;
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "00:00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // Fetch Network Info & Session Info
  async function loadNetworkAndSession() {
    try {
      const res = await fetch('/api/network-ips');
      const data = await res.json();
      roomToken = data.roomToken;
      roomTokenDisplay.textContent = roomToken;

      const primaryUrl = `http://${data.primaryIp}:${data.port}/player?token=${roomToken}`;
      phoneUrlText.textContent = primaryUrl;
      qrCodeImg.src = `/api/qr?ip=${encodeURIComponent(data.primaryIp)}&t=${Date.now()}`;

      // Populate adapters if multiple
      if (data.connectionUrls && data.connectionUrls.length > 1) {
        adapterSelectorRow.style.display = 'flex';
        adapterSelect.innerHTML = '';
        data.connectionUrls.forEach(item => {
          const opt = document.createElement('option');
          opt.value = item.ip;
          opt.textContent = `${item.ip} (${item.type})`;
          if (item.ip === data.primaryIp) opt.selected = true;
          adapterSelect.appendChild(opt);
        });

        adapterSelect.addEventListener('change', () => {
          const selectedIp = adapterSelect.value;
          const newUrl = `http://${selectedIp}:${data.port}/player?token=${roomToken}`;
          phoneUrlText.textContent = newUrl;
          qrCodeImg.src = `/api/qr?ip=${encodeURIComponent(selectedIp)}&t=${Date.now()}`;
        });
      }

      // Check current video
      const vRes = await fetch('/api/video');
      const vData = await vRes.json();
      if (vData.hasVideo && vData.video) {
        applyVideo(vData.video);
      }
    } catch (e) {
      appendLog("Network", "Error fetching network details: " + e.message);
    }
  }

  function checkCodecCompatibility(mimeType) {
    const testVideo = document.createElement('video');
    const canPlay = testVideo.canPlayType(mimeType || 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
    if (canPlay === "probably" || canPlay === "maybe") {
      codecStatusBadge.style.display = 'inline-flex';
      codecStatusBadge.className = 'badge badge-offline';
      codecStatusBadge.textContent = 'Native Codec Supported';
      codecAlertBox.style.display = 'none';
    } else {
      codecStatusBadge.style.display = 'inline-flex';
      codecStatusBadge.className = 'badge badge-warning';
      codecStatusBadge.textContent = 'Codec May Need Transcode';
      codecAlertBox.style.display = 'block';
    }
  }

  function applyVideo(video) {
    currentLoadedVideo = video;
    movieTitleDisplay.textContent = video.videoName || "Movie";
    emptyVideoState.style.display = 'none';
    
    masterVideo.src = video.videoUrl;
    masterVideo.load();
    checkCodecCompatibility(video.mimeType);

    appendLog("Media", `Loaded video: ${video.videoName} (ID: ${video.videoId})`);
  }

  // WebSocket Connection
  function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      appendLog("WebSocket", "Connected to signaling server");
      // Register as Host
      ws.send(JSON.stringify({
        version: 1,
        type: "host",
        token: roomToken,
        clientId: "host-master"
      }));

      // Start periodic sync broadcast from host (200ms for high precision)
      if (syncBroadcastInterval) clearInterval(syncBroadcastInterval);
      syncBroadcastInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN && masterVideo.src) {
          ws.send(JSON.stringify({
            version: 1,
            type: "sync",
            currentTime: masterVideo.currentTime,
            playing: !masterVideo.paused,
            playbackRate: masterVideo.playbackRate,
            masterTimestamp: Date.now()
          }));
        }
      }, 200);

      // Keepalive heartbeat ping every 2.5 seconds
      setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            version: 1,
            type: "ping"
          }));
        }
      }, 2500);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleWsMessage(msg);
      } catch (err) {
        console.error("Malformed WS message:", err);
      }
    };

    ws.onclose = () => {
      appendLog("WebSocket", "Disconnected. Reconnecting in 2s...");
      if (syncBroadcastInterval) clearInterval(syncBroadcastInterval);
      setTimeout(initWebSocket, 2000);
    };

    ws.onerror = (err) => {
      console.warn("WebSocket error:", err);
    };
  }

  function handleWsMessage(msg) {
    switch (msg.type) {
      case "welcome":
        appendLog("Signaling", "Master host registered successfully");
        if (msg.clients) {
          updateClientsList(msg.clients);
        }
        break;

      case "client-list":
        if (msg.clients) {
          updateClientsList(msg.clients);
        }
        break;

      case "telemetry":
        if (msg.client) {
          connectedClients.set(msg.client.clientId, msg.client);
          renderDevicesList();
        }
        break;

      case "error":
        appendLog("Error", msg.error || "Unknown server error");
        break;
    }
  }

  function updateClientsList(clients) {
    connectedClients.clear();
    clients.forEach(c => connectedClients.set(c.clientId, c));
    renderDevicesList();
  }

  function renderDevicesList() {
    activeClientsCount.textContent = connectedClients.size;

    if (connectedClients.size === 0) {
      devicesListContainer.innerHTML = `
        <p style="font-size: 0.8125rem; color: var(--text-faint); text-align: center; padding: 16px;">
          No phones connected yet.<br>Scan the QR code with phone camera!
        </p>`;
      avgDriftText.textContent = "0ms";
      return;
    }

    let totalDrift = 0;
    devicesListContainer.innerHTML = '';

    connectedClients.forEach(client => {
      const absDrift = Math.abs(client.driftMs || 0);
      totalDrift += absDrift;

      let driftClass = 'drift-good';
      if (absDrift >= 80) driftClass = 'drift-bad';
      else if (absDrift > 20) driftClass = 'drift-fine';

      const driftSign = (client.driftMs || 0) >= 0 ? '+' : '';
      const driftText = `${driftSign}${Math.round(client.driftMs || 0)}ms`;
      const calibText = client.calibrationOffsetMs ? ` • Calib: ${client.calibrationOffsetMs > 0 ? '+' : ''}${client.calibrationOffsetMs}ms` : '';

      const item = document.createElement('div');
      item.className = 'device-item';
      item.innerHTML = `
        <div class="device-info-left">
          <span class="device-name">${escapeHtml(client.deviceName || "Phone")}</span>
          <span class="device-ip">${escapeHtml(client.ipAddress || "LAN")} • ${client.playbackState || 'connected'}${calibText}</span>
        </div>
        <div class="device-telemetry-right" style="display: flex; align-items: center; gap: 8px;">
          <span class="drift-badge ${driftClass}">Drift: ${driftText}</span>
          <span class="latency-text">RTT: ${Math.round(client.latencyMs || 0)}ms</span>
          <button class="btn btn-secondary btn-zero-sync" data-client-id="${escapeHtml(client.clientId)}" data-drift="${client.driftMs || 0}" data-calib="${client.calibrationOffsetMs || 0}" style="padding: 2px 8px; font-size: 0.72rem; border-radius: 4px; border-color: rgba(6, 182, 212, 0.4); color: var(--accent-cyan);" title="Auto-calibrate this phone to 0ms">Zero</button>
        </div>
      `;
      devicesListContainer.appendChild(item);
    });

    // Wire up Zero buttons
    devicesListContainer.querySelectorAll('.btn-zero-sync').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cId = btn.getAttribute('data-client-id');
        const dMs = parseFloat(btn.getAttribute('data-drift')) || 0;
        const curCalib = parseFloat(btn.getAttribute('data-calib')) || 0;
        const targetOffset = Math.round(curCalib - dMs);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            version: 1,
            type: "calibrate",
            targetId: cId,
            offsetMs: targetOffset
          }));
          appendLog("Sync", `Zeroed ${cId} to ${targetOffset >= 0 ? '+' : ''}${targetOffset}ms offset`);
        }
      });
    });

    const avg = Math.round(totalDrift / connectedClients.size);
    avgDriftText.textContent = `±${avg}ms`;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Video Event Listeners
  masterVideo.addEventListener('loadedmetadata', () => {
    durationDisplay.textContent = formatTime(masterVideo.duration);
    scrubberSlider.max = masterVideo.duration;
  });

  masterVideo.addEventListener('timeupdate', () => {
    if (!isScrubbing) {
      scrubberSlider.value = masterVideo.currentTime;
      currentTimeDisplay.textContent = formatTime(masterVideo.currentTime);
    }
  });

  masterVideo.addEventListener('play', () => {
    playIcon.style.display = 'none';
    pauseIcon.style.display = 'block';
    playPauseText.textContent = 'Pause';
  });

  masterVideo.addEventListener('pause', () => {
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
    playPauseText.textContent = 'Play';
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        version: 1,
        type: "pause",
        position: masterVideo.currentTime
      }));
    }
  });

  // Play / Pause Toggle
  function togglePlayPause() {
    if (!masterVideo.src) return;

    if (masterVideo.paused) {
      const scheduleTime = Date.now() + 250; // Schedule 250ms ahead for perfectly synchronized mobile start
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          version: 1,
          type: "play",
          position: masterVideo.currentTime,
          startAt: scheduleTime
        }));
      }
      setTimeout(() => {
        masterVideo.play().catch(e => console.warn(e));
      }, 250);
      appendLog("Playback", `Started play at ${formatTime(masterVideo.currentTime)}`);
    } else {
      masterVideo.pause();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          version: 1,
          type: "pause",
          position: masterVideo.currentTime
        }));
      }
      appendLog("Playback", `Paused at ${formatTime(masterVideo.currentTime)}`);
    }
  }

  playPauseBtn.addEventListener('click', togglePlayPause);

  // Restart
  restartBtn.addEventListener('click', () => {
    if (!masterVideo.src) return;
    masterVideo.currentTime = 0;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        version: 1,
        type: "seek",
        position: 0
      }));
    }
    masterVideo.play().catch(() => {});
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        version: 1,
        type: "play",
        position: 0,
        startAt: Date.now() + 250
      }));
    }
    appendLog("Playback", "Restarted from 00:00:00");
  });

  // Step -10s / +10s
  stepBackBtn.addEventListener('click', () => {
    if (!masterVideo.src) return;
    const newPos = Math.max(0, masterVideo.currentTime - 10);
    masterVideo.currentTime = newPos;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ version: 1, type: "seek", position: newPos }));
    }
  });

  stepForwardBtn.addEventListener('click', () => {
    if (!masterVideo.src) return;
    const newPos = Math.min(masterVideo.duration || 0, masterVideo.currentTime + 10);
    masterVideo.currentTime = newPos;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ version: 1, type: "seek", position: newPos }));
    }
  });

  // Scrubber Seeking
  scrubberSlider.addEventListener('input', () => {
    isScrubbing = true;
    currentTimeDisplay.textContent = formatTime(scrubberSlider.value);
  });

  scrubberSlider.addEventListener('change', () => {
    isScrubbing = false;
    const newPos = parseFloat(scrubberSlider.value);
    masterVideo.currentTime = newPos;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        version: 1,
        type: "seek",
        position: newPos
      }));
    }
    appendLog("Playback", `Seeked to ${formatTime(newPos)}`);
  });

  // Volume & Mute
  volumeSlider.addEventListener('input', () => {
    masterVideo.volume = parseFloat(volumeSlider.value);
    masterVideo.muted = masterVideo.volume === 0;
  });

  muteToggleBtn.addEventListener('click', () => {
    masterVideo.muted = !masterVideo.muted;
    volumeSlider.value = masterVideo.muted ? 0 : masterVideo.volume;
  });

  // Playback Rate
  rateSelect.addEventListener('change', () => {
    const rate = parseFloat(rateSelect.value);
    masterVideo.playbackRate = rate;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        version: 1,
        type: "setRate",
        playbackRate: rate
      }));
    }
    appendLog("Playback", `Set speed to ${rate}x`);
  });

  // Fullscreen
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      videoWrapper.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  // Keyboard Shortcuts (Space to play/pause, Arrow keys to seek)
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlayPause();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      stepBackBtn.click();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      stepForwardBtn.click();
    }
  });

  // Video File Selection Handlers
  browseFileBtn.addEventListener('click', () => localFileInput.click());

  localFileInput.addEventListener('change', async () => {
    if (!localFileInput.files || localFileInput.files.length === 0) return;
    const file = localFileInput.files[0];
    appendLog("Media", `Uploading/registering local file: ${file.name}...`);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/video/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success && data.video) {
        applyVideo(data.video);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            version: 1,
            type: "load",
            ...data.video
          }));
        }
      }
    } catch (err) {
      appendLog("Media", "Upload error: " + err.message);
    }
  });

  loadFromPathBtn.addEventListener('click', async () => {
    const p = filePathInput.value.trim();
    if (!p) return;
    appendLog("Media", `Registering path on laptop: ${p}...`);

    try {
      const res = await fetch('/api/video/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: p })
      });
      const data = await res.json();
      if (data.success && data.video) {
        applyVideo(data.video);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            version: 1,
            type: "load",
            ...data.video
          }));
        }
      } else {
        alert(data.detail || "Could not load video path");
      }
    } catch (err) {
      appendLog("Media", "Path error: " + err.message);
    }
  });

  loadSampleBtn.addEventListener('click', async () => {
    appendLog("Media", "Loading demo sample video...");
    try {
      const res = await fetch('/api/video/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useSample: true })
      });
      const data = await res.json();
      if (data.success && data.video) {
        applyVideo(data.video);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            version: 1,
            type: "load",
            ...data.video
          }));
        }
      } else {
        alert("Sample video not found. Place sample_video.mp4 in folder.");
      }
    } catch (err) {
      appendLog("Media", "Sample error: " + err.message);
    }
  });

  // Copy URL button
  copyUrlBtn.addEventListener('click', () => {
    const text = phoneUrlText.textContent;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        copyUrlBtn.textContent = 'Copied!';
        setTimeout(() => copyUrlBtn.textContent = 'Copy', 2000);
      });
    }
  });

  // Initialize
  loadNetworkAndSession();
  initWebSocket();
})();
