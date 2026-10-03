/**
 * BeatSync-Pro Mobile Receiver
 *
 * Protocol v2
 *
 * Architecture:
 *
 *   Laptop Master Video
 *          |
 *          | captureStream()
 *          v
 *   WebRTC Audio Track
 *          |
 *          | Offline LAN
 *          v
 *   Phone WebRTC Audio
 *
 * WebSocket is used only for:
 *   - session state
 *   - authoritative timeline
 *   - clock synchronization
 *   - WebRTC signaling
 *   - telemetry
 *
 * The actual movie audio is transported through WebRTC.
 */

(function () {
  "use strict";

  const PROTOCOL_VERSION = 2;
  const DEFAULT_ROOM_ID = "movie-night";

  // ============================================================
  // DOM ELEMENTS
  // ============================================================

  const receiverVideo = document.getElementById("receiverVideo");
  const videoPreviewWrapper = document.getElementById("videoPreviewWrapper");

  const speakerDisc = document.getElementById("speakerDisc");
  const speakerStatusText = document.getElementById("speakerStatusText");

  const visualizerCanvas = document.getElementById("visualizerCanvas");
  const canvasCtx = visualizerCanvas
    ? visualizerCanvas.getContext("2d")
    : null;

  const unlockAudioOverlay =
    document.getElementById("unlockAudioOverlay");

  const unlockBtn =
    document.getElementById("unlockBtn");

  const phoneMovieTitle =
    document.getElementById("phoneMovieTitle");

  const phoneDriftPill =
    document.getElementById("phoneDriftPill");

  const connStatusBadge =
    document.getElementById("connStatusBadge");

  const floatingStatus =
    document.getElementById("floatingStatus");

  const floatingBadge =
    document.getElementById("floatingBadge");

  const floatingMessage =
    document.getElementById("floatingMessage");

  const resyncBtn =
    document.getElementById("resyncBtn");

  const toggleVideoBtn =
    document.getElementById("toggleVideoBtn");

  const toggleHudBtn =
    document.getElementById("toggleHudBtn");

  const closeHudBtn =
    document.getElementById("closeHudBtn");

  const diagnosticHud =
    document.getElementById("diagnosticHud");

  const deviceNameInput =
    document.getElementById("deviceNameInput");

  const hudDrift =
    document.getElementById("hudDrift");

  const hudRtt =
    document.getElementById("hudRtt");

  const hudOffset =
    document.getElementById("hudOffset");

  const hudRate =
    document.getElementById("hudRate");

  const hudCalib =
    document.getElementById("hudCalib");

  const hudPhonePos =
    document.getElementById("hudPhonePos");

  const autoZeroBtn =
    document.getElementById("autoZeroBtn");

  const calibratorSlider =
    document.getElementById("calibratorSlider");

  const calibratorValueDisplay =
    document.getElementById("calibratorValueDisplay");

  const nudgeDownBtn =
    document.getElementById("nudgeDownBtn");

  const nudgeUpBtn =
    document.getElementById("nudgeUpBtn");

  const presetChips =
    document.querySelectorAll(".preset-chip");

  const receiverMuteBtn =
    document.getElementById("receiverMuteBtn");

  const receiverVolumeSlider =
    document.getElementById("receiverVolumeSlider");

  const volumePercentText =
    document.getElementById("volumePercentText");


  // ============================================================
  // IDENTITY
  // ============================================================

  const urlParams =
    new URLSearchParams(window.location.search);

  const roomToken =
    urlParams.get("token") || "BEAT123";

  const roomId =
    urlParams.get("room") || DEFAULT_ROOM_ID;

  let clientId =
    localStorage.getItem("beatsync_client_id");

  if (!clientId) {
    clientId =
      "phone-" +
      Math.random()
        .toString(36)
        .substring(2, 9);

    localStorage.setItem(
      "beatsync_client_id",
      clientId
    );
  }

  let deviceName =
    localStorage.getItem("beatsync_device_name") ||
    `Phone (${clientId.slice(-4)})`;

  if (deviceNameInput) {
    deviceNameInput.value = deviceName;
  }


  // ============================================================
  // RUNTIME STATE
  // ============================================================

  let ws = null;

  let clockSync = null;

  let syncController = null;

  let webrtcManager = null;

  let remoteAudio = null;

  let remoteStream = null;

  let audioContext = null;

  let analyser = null;

  let mediaSource = null;

  let wakeLock = null;

  let isAudioUnlocked = false;

  let showVideoPreview = false;

  let telemetryInterval = null;

  let visualizerAnimFrame = null;

  let reconnectTimer = null;

  let statusToastTimeout = null;

  let manuallyDisconnected = false;

  let lastRemoteStreamTime = 0;

  let receiverVolume = 1.0;

  let receiverMuted = false;


  // ============================================================
  // UTILITY
  // ============================================================

  function nowMs() {
    return (
      performance.timeOrigin +
      performance.now()
    );
  }


  function formatTime(seconds) {

    if (
      !Number.isFinite(seconds) ||
      seconds < 0
    ) {
      return "00:00:00";
    }

    const total =
      Math.floor(seconds);

    const hours =
      Math.floor(total / 3600);

    const minutes =
      Math.floor(
        (total % 3600) / 60
      );

    const secs =
      total % 60;

    return (
      String(hours).padStart(2, "0") +
      ":" +
      String(minutes).padStart(2, "0") +
      ":" +
      String(secs).padStart(2, "0")
    );
  }


  function safeSend(message) {

    if (
      !ws ||
      ws.readyState !== WebSocket.OPEN
    ) {
      return false;
    }

    try {

      ws.send(
        JSON.stringify({
          version: PROTOCOL_VERSION,
          roomId,
          clientId,
          ...message
        })
      );

      return true;

    } catch (error) {

      console.warn(
        "[WS] Send failed:",
        error
      );

      return false;
    }
  }


  // ============================================================
  // STATUS UI
  // ============================================================

  function setConnectionStatus(
    text,
    mode = "offline"
  ) {

    if (!connStatusBadge) {
      return;
    }

    connStatusBadge.textContent = text;

    connStatusBadge.className =
      "badge badge-" + mode;

    if (mode === "offline") {
      connStatusBadge.classList.add(
        "badge-pulse"
      );
    }
  }


  function showStatusToast(
    title,
    message,
    isError = false
  ) {

    if (!floatingStatus) {
      return;
    }

    if (statusToastTimeout) {
      clearTimeout(
        statusToastTimeout
      );
    }

    if (floatingBadge) {

      floatingBadge.textContent =
        title;

      floatingBadge.className =
        isError
          ? "badge badge-danger"
          : "badge badge-offline";
    }

    if (floatingMessage) {
      floatingMessage.textContent =
        message;
    }

    floatingStatus.style.display =
      "flex";

    requestAnimationFrame(() => {
      floatingStatus.style.opacity =
        "1";
    });

    statusToastTimeout =
      setTimeout(() => {

        floatingStatus.style.opacity =
          "0";

        setTimeout(() => {

          floatingStatus.style.display =
            "none";

        }, 250);

      }, 2500);
  }


  // ============================================================
  // REMOTE AUDIO ELEMENT
  // ============================================================

  function createRemoteAudio() {

    if (remoteAudio) {
      return remoteAudio;
    }

    remoteAudio =
      document.createElement("audio");

    remoteAudio.id =
      "beatsyncRemoteAudio";

    remoteAudio.autoplay = false;

    remoteAudio.controls = false;

    remoteAudio.playsInline = true;

    remoteAudio.preload = "auto";

    remoteAudio.volume =
      receiverVolume;

    remoteAudio.muted =
      receiverMuted;

    remoteAudio.style.display =
      "none";

    document.body.appendChild(
      remoteAudio
    );

    return remoteAudio;
  }


  // ============================================================
  // WEB AUDIO ANALYSER
  // ============================================================

  async function setupAudioAnalyser(
    stream
  ) {

    if (!stream) {
      return;
    }

    try {

      if (!audioContext) {

        audioContext =
          new (
            window.AudioContext ||
            window.webkitAudioContext
          )();

      }

      if (
        audioContext.state ===
        "suspended"
      ) {

        await audioContext.resume();
      }

      if (mediaSource) {

        try {
          mediaSource.disconnect();
        } catch (_) {}
      }

      analyser =
        audioContext.createAnalyser();

      analyser.fftSize = 256;

      analyser.smoothingTimeConstant =
        0.75;

      mediaSource =
        audioContext.createMediaStreamSource(
          stream
        );

      mediaSource.connect(
        analyser
      );

      console.log(
        "[Audio] Web Audio analyser ready"
      );

    } catch (error) {

      console.warn(
        "[Audio] Analyser setup failed:",
        error
      );
    }
  }


  // ============================================================
  // WEBRTC REMOTE STREAM
  // ============================================================

  async function handleRemoteStream(
    stream
  ) {

    if (!stream) {
      return;
    }

    remoteStream =
      stream;

    lastRemoteStreamTime =
      nowMs();

    const audio =
      createRemoteAudio();

    try {

      audio.srcObject =
        stream;

      audio.volume =
        receiverVolume;

      audio.muted =
        receiverMuted;

      await setupAudioAnalyser(
        stream
      );

      if (isAudioUnlocked) {

        await playRemoteAudio();

      }

      updateSpeakerStatus();

      showStatusToast(
        "Connected",
        "Wireless Cinema Speaker ready"
      );

      console.log(
        "[WebRTC] Remote audio stream attached"
      );

    } catch (error) {

      console.error(
        "[WebRTC] Remote stream error:",
        error
      );
    }
  }


  async function playRemoteAudio() {

    if (!remoteAudio) {
      return false;
    }

    if (!isAudioUnlocked) {
      return false;
    }

    try {

      if (
        audioContext &&
        audioContext.state ===
        "suspended"
      ) {

        await audioContext.resume();
      }

      await remoteAudio.play();

      updateSpeakerStatus();

      return true;

    } catch (error) {

      console.warn(
        "[Audio] Remote audio play blocked:",
        error
      );

      return false;
    }
  }


  function pauseRemoteAudio() {

    if (!remoteAudio) {
      return;
    }

    try {
      remoteAudio.pause();
    } catch (_) {}

    updateSpeakerStatus();
  }


  // ============================================================
  // WEBRTC INITIALIZATION
  // ============================================================

  function initializeWebRTC() {

    if (
      typeof OfflineWebRTCManager !==
      "function"
    ) {

      console.error(
        "[WebRTC] OfflineWebRTCManager is missing"
      );

      showStatusToast(
        "Error",
        "WebRTC module failed to load",
        true
      );

      return;
    }

    webrtcManager =
      new OfflineWebRTCManager(
        false,
        clientId,
        safeSend
      );


    // ----------------------------------------------------------
    // Remote audio
    // ----------------------------------------------------------

    webrtcManager.onRemoteStream =
      handleRemoteStream;


    // ----------------------------------------------------------
    // Peer state
    // ----------------------------------------------------------

    webrtcManager.onPeerStateChange =
      (peerId, state) => {

        console.log(
          `[WebRTC] Peer ${peerId}: ${state}`
        );

        if (
          state === "connected"
        ) {

          setConnectionStatus(
            "Audio",
            "offline"
          );

        } else if (
          state === "failed" ||
          state === "disconnected"
        ) {

          setConnectionStatus(
            "LAN",
            "offline"
          );
        }
      };


    webrtcManager.onPeerConnected =
      (peerId) => {

        console.log(
          "[WebRTC] Connected to master:",
          peerId
        );

        showStatusToast(
          "Audio Linked",
          "Laptop audio connected"
        );

        setConnectionStatus(
          "Audio",
          "offline"
        );

        if (isAudioUnlocked) {
          playRemoteAudio();
        }
      };


    webrtcManager.onPeerDisconnected =
      (peerId) => {

        console.warn(
          "[WebRTC] Master disconnected:",
          peerId
        );

        updateSpeakerStatus();
      };


    webrtcManager.onError =
      (error) => {

        console.error(
          "[WebRTC] Error:",
          error
        );

        showStatusToast(
          "WebRTC Error",
          error?.message ||
            "LAN audio connection failed",
          true
        );
      };


    console.log(
      "[WebRTC] Receiver manager initialized"
    );
  }


  // ============================================================
  // CLOCK SYNCHRONIZATION
  // ============================================================

  function initializeClockSync() {

    clockSync =
      new ClientClockSync(
        (data) => {

          safeSend(data);
        }
      );

    console.log(
      "[Clock] Client clock initialized"
    );
  }


  // ============================================================
  // PLAYBACK SYNCHRONIZATION
  // ============================================================

  function initializeSyncController() {

    if (!receiverVideo) {
      return;
    }

    syncController =
      new PlaybackSyncController(
        receiverVideo,
        clockSync
      );


    syncController.onTelemetryUpdate =
      (telemetry) => {

        const drift =
          Number(
            telemetry?.driftMs || 0
          );

        const sign =
          drift >= 0
            ? "+"
            : "";

        if (phoneDriftPill) {

          phoneDriftPill.textContent =
            `Sync: ${sign}${Math.round(drift)}ms`;

          const abs =
            Math.abs(drift);

          if (abs <= 20) {

            phoneDriftPill.style.color =
              "var(--accent-emerald)";

            phoneDriftPill.style.borderColor =
              "rgba(16, 185, 129, 0.35)";

            phoneDriftPill.style.background =
              "rgba(16, 185, 129, 0.15)";

          } else if (abs <= 80) {

            phoneDriftPill.style.color =
              "var(--accent-cyan)";

            phoneDriftPill.style.borderColor =
              "rgba(6, 182, 212, 0.35)";

            phoneDriftPill.style.background =
              "rgba(6, 182, 212, 0.15)";

          } else {

            phoneDriftPill.style.color =
              "var(--accent-amber)";

            phoneDriftPill.style.borderColor =
              "rgba(245, 158, 11, 0.35)";

            phoneDriftPill.style.background =
              "rgba(245, 158, 11, 0.15)";
          }
        }


        if (hudDrift) {
          hudDrift.textContent =
            `${Math.round(drift)} ms`;
        }

        if (hudRtt) {
          hudRtt.textContent =
            `${Math.round(
              telemetry?.rttMs ||
              clockSync?.rttMs ||
              0
            )} ms`;
        }

        if (hudOffset) {
          hudOffset.textContent =
            `${Math.round(
              telemetry?.clockOffsetMs ||
              clockSync?.offsetMs ||
              0
            )} ms`;
        }

        if (hudRate) {
          hudRate.textContent =
            `${Number(
              telemetry?.playbackRate ||
              syncController
                ?.masterState
                ?.playbackRate ||
              1
            ).toFixed(2)}×`;
        }

        if (hudCalib) {
          hudCalib.textContent =
            `${Math.round(
              telemetry?.calibrationOffsetMs ||
              syncController
                ?.calibrationOffsetMs ||
              0
            )} ms`;
        }

        if (hudPhonePos) {
          hudPhonePos.textContent =
            formatTime(
              getReceiverTimelinePosition()
            );
        }

        updateSpeakerStatus();
      };


    console.log(
      "[Sync] Playback controller initialized"
    );
  }


  // ============================================================
  // RECEIVER TIMELINE POSITION
  // ============================================================

  function getReceiverTimelinePosition() {

    if (
      syncController &&
      typeof syncController
        .getExpectedMasterTime ===
        "function"
    ) {

      const expected =
        syncController
          .getExpectedMasterTime();

      if (
        Number.isFinite(expected)
      ) {
        return expected;
      }
    }

    if (
      receiverVideo &&
      Number.isFinite(
        receiverVideo.currentTime
      )
    ) {

      return receiverVideo.currentTime;
    }

    return 0;
  }


  // ============================================================
  // SPEAKER STATUS
  // ============================================================

  function updateSpeakerStatus() {

    if (!speakerStatusText) {
      return;
    }

    const playing =
      remoteAudio &&
      !remoteAudio.paused &&
      !remoteAudio.ended;

    if (playing) {

      speakerStatusText.textContent =
        "PLAYING";

      if (speakerDisc) {
        speakerDisc.classList.add(
          "is-playing"
        );
      }

    } else {

      speakerStatusText.textContent =
        "PAUSED";

      if (speakerDisc) {
        speakerDisc.classList.remove(
          "is-playing"
        );
      }
    }
  }


  // ============================================================
  // SESSION STATE
  // ============================================================

  function applyLoadedMovie(movie) {

    if (!movie) {
      return;
    }

    if (phoneMovieTitle) {

      phoneMovieTitle.textContent =
        movie.videoName ||
        "Movie";
    }

    showStatusToast(
      "Loaded",
      movie.videoName ||
        "Movie loaded"
    );


    /*
     * IMPORTANT:
     *
     * We do NOT make the receiver fetch
     * the movie as its audio source.
     *
     * The master laptop captures its own
     * movie audio and sends that audio
     * through WebRTC.
     *
     * The receiverVideo is only retained
     * as an optional preview/timeline
     * compatibility element.
     */

    if (
      receiverVideo &&
      movie.videoUrl &&
      showVideoPreview
    ) {

      const currentSrc =
        receiverVideo.getAttribute(
          "data-src"
        );

      if (
        currentSrc !==
        movie.videoUrl
      ) {

        receiverVideo.setAttribute(
          "data-src",
          movie.videoUrl
        );

        receiverVideo.src =
          movie.videoUrl;

        receiverVideo.load();
      }
    }
  }


  function applySessionState(state) {

    if (!state) {
      return;
    }

    if (phoneMovieTitle) {

      phoneMovieTitle.textContent =
        state.videoName ||
        "Waiting for Movie...";
    }


    if (
      syncController &&
      typeof syncController
        .onSyncMessage ===
        "function"
    ) {

      syncController.onSyncMessage(
        state
      );
    }


    if (
      receiverVideo &&
      showVideoPreview &&
      state.videoUrl
    ) {

      const currentSrc =
        receiverVideo.getAttribute(
          "data-src"
        );

      if (
        currentSrc !==
        state.videoUrl
      ) {

        receiverVideo.setAttribute(
          "data-src",
          state.videoUrl
        );

        receiverVideo.src =
          state.videoUrl;

        receiverVideo.load();
      }
    }


    if (
      state.playbackRate &&
      remoteAudio
    ) {

      /*
       * WebRTC audio itself is not a
       * normal movie file timeline.
       *
       * The playback rate is still
       * reflected in the hidden preview
       * / timeline element when available.
       */

      remoteAudio.playbackRate =
        Number(
          state.playbackRate
        ) || 1;
    }


    if (
      isAudioUnlocked &&
      state.playing
    ) {

      playRemoteAudio();

    } else if (
      !state.playing
    ) {

      pauseRemoteAudio();
    }


    updateSpeakerStatus();
  }


  // ============================================================
  // SERVER MESSAGE HANDLER
  // ============================================================

  async function handleServerMessage(msg) {

    if (!msg || !msg.type) {
      return;
    }

    switch (msg.type) {

      // --------------------------------------------------------
      // WELCOME
      // --------------------------------------------------------

      case "welcome":

        console.log(
          "[WS] Welcome received"
        );

        if (msg.session) {

          applySessionState(
            msg.session
          );
        }

        break;


      // --------------------------------------------------------
      // SESSION STATE
      // --------------------------------------------------------

      case "session-state":

        applySessionState(
          msg
        );

        break;


      // --------------------------------------------------------
      // CLIENT LIST
      // --------------------------------------------------------

      case "client-list":

        console.log(
          "[WS] Client list:",
          msg.clients
        );

        break;


      // --------------------------------------------------------
      // CLOCK PONG
      // --------------------------------------------------------

      case "clock-pong":

        if (
          clockSync &&
          typeof clockSync.handlePong ===
            "function"
        ) {

          clockSync.handlePong(
            msg
          );
        }

        break;


      // --------------------------------------------------------
      // PLAY
      // --------------------------------------------------------

      case "play":

        console.log(
          "[Sync] PLAY",
          msg
        );

        if (
          syncController &&
          typeof syncController
            .onPlayCommand ===
            "function"
        ) {

          syncController.onPlayCommand(
            msg
          );
        }

        await playRemoteAudio();

        showStatusToast(
          "Playing",
          "Master started movie"
        );

        updateSpeakerStatus();

        break;


      // --------------------------------------------------------
      // PAUSE
      // --------------------------------------------------------

      case "pause":

        console.log(
          "[Sync] PAUSE",
          msg
        );

        if (
          syncController &&
          typeof syncController
            .onPauseCommand ===
            "function"
        ) {

          syncController.onPauseCommand(
            msg
          );
        }

        pauseRemoteAudio();

        showStatusToast(
          "Paused",
          "Master paused movie"
        );

        break;


      // --------------------------------------------------------
      // SEEK
      // --------------------------------------------------------

      case "seek":

        console.log(
          "[Sync] SEEK",
          msg
        );

        if (
          syncController &&
          typeof syncController
            .onSeekCommand ===
            "function"
        ) {

          syncController.onSeekCommand(
            msg
          );
        }

        showStatusToast(
          "Seek",
          `Movie position ${formatTime(
            Number(
              msg.position ??
              msg.currentTime ??
              0
            )
          )}`
        );

        break;


      // --------------------------------------------------------
      // RATE
      // --------------------------------------------------------

      case "setRate":

        console.log(
          "[Sync] RATE",
          msg.playbackRate
        );

        if (
          syncController &&
          syncController.masterState
        ) {

          syncController
            .masterState
            .playbackRate =
              Number(
                msg.playbackRate
              ) || 1;
        }

        if (
          receiverVideo
        ) {

          receiverVideo.playbackRate =
            Number(
              msg.playbackRate
            ) || 1;
        }

        break;


      // --------------------------------------------------------
      // LOAD
      // --------------------------------------------------------

      case "load":

        applyLoadedMovie(
          msg
        );

        break;


      // --------------------------------------------------------
      // UNLOAD
      // --------------------------------------------------------

      case "unload":

        if (phoneMovieTitle) {

          phoneMovieTitle.textContent =
            "Waiting for Movie...";
        }

        pauseRemoteAudio();

        if (receiverVideo) {

          receiverVideo.removeAttribute(
            "data-src"
          );

          receiverVideo.removeAttribute(
            "src"
          );

          receiverVideo.load();
        }

        break;


      // --------------------------------------------------------
      // AUTHORITATIVE SYNC
      // --------------------------------------------------------

      case "sync":

        if (
          syncController &&
          typeof syncController
            .onSyncMessage ===
            "function"
        ) {

          syncController.onSyncMessage(
            msg
          );
        }

        if (
          msg.playing &&
          isAudioUnlocked
        ) {

          await playRemoteAudio();

        } else if (
          msg.playing === false
        ) {

          pauseRemoteAudio();
        }

        break;


      // --------------------------------------------------------
      // CALIBRATION
      // --------------------------------------------------------

      case "calibrate":

        if (
          syncController &&
          msg.offsetMs !==
            undefined
        ) {

          syncController
            .setCalibrationOffset(
              Number(
                msg.offsetMs
              )
            );

          updateCalibratorUI(
            Number(
              msg.offsetMs
            )
          );

          showStatusToast(
            "Calibrated",
            `Offset ${
              Number(msg.offsetMs) >= 0
                ? "+"
                : ""
            }${Number(
              msg.offsetMs
            )}ms`
          );
        }

        break;


      // --------------------------------------------------------
      // WEBRTC OFFER
      // --------------------------------------------------------

      case "webrtc-offer":

        console.log(
          "[WebRTC] OFFER received"
        );

        if (
          webrtcManager &&
          typeof webrtcManager
            .handleOffer ===
            "function"
        ) {

          await webrtcManager.handleOffer(
            msg
          );
        }

        break;


      // --------------------------------------------------------
      // WEBRTC ANSWER
      // --------------------------------------------------------

      case "webrtc-answer":

        console.log(
          "[WebRTC] ANSWER received"
        );

        if (
          webrtcManager &&
          typeof webrtcManager
            .handleAnswer ===
            "function"
        ) {

          await webrtcManager.handleAnswer(
            msg
          );
        }

        break;


      // --------------------------------------------------------
      // WEBRTC ICE CANDIDATE
      // --------------------------------------------------------

      case "webrtc-candidate":

        if (
          webrtcManager &&
          typeof webrtcManager
            .handleCandidate ===
            "function"
        ) {

          await webrtcManager.handleCandidate(
            msg
          );
        }

        break;


      // --------------------------------------------------------
      // PING
      // --------------------------------------------------------

      case "ping":

        safeSend({
          type: "pong",
          clientTime: nowMs()
        });

        break;


      // --------------------------------------------------------
      // ERROR
      // --------------------------------------------------------

      case "error":

        console.error(
          "[Server] Error:",
          msg.error
        );

        showStatusToast(
          "Error",
          msg.error ||
            "Server error",
          true
        );

        break;


      default:

        console.log(
          "[WS] Unhandled message:",
          msg.type
        );
    }
  }


  // ============================================================
  // WEBSOCKET
  // ============================================================

  function connectWebSocket() {

    if (manuallyDisconnected) {
      return;
    }

    if (
      ws &&
      (
        ws.readyState ===
          WebSocket.OPEN ||
        ws.readyState ===
          WebSocket.CONNECTING
      )
    ) {
      return;
    }

    const protocol =
      window.location.protocol ===
      "https:"
        ? "wss:"
        : "ws:";

    const wsUrl =
      `${protocol}//${window.location.host}/ws`;

    console.log(
      "[WS] Connecting:",
      wsUrl
    );

    setConnectionStatus(
      "Connecting",
      "offline"
    );


    try {

      ws =
        new WebSocket(
          wsUrl
        );

    } catch (error) {

      console.error(
        "[WS] Creation failed:",
        error
      );

      scheduleReconnect();

      return;
    }


    ws.onopen = () => {

      console.log(
        "[WS] Connected"
      );

      setConnectionStatus(
        "LAN",
        "offline"
      );

      showStatusToast(
        "Connected",
        "Connected to master laptop"
      );


      // --------------------------------------------------------
      // JOIN
      // --------------------------------------------------------

      safeSend({
        type: "join",
        token: roomToken,
        deviceName,
        role: "receiver"
      });


      // --------------------------------------------------------
      // CLOCK CALIBRATION
      // --------------------------------------------------------

      if (
        clockSync &&
        typeof clockSync.startCalibration ===
          "function"
      ) {

        clockSync.startCalibration();
      }


      // --------------------------------------------------------
      // DRIFT CONTROLLER
      // --------------------------------------------------------

      if (
        syncController &&
        typeof syncController.start ===
          "function"
      ) {

        syncController.start();
      }


      // --------------------------------------------------------
      // TELEMETRY
      // --------------------------------------------------------

      if (telemetryInterval) {
        clearInterval(
          telemetryInterval
        );
      }

      telemetryInterval =
        setInterval(
          sendTelemetryReport,
          1200
        );
    };


    ws.onmessage = (event) => {

      try {

        const msg =
          JSON.parse(
            event.data
          );

        handleServerMessage(
          msg
        );

      } catch (error) {

        console.error(
          "[WS] Invalid message:",
          error
        );
      }
    };


    ws.onclose = () => {

      console.warn(
        "[WS] Connection closed"
      );

      setConnectionStatus(
        "Offline",
        "danger"
      );

      showStatusToast(
        "Reconnecting",
        "LAN connection lost",
        true
      );


      if (
        clockSync &&
        typeof clockSync.stop ===
          "function"
      ) {

        clockSync.stop();
      }


      if (
        syncController &&
        typeof syncController.stop ===
          "function"
      ) {

        syncController.stop();
      }


      if (telemetryInterval) {

        clearInterval(
          telemetryInterval
        );

        telemetryInterval =
          null;
      }


      scheduleReconnect();
    };


    ws.onerror = (error) => {

      console.warn(
        "[WS] Error:",
        error
      );
    };
  }


  function scheduleReconnect() {

    if (manuallyDisconnected) {
      return;
    }

    if (reconnectTimer) {
      return;
    }

    reconnectTimer =
      setTimeout(() => {

        reconnectTimer =
          null;

        connectWebSocket();

      }, 2000);
  }


  // ============================================================
  // TELEMETRY
  // ============================================================

  function sendTelemetryReport() {

    if (
      !ws ||
      ws.readyState !==
        WebSocket.OPEN
    ) {
      return;
    }

    const drift =
      syncController
        ?.lastDriftMs ||
      0;

    const rtt =
      clockSync
        ?.rttMs ||
      0;

    const offset =
      clockSync
        ?.offsetMs ||
      0;

    const calibration =
      syncController
        ?.calibrationOffsetMs ||
      0;

    const playing =
      remoteAudio &&
      !remoteAudio.paused;

    safeSend({
      type: "telemetry",

      deviceName,

      latencyMs:
        Number(rtt),

      clockOffsetMs:
        Number(offset),

      driftMs:
        Number(drift),

      calibrationOffsetMs:
        Number(calibration),

      playbackState:
        playing
          ? "playing"
          : "paused",

      currentTime:
        Number(
          getReceiverTimelinePosition()
        ),

      playbackRate:
        Number(
          syncController
            ?.masterState
            ?.playbackRate ||
          1
        )
    });
  }


  // ============================================================
  // AUDIO UNLOCK
  // ============================================================

  async function handleUnlock() {

    if (isAudioUnlocked) {
      return;
    }

    isAudioUnlocked =
      true;


    // ----------------------------------------------------------
    // Hide overlay
    // ----------------------------------------------------------

    if (unlockAudioOverlay) {

      unlockAudioOverlay.style.display =
        "none";
    }


    // ----------------------------------------------------------
    // Wake lock
    // ----------------------------------------------------------

    requestWakeLock();


    // ----------------------------------------------------------
    // Audio context
    // ----------------------------------------------------------

    try {

      if (!audioContext) {

        audioContext =
          new (
            window.AudioContext ||
            window.webkitAudioContext
          )();
      }

      if (
        audioContext.state ===
        "suspended"
      ) {

        await audioContext.resume();
      }

    } catch (error) {

      console.warn(
        "[Audio] AudioContext unlock failed:",
        error
      );
    }


    // ----------------------------------------------------------
    // Create audio element
    // ----------------------------------------------------------

    const audio =
      createRemoteAudio();

    audio.muted =
      receiverMuted;

    audio.volume =
      receiverVolume;


    // ----------------------------------------------------------
    // Prime audio
    // ----------------------------------------------------------

    if (remoteStream) {

      try {

        await audio.play();

        console.log(
          "[Audio] Remote WebRTC audio unlocked"
        );

      } catch (error) {

        console.warn(
          "[Audio] Remote audio still waiting:",
          error
        );
      }
    }


    // ----------------------------------------------------------
    // Visualizer
    // ----------------------------------------------------------

    if (!visualizerAnimFrame) {
      drawVisualizer();
    }


    // ----------------------------------------------------------
    // Wake lock
    // ----------------------------------------------------------

    requestWakeLock();


    showStatusToast(
      "Active",
      "Wireless Cinema Speaker ready"
    );

    updateSpeakerStatus();
  }


  // ============================================================
  // WAKE LOCK
  // ============================================================

  async function requestWakeLock() {

    if (
      !("wakeLock" in navigator)
    ) {
      return;
    }

    try {

      wakeLock =
        await navigator.wakeLock.request(
          "screen"
        );

      console.log(
        "[WakeLock] Screen lock acquired"
      );

      wakeLock.addEventListener(
        "release",
        () => {

          console.log(
            "[WakeLock] Released"
          );
        }
      );

    } catch (error) {

      console.warn(
        "[WakeLock] Failed:",
        error
      );
    }
  }


  // ============================================================
  // VISUALIZER
  // ============================================================

  function drawVisualizer() {

    if (!canvasCtx) {
      return;
    }

    const width =
      visualizerCanvas.width;

    const height =
      visualizerCanvas.height;

    canvasCtx.clearRect(
      0,
      0,
      width,
      height
    );


    let isPlaying =
      remoteAudio &&
      !remoteAudio.paused;


    let frequencyData =
      null;


    if (analyser) {

      frequencyData =
        new Uint8Array(
          analyser.frequencyBinCount
        );

      analyser.getByteFrequencyData(
        frequencyData
      );
    }


    const bars = 32;

    const gap = 2;

    const barWidth =
      width / bars - gap;


    for (
      let i = 0;
      i < bars;
      i++
    ) {

      let barHeight = 4;


      if (
        isPlaying &&
        frequencyData
      ) {

        const index =
          Math.floor(
            (
              i /
              bars
            ) *
            frequencyData.length
          );

        const value =
          frequencyData[index] ||
          0;

        barHeight =
          Math.max(
            5,
            (
              value /
              255
            ) *
            (
              height -
              8
            )
          );

      } else if (
        isPlaying
      ) {

        const time =
          performance.now() /
          180;

        const wave =
          Math.sin(
            i * 0.4 +
            time
          ) *
          Math.cos(
            i * 0.2 +
            time * 0.5
          );

        barHeight =
          Math.max(
            6,
            Math.abs(wave) *
              (height - 8)
          );
      }


      const x =
        i *
        (
          barWidth +
          gap
        );

      const y =
        height -
        barHeight;


      if (isPlaying) {

        const gradient =
          canvasCtx.createLinearGradient(
            0,
            height,
            0,
            0
          );

        gradient.addColorStop(
          0,
          "#4f46e5"
        );

        gradient.addColorStop(
          1,
          "#06b6d4"
        );

        canvasCtx.fillStyle =
          gradient;

      } else {

        canvasCtx.fillStyle =
          "rgba(255,255,255,0.1)";
      }


      canvasCtx.fillRect(
        x,
        y,
        barWidth,
        barHeight
      );
    }


    visualizerAnimFrame =
      requestAnimationFrame(
        drawVisualizer
      );
  }


  // ============================================================
  // VOLUME
  // ============================================================

  function updateVolumeUI() {

    const value =
      receiverMuted
        ? 0
        : receiverVolume;

    if (receiverVolumeSlider) {

      receiverVolumeSlider.value =
        String(value);
    }

    if (volumePercentText) {

      volumePercentText.textContent =
        `${Math.round(
          value * 100
        )}%`;
    }
  }


  function applyVolume() {

    if (remoteAudio) {

      remoteAudio.volume =
        receiverVolume;

      remoteAudio.muted =
        receiverMuted;
    }

    updateVolumeUI();
  }


  if (receiverVolumeSlider) {

    receiverVolumeSlider.addEventListener(
      "input",
      () => {

        receiverVolume =
          Math.max(
            0,
            Math.min(
              1,
              Number(
                receiverVolumeSlider.value
              )
            )
          );

        receiverMuted =
          receiverVolume === 0;

        applyVolume();
      }
    );
  }


  if (receiverMuteBtn) {

    receiverMuteBtn.addEventListener(
      "click",
      () => {

        receiverMuted =
          !receiverMuted;

        applyVolume();
      }
    );
  }


  // ============================================================
  // CALIBRATION
  // ============================================================

  function updateCalibratorUI(
    offset
  ) {

    const value =
      Number(offset) || 0;

    if (calibratorSlider) {

      calibratorSlider.value =
        String(value);
    }

    if (calibratorValueDisplay) {

      calibratorValueDisplay.textContent =
        `${value >= 0 ? "+" : ""}${Math.round(value)}ms`;
    }

    if (hudCalib) {

      hudCalib.textContent =
        `${value >= 0 ? "+" : ""}${Math.round(value)} ms`;
    }
  }


  function setCalibration(
    offset
  ) {

    const value =
      Math.max(
        -250,
        Math.min(
          250,
          Number(offset) || 0
        )
      );


    if (
      syncController &&
      typeof syncController
        .setCalibrationOffset ===
        "function"
    ) {

      syncController.setCalibrationOffset(
        value
      );
    }


    updateCalibratorUI(
      value
    );
  }


  if (calibratorSlider) {

    calibratorSlider.addEventListener(
      "input",
      () => {

        setCalibration(
          calibratorSlider.value
        );
      }
    );
  }


  if (nudgeDownBtn) {

    nudgeDownBtn.addEventListener(
      "click",
      () => {

        const current =
          Number(
            calibratorSlider.value
          ) || 0;

        setCalibration(
          current - 10
        );
      }
    );
  }


  if (nudgeUpBtn) {

    nudgeUpBtn.addEventListener(
      "click",
      () => {

        const current =
          Number(
            calibratorSlider.value
          ) || 0;

        setCalibration(
          current + 10
        );
      }
    );
  }


  presetChips.forEach(
    (chip) => {

      chip.addEventListener(
        "click",
        () => {

          const offset =
            Number(
              chip.dataset.offset
            ) || 0;

          presetChips.forEach(
            (item) => {
              item.classList.remove(
                "active"
              );
            }
          );

          chip.classList.add(
            "active"
          );

          setCalibration(
            offset
          );
        }
      );
    }
  );


  if (autoZeroBtn) {

    autoZeroBtn.addEventListener(
      "click",
      () => {

        const drift =
          Number(
            syncController
              ?.lastDriftMs ||
            0
          );

        const current =
          Number(
            syncController
              ?.calibrationOffsetMs ||
            0
          );

        setCalibration(
          current - drift
        );

        showStatusToast(
          "Auto-Zero",
          `Calibration adjusted by ${Math.round(
            -drift
          )}ms`
        );
      }
    );
  }


  // ============================================================
  // RESYNC
  // ============================================================

  if (resyncBtn) {

    resyncBtn.addEventListener(
      "click",
      async () => {

        if (
          syncController &&
          typeof syncController
            .resyncNow ===
            "function"
        ) {

          syncController.resyncNow();
        }


        if (
          remoteAudio &&
          syncController
            ?.masterState
            ?.playing
        ) {

          await playRemoteAudio();
        }


        showStatusToast(
          "Resync",
          "Receiver synchronized with master"
        );
      }
    );
  }


  // ============================================================
  // VIDEO PREVIEW
  // ============================================================

  if (toggleVideoBtn) {

    toggleVideoBtn.addEventListener(
      "click",
      () => {

        showVideoPreview =
          !showVideoPreview;

        if (videoPreviewWrapper) {

          videoPreviewWrapper.style.display =
            showVideoPreview
              ? ""
              : "none";
        }


        toggleVideoBtn.textContent =
          showVideoPreview
            ? "Hide Video"
            : "Video";


        /*
         * Load the session movie only
         * when preview is explicitly enabled.
         */

        if (
          showVideoPreview &&
          syncController
            ?.masterState
            ?.videoUrl &&
          receiverVideo
        ) {

          const url =
            syncController
              .masterState
              .videoUrl;

          receiverVideo.src =
            url;

          receiverVideo.setAttribute(
            "data-src",
            url
          );

          receiverVideo.load();
        }
      }
    );
  }


  // ============================================================
  // DIAGNOSTIC HUD
  // ============================================================

  if (toggleHudBtn) {

    toggleHudBtn.addEventListener(
      "click",
      () => {

        if (!diagnosticHud) {
          return;
        }

        const visible =
          diagnosticHud.classList.toggle(
            "open"
          );

        if (
          !visible &&
          diagnosticHud.style
        ) {

          diagnosticHud.style.display =
            "";
        }
      }
    );
  }


  if (closeHudBtn) {

    closeHudBtn.addEventListener(
      "click",
      () => {

        if (diagnosticHud) {

          diagnosticHud.classList.remove(
            "open"
          );
        }
      }
    );
  }


  // ============================================================
  // DEVICE NAME
  // ============================================================

  if (deviceNameInput) {

    deviceNameInput.addEventListener(
      "change",
      () => {

        const value =
          deviceNameInput.value.trim();

        if (!value) {
          return;
        }

        deviceName =
          value;

        localStorage.setItem(
          "beatsync_device_name",
          deviceName
        );

        safeSend({
          type: "telemetry",
          deviceName
        });

        showStatusToast(
          "Saved",
          `Speaker name: ${deviceName}`
        );
      }
    );
  }


  // ============================================================
  // USER GESTURE EVENTS
  // ============================================================

  if (unlockBtn) {

    unlockBtn.addEventListener(
      "click",
      async (event) => {

        event.stopPropagation();

        await handleUnlock();
      }
    );
  }


  if (unlockAudioOverlay) {

    unlockAudioOverlay.addEventListener(
      "click",
      async () => {

        await handleUnlock();
      }
    );
  }


  // ============================================================
  // VISIBILITY / WAKE LOCK
  // ============================================================

  document.addEventListener(
    "visibilitychange",
    async () => {

      if (
        document.visibilityState ===
        "visible" &&
        isAudioUnlocked
      ) {

        requestWakeLock();

        if (
          syncController &&
          syncController.masterState &&
          syncController.masterState.playing
        ) {

          await playRemoteAudio();
        }
      }
    }
  );


  // ============================================================
  // BEFORE UNLOAD
  // ============================================================

  window.addEventListener(
    "beforeunload",
    () => {

      manuallyDisconnected =
        true;


      if (reconnectTimer) {

        clearTimeout(
          reconnectTimer
        );

        reconnectTimer =
          null;
      }


      if (telemetryInterval) {

        clearInterval(
          telemetryInterval
        );

        telemetryInterval =
          null;
      }


      if (
        clockSync &&
        typeof clockSync.stop ===
          "function"
      ) {

        clockSync.stop();
      }


      if (
        syncController &&
        typeof syncController.stop ===
          "function"
      ) {

        syncController.stop();
      }


      if (webrtcManager) {

        try {

          if (
            typeof webrtcManager.closeAll ===
              "function"
          ) {

            webrtcManager.closeAll();

          } else if (
            typeof webrtcManager.destroy ===
              "function"
          ) {

            webrtcManager.destroy();
          }

        } catch (error) {

          console.warn(
            "[WebRTC] Cleanup error:",
            error
          );
        }
      }


      if (remoteAudio) {

        try {
          remoteAudio.pause();
          remoteAudio.srcObject = null;
        } catch (_) {}
      }
    }
  );


  // ============================================================
  // INITIALIZATION
  // ============================================================

  function initialize() {

    console.log(
      "=========================================="
    );

    console.log(
      " BeatSync-Pro Receiver v2"
    );

    console.log(
      " Offline LAN WebRTC Audio"
    );

    console.log(
      "=========================================="
    );

    console.log(
      "[Receiver] Client:",
      clientId
    );

    console.log(
      "[Receiver] Room:",
      roomId
    );


    // ----------------------------------------------------------
    // Initial UI
    // ----------------------------------------------------------

    if (videoPreviewWrapper) {

      videoPreviewWrapper.style.display =
        "none";
    }

    updateVolumeUI();

    updateCalibratorUI(
      0
    );


    // ----------------------------------------------------------
    // Modules
    // ----------------------------------------------------------

    initializeClockSync();

    initializeSyncController();

    initializeWebRTC();


    // ----------------------------------------------------------
    // Connect signaling
    // ----------------------------------------------------------

    connectWebSocket();


    // ----------------------------------------------------------
    // Initial visualizer
    // ----------------------------------------------------------

    drawVisualizer();


    console.log(
      "[Receiver] Initialization complete"
    );
  }


  // ============================================================
  // DEBUG API
  // ============================================================

  window.BeatSyncReceiver = {

    getClientId() {
      return clientId;
    },

    getRoomId() {
      return roomId;
    },

    getWebSocket() {
      return ws;
    },

    getWebRTC() {
      return webrtcManager;
    },

    getRemoteAudio() {
      return remoteAudio;
    },

    getRemoteStream() {
      return remoteStream;
    },

    getClockSync() {
      return clockSync;
    },

    getSyncController() {
      return syncController;
    },

    getTimelinePosition() {
      return getReceiverTimelinePosition();
    },

    isUnlocked() {
      return isAudioUnlocked;
    },

    async unlockAudio() {
      await handleUnlock();
    },

    async playAudio() {
      await playRemoteAudio();
    },

    pauseAudio() {
      pauseRemoteAudio();
    },

    resync() {

      if (
        syncController &&
        typeof syncController.resyncNow ===
          "function"
      ) {

        syncController.resyncNow();
      }
    },

    setCalibration(offset) {
      setCalibration(
        offset
      );
    },

    setVolume(value) {

      receiverVolume =
        Math.max(
          0,
          Math.min(
            1,
            Number(value)
          )
        );

      receiverMuted =
        receiverVolume === 0;

      applyVolume();
    }
  };


  // ============================================================
  // START
  // ============================================================

  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      initialize
    );

  } else {

    initialize();
  }

})();