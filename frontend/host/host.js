/**
 * BeatSync-Pro Host Controller
 *
 * Protocol v2
 *
 * Responsibilities:
 *   - Local movie playback
 *   - Local file -> Blob URL
 *   - Movie audio capture using captureStream()
 *   - Offline LAN WebRTC audio
 *   - WebSocket signaling
 *   - Authoritative playback commands
 *   - Receiver/client management
 */

(function () {
    "use strict";

    // ============================================================
    // CONSTANTS
    // ============================================================

    const PROTOCOL_VERSION = 2;

    const HOST_CLIENT_ID = "host-master";

    const DEFAULT_ROOM_TOKEN = "BEAT123";

    const START_LEAD_MS = 700;

    const RECONNECT_DELAY_MS = 2000;

    // ============================================================
    // DOM
    // ============================================================

    const masterVideo =
        document.getElementById("masterVideo");

    const videoEmptyState =
        document.getElementById("videoEmptyState");

    const localFileInput =
        document.getElementById("localFileInput");

    const playBtn =
        document.getElementById("playBtn");

    const pauseBtn =
        document.getElementById("pauseBtn");

    const stopBtn =
        document.getElementById("stopBtn");

    const restartBtn =
        document.getElementById("restartBtn");

    const filePathInput =
        document.getElementById("filePathInput");

    const loadFromPathBtn =
        document.getElementById("loadFromPathBtn");

    const sampleVideoBtn =
        document.getElementById("sampleVideoBtn");

    const videoName =
        document.getElementById("videoName");

    const videoPosition =
        document.getElementById("videoPosition");

    const videoDuration =
        document.getElementById("videoDuration");

    const connectionStatus =
        document.getElementById("connectionStatus");

    const connectionStatusDot =
        document.getElementById("connectionStatusDot");

    const connectionStatusText =
        document.getElementById("connectionStatusText");

    const roomIdElement =
        document.getElementById("roomId");

    const clientList =
        document.getElementById("clientList");

    const webrtcStatus =
        document.getElementById("webrtcStatus");

    const webrtcHint =
        document.getElementById("webrtcHint");

    const diagnostics =
        document.getElementById("diagnostics");

    // ============================================================
    // STATE
    // ============================================================

    let ws = null;

    let reconnectTimer = null;

    let heartbeatTimer = null;

    let positionTimer = null;

    let currentBlobUrl = null;

    let currentFile = null;

    let currentVideo = {
        videoId: null,
        videoName: null,
        videoUrl: null,
        duration: 0,
        fileSize: 0,
        mimeType: "video/mp4"
    };

    let connectedClients = new Map();

    let capturedStream = null;

    let capturedAudioTrack = null;

    let webrtcManager = null;

    let webRtcOfferTargets = new Set();

    let webRtcConnectedTargets = new Set();

    let lastPlayCommandAt = 0;

    let destroyed = false;

    // ============================================================
    // CLOCK
    // ============================================================

    function nowMs() {
        return (
            performance.timeOrigin +
            performance.now()
        );
    }

    // ============================================================
    // LOGGING
    // ============================================================

    function appendLog(category, message) {
        const timestamp =
            new Date()
                .toTimeString()
                .split(" ")[0];

        const line =
            `[${timestamp}] ${category}: ${message}`;

        console.log("[BeatSync Host]", line);

        if (!diagnostics) {
            return;
        }

        const existing =
            diagnostics.textContent || "";

        const initialText =
            existing
                .replace(
                    /^BeatSync-Pro Host\s*/,
                    ""
                )
                .trim();

        const lines =
            initialText
                ? initialText
                    .split("\n")
                    .filter(Boolean)
                : [];

        lines.push(line);

        while (lines.length > 80) {
            lines.shift();
        }

        diagnostics.textContent =
            [
                "BeatSync-Pro Host",
                "Protocol: v2",
                "WebRTC: Offline LAN",
                "Signaling: WebSocket",
                "Clock: Authoritative",
                "Sync: Enabled",
                "",
                ...lines
            ].join("\n");

        diagnostics.scrollTop =
            diagnostics.scrollHeight;
    }

    // ============================================================
    // UI STATUS
    // ============================================================

    function setConnectionStatus(
        connected,
        text
    ) {
        if (connectionStatusText) {
            connectionStatusText.textContent =
                text;
        }

        if (connectionStatusDot) {
            connectionStatusDot.style.background =
                connected
                    ? "#22c55e"
                    : "#ef4444";
        }

        if (connectionStatus) {
            connectionStatus.style.color =
                connected
                    ? "#d1fae5"
                    : "#fecaca";
        }
    }

    function setWebRTCStatus(
        status,
        hint
    ) {
        if (webrtcStatus) {
            webrtcStatus.textContent =
                status;
        }

        if (webrtcHint) {
            webrtcHint.textContent =
                hint;
        }
    }

    // ============================================================
    // TIME
    // ============================================================

    function formatTime(seconds) {
        const value =
            Number(seconds);

        if (
            !Number.isFinite(value) ||
            value < 0
        ) {
            return "00:00";
        }

        const totalSeconds =
            Math.floor(value);

        const hours =
            Math.floor(
                totalSeconds / 3600
            );

        const minutes =
            Math.floor(
                (totalSeconds % 3600) / 60
            );

        const secs =
            totalSeconds % 60;

        if (hours > 0) {
            return (
                String(hours).padStart(2, "0") +
                ":" +
                String(minutes).padStart(2, "0") +
                ":" +
                String(secs).padStart(2, "0")
            );
        }

        return (
            String(minutes).padStart(2, "0") +
            ":" +
            String(secs).padStart(2, "0")
        );
    }

    // ============================================================
    // WEBSOCKET SEND
    // ============================================================

    function sendWs(message) {
        if (
            !ws ||
            ws.readyState !==
                WebSocket.OPEN
        ) {
            return false;
        }

        try {
            const outgoing = {
                version: PROTOCOL_VERSION,
                ...message
            };

            /*
             * Backend WebRTC signaling expects
             * targetClientId.
             *
             * OfflineWebRTCManager internally uses targetId,
             * so normalize both names here.
             */

            if (
                outgoing.type ===
                    "webrtc-offer" ||
                outgoing.type ===
                    "webrtc-answer" ||
                outgoing.type ===
                    "webrtc-candidate"
            ) {
                if (
                    !outgoing.targetClientId &&
                    outgoing.targetId
                ) {
                    outgoing.targetClientId =
                        outgoing.targetId;
                }

                if (
                    !outgoing.targetId &&
                    outgoing.targetClientId
                ) {
                    outgoing.targetId =
                        outgoing.targetClientId;
                }
            }

            ws.send(
                JSON.stringify(outgoing)
            );

            return true;
        } catch (error) {
            appendLog(
                "WebSocket",
                `Send error: ${error.message}`
            );

            return false;
        }
    }

    // ============================================================
    // WEBRTC INITIALIZATION
    // ============================================================

    function initializeWebRTC() {
        if (
            typeof window.OfflineWebRTCManager !==
            "function"
        ) {
            appendLog(
                "WebRTC",
                "OfflineWebRTCManager is not available."
            );

            setWebRTCStatus(
                "Unavailable",
                "WebRTC manager failed to load."
            );

            return;
        }

        if (webrtcManager) {
            return;
        }

        webrtcManager =
            new window.OfflineWebRTCManager(
                true,
                HOST_CLIENT_ID,
                sendWs
            );

        webrtcManager.onPeerStateChange =
            (
                targetId,
                state
            ) => {
                appendLog(
                    "WebRTC",
                    `${targetId}: ${state}`
                );

                updateWebRTCUI();
            };

        webrtcManager.onPeerConnected =
            (
                targetId
            ) => {
                webRtcConnectedTargets.add(
                    targetId
                );

                webRtcOfferTargets.delete(
                    targetId
                );

                appendLog(
                    "WebRTC",
                    `Audio connected to ${targetId}`
                );

                updateWebRTCUI();
            };

        webrtcManager.onPeerDisconnected =
            (
                targetId
            ) => {
                webRtcConnectedTargets.delete(
                    targetId
                );

                appendLog(
                    "WebRTC",
                    `Audio disconnected from ${targetId}`
                );

                updateWebRTCUI();
            };

        webrtcManager.onError =
            (
                error,
                context
            ) => {
                appendLog(
                    "WebRTC",
                    `${context}: ${error?.message || error}`
                );

                updateWebRTCUI();
            };

        appendLog(
            "WebRTC",
            "Offline LAN WebRTC manager initialized."
        );

        updateWebRTCUI();
    }

    // ============================================================
    // WEBRTC UI
    // ============================================================

    function updateWebRTCUI() {
        const phoneCount =
            connectedClients.size;

        const connectedCount =
            webRtcConnectedTargets.size;

        if (!capturedAudioTrack) {
            setWebRTCStatus(
                "Waiting for movie audio",
                phoneCount > 0
                    ? "Phone connected. Load a playable movie to capture its audio."
                    : "Load a playable movie first."
            );

            return;
        }

        if (phoneCount === 0) {
            setWebRTCStatus(
                "Audio ready",
                "Movie audio captured. Waiting for receiver phones."
            );

            return;
        }

        if (connectedCount > 0) {
            setWebRTCStatus(
                `${connectedCount}/${phoneCount} phone(s) connected`,
                "Movie audio is being sent directly over the LAN."
            );

            return;
        }

        setWebRTCStatus(
            "Connecting...",
            "Movie audio is ready. Establishing direct LAN WebRTC connections."
        );
    }

    // ============================================================
    // CAPTURE MOVIE AUDIO
    // ============================================================

    function stopCapturedStream() {
        if (capturedStream) {
            try {
                capturedStream
                    .getTracks()
                    .forEach(
                        (track) => {
                            try {
                                track.stop();
                            } catch (_) {}
                        }
                    );
            } catch (_) {}
        }

        capturedStream = null;
        capturedAudioTrack = null;

        if (webrtcManager) {
            webrtcManager.clearLocalMediaStream();
        }

        webRtcOfferTargets.clear();

        updateWebRTCUI();
    }

    function captureMovieAudio() {
        if (!masterVideo) {
            return false;
        }

        if (
            typeof masterVideo.captureStream !==
            "function"
        ) {
            appendLog(
                "WebRTC",
                "captureStream() is not supported by this browser."
            );

            setWebRTCStatus(
                "Capture unsupported",
                "Use the latest Chrome or Edge on the host laptop."
            );

            return false;
        }

        stopCapturedStream();

        try {
            capturedStream =
                masterVideo.captureStream();

            const audioTracks =
                capturedStream.getAudioTracks();

            if (
                audioTracks.length === 0
            ) {
                appendLog(
                    "WebRTC",
                    "Movie has no capturable audio track."
                );

                setWebRTCStatus(
                    "No audio track",
                    "The browser loaded the movie but exposed no audio track through captureStream()."
                );

                return false;
            }

            capturedAudioTrack =
                audioTracks[0];

            appendLog(
                "WebRTC",
                `Captured movie audio track: ${capturedAudioTrack.id}`
            );

            if (!webrtcManager) {
                initializeWebRTC();
            }

            webrtcManager.setLocalMediaStream(
                capturedStream
            );

            updateWebRTCUI();

            connectAllReceivers();

            return true;
        } catch (error) {
            appendLog(
                "WebRTC",
                `Audio capture failed: ${error.message}`
            );

            setWebRTCStatus(
                "Capture error",
                error.message
            );

            return false;
        }
    }

    // ============================================================
    // CONNECT RECEIVERS
    // ============================================================

    function connectReceiverAudio(
        clientId
    ) {
        if (!clientId) {
            return;
        }

        if (!webrtcManager) {
            initializeWebRTC();
        }

        if (!capturedAudioTrack) {
            appendLog(
                "WebRTC",
                `Cannot start WebRTC for ${clientId}: no captured audio.`
            );

            return;
        }

        if (
            webRtcConnectedTargets.has(
                clientId
            )
        ) {
            return;
        }

        if (
            webRtcOfferTargets.has(
                clientId
            )
        ) {
            return;
        }

        webRtcOfferTargets.add(
            clientId
        );

        appendLog(
            "WebRTC",
            `Starting audio connection for ${clientId}`
        );

        webrtcManager
            .connectToReceiver(
                clientId
            )
            .catch(
                (error) => {
                    webRtcOfferTargets.delete(
                        clientId
                    );

                    appendLog(
                        "WebRTC",
                        `Connection error for ${clientId}: ${error.message}`
                    );
                }
            );
    }

    function connectAllReceivers() {
        if (!capturedAudioTrack) {
            return;
        }

        for (
            const client of
            connectedClients.values()
        ) {
            if (
                client.role ===
                    "receiver" ||
                !client.role
            ) {
                connectReceiverAudio(
                    client.clientId
                );
            }
        }

        updateWebRTCUI();
    }

    function refreshAudioCapture() {
        if (!masterVideo) {
            return;
        }

        if (
            masterVideo.readyState <
            HTMLMediaElement.HAVE_METADATA
        ) {
            return;
        }

        /*
         * captureStream() must happen after the
         * video has loaded enough media.
         */

        captureMovieAudio();
    }

    // ============================================================
    // VIDEO URL MANAGEMENT
    // ============================================================

    function revokeCurrentBlobUrl() {
        if (!currentBlobUrl) {
            return;
        }

        try {
            URL.revokeObjectURL(
                currentBlobUrl
            );
        } catch (_) {}

        currentBlobUrl = null;
    }

    // ============================================================
    // LOCAL FILE LOAD
    // ============================================================

    function loadLocalFile(file) {
        if (!file) {
            return;
        }

        currentFile = file;

        appendLog(
            "Media",
            `Local file selected: ${file.name}`
        );

        /*
         * Stop previous capture before replacing
         * the video source.
         */

        stopCapturedStream();

        revokeCurrentBlobUrl();

        const objectUrl =
            URL.createObjectURL(
                file
            );

        currentBlobUrl =
            objectUrl;

        currentVideo = {
            videoId:
                `local-${Date.now()}`,

            videoName:
                file.name,

            videoUrl:
                objectUrl,

            duration: 0,

            fileSize:
                file.size,

            mimeType:
                file.type ||
                "video/mp4"
        };

        /*
         * Clear source first.
         *
         * This prevents Chrome from keeping an old
         * failed media source alive.
         */

        masterVideo.pause();

        masterVideo.removeAttribute(
            "src"
        );

        masterVideo.load();

        /*
         * Attach the NEW Blob URL.
         */

        masterVideo.src =
            objectUrl;

        /*
         * Important:
         * Do not call play() here.
         *
         * Let the user press Play.
         */

        masterVideo.load();

        if (videoEmptyState) {
            videoEmptyState.style.display =
                "none";
        }

        if (videoName) {
            videoName.textContent =
                file.name;
        }

        if (videoDuration) {
            videoDuration.textContent =
                "Loading...";
        }

        if (videoPosition) {
            videoPosition.textContent =
                "00:00";
        }

        appendLog(
            "Media",
            `Loaded local Blob URL for ${file.name}`
        );
    }

    // ============================================================
    // PATH LOAD
    // ============================================================

    async function loadFromPath() {
        const path =
            filePathInput
                ?.value
                ?.trim();

        if (!path) {
            return;
        }

        appendLog(
            "Media",
            `Requesting local path: ${path}`
        );

        try {
            const response =
                await fetch(
                    "/api/video/select",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/json"
                        },
                        body: JSON.stringify({
                            filePath: path
                        })
                    }
                );

            const data =
                await response.json();

            if (
                !response.ok ||
                !data.success ||
                !data.video
            ) {
                throw new Error(
                    data.detail ||
                    "Could not load video path."
                );
            }

            applyServerVideo(
                data.video
            );

            sendWs({
                type: "load",
                ...data.video
            });
        } catch (error) {
            appendLog(
                "Media",
                `Path load failed: ${error.message}`
            );

            alert(
                error.message
            );
        }
    }

    // ============================================================
    // SERVER VIDEO
    // ============================================================

    function applyServerVideo(
        video
    ) {
        stopCapturedStream();

        revokeCurrentBlobUrl();

        currentVideo = {
            videoId:
                video.videoId ||
                null,

            videoName:
                video.videoName ||
                "Movie",

            videoUrl:
                video.videoUrl ||
                "",

            duration:
                Number(video.duration) ||
                0,

            fileSize:
                Number(video.fileSize) ||
                0,

            mimeType:
                video.mimeType ||
                "video/mp4"
        };

        masterVideo.pause();

        masterVideo.removeAttribute(
            "src"
        );

        masterVideo.load();

        masterVideo.src =
            currentVideo.videoUrl;

        masterVideo.load();

        if (videoEmptyState) {
            videoEmptyState.style.display =
                "none";
        }

        if (videoName) {
            videoName.textContent =
                currentVideo.videoName;
        }

        appendLog(
            "Media",
            `Loaded movie: ${currentVideo.videoName}`
        );
    }

    // ============================================================
    // SAMPLE VIDEO
    // ============================================================

    async function loadSampleVideo() {
        /*
         * The project sample video is served by the
         * backend when this endpoint exists.
         *
         * First try the API.
         */

        try {
            const response =
                await fetch(
                    "/api/video/sample",
                    {
                        method: "POST"
                    }
                );

            if (response.ok) {
                const data =
                    await response.json();

                if (
                    data.success &&
                    data.video
                ) {
                    applyServerVideo(
                        data.video
                    );

                    sendWs({
                        type: "load",
                        ...data.video
                    });

                    return;
                }
            }
        } catch (_) {
            // Fall through to direct sample URL.
        }

        /*
         * Fallback:
         * sample_video.mp4 exists at project root.
         */

        stopCapturedStream();

        revokeCurrentBlobUrl();

        const sampleUrl =
            "/sample_video.mp4";

        currentVideo = {
            videoId:
                "sample-video",

            videoName:
                "Big Buck Bunny (Sample Demo)",

            videoUrl:
                sampleUrl,

            duration: 0,

            fileSize: 0,

            mimeType:
                "video/mp4"
        };

        masterVideo.pause();

        masterVideo.removeAttribute(
            "src"
        );

        masterVideo.load();

        masterVideo.src =
            sampleUrl;

        masterVideo.load();

        if (videoEmptyState) {
            videoEmptyState.style.display =
                "none";
        }

        if (videoName) {
            videoName.textContent =
                currentVideo.videoName;
        }

        appendLog(
            "Media",
            "Loaded sample video."
        );

        sendWs({
            type: "load",
            ...currentVideo
        });
    }

    // ============================================================
    // SEND LOAD STATE
    // ============================================================

    function sendCurrentLoadState() {
        if (
            !currentVideo.videoUrl
        ) {
            return;
        }

        sendWs({
            type: "load",

            videoId:
                currentVideo.videoId,

            videoName:
                currentVideo.videoName,

            videoUrl:
                currentVideo.videoUrl,

            duration:
                Number(
                    masterVideo.duration
                ) || 0,

            fileSize:
                currentVideo.fileSize,

            mimeType:
                currentVideo.mimeType
        });
    }

    // ============================================================
    // AUTHORITATIVE PLAYBACK
    // ============================================================

    function sendPlayCommand(
        position
    ) {
        if (
            !currentVideo.videoUrl
        ) {
            appendLog(
                "Playback",
                "No movie loaded."
            );

            return;
        }

        const currentTime =
            Number.isFinite(
                position
            )
                ? position
                : masterVideo.currentTime;

        const startAt =
            nowMs() +
            START_LEAD_MS;

        lastPlayCommandAt =
            Date.now();

        sendWs({
            type: "play",

            position:
                currentTime,

            currentTime:
                currentTime,

            startAt:
                startAt,

            playbackRate:
                masterVideo.playbackRate
        });

        appendLog(
            "Playback",
            `PLAY scheduled at ${formatTime(currentTime)}`
        );

        /*
         * Local master video follows the same future
         * start timestamp.
         */

        scheduleLocalPlay(
            startAt,
            currentTime
        );
    }

    function scheduleLocalPlay(
        startAt,
        position
    ) {
        const delay =
            Math.max(
                0,
                startAt - nowMs()
            );

        masterVideo.currentTime =
            Math.max(
                0,
                position
            );

        masterVideo.playbackRate =
            masterVideo.playbackRate ||
            1;

        window.setTimeout(
            () => {
                if (
                    destroyed ||
                    !masterVideo.src
                ) {
                    return;
                }

                masterVideo
                    .play()
                    .catch(
                        (error) => {
                            appendLog(
                                "Playback",
                                `Local play failed: ${error.message}`
                            );
                        }
                    );
            },
            delay
        );
    }

    function sendPauseCommand() {
        if (
            !currentVideo.videoUrl
        ) {
            return;
        }

        const position =
            masterVideo.currentTime;

        sendWs({
            type: "pause",

            position,

            currentTime:
                position
        });

        masterVideo.pause();

        appendLog(
            "Playback",
            `PAUSE at ${formatTime(position)}`
        );
    }

    function sendStopCommand() {
        if (
            !currentVideo.videoUrl
        ) {
            return;
        }

        const position = 0;

        sendWs({
            type: "stop",

            position,

            currentTime:
                position
        });

        masterVideo.pause();

        try {
            masterVideo.currentTime =
                0;
        } catch (_) {}

        appendLog(
            "Playback",
            "STOP"
        );
    }

    function sendRestartCommand() {
        if (
            !currentVideo.videoUrl
        ) {
            return;
        }

        const startAt =
            nowMs() +
            START_LEAD_MS;

        sendWs({
            type: "seek",

            position: 0,

            currentTime: 0
        });

        sendWs({
            type: "play",

            position: 0,

            currentTime: 0,

            startAt,

            playbackRate:
                masterVideo.playbackRate
        });

        masterVideo.currentTime =
            0;

        window.setTimeout(
            () => {
                masterVideo
                    .play()
                    .catch(
                        (error) => {
                            appendLog(
                                "Playback",
                                `Restart failed: ${error.message}`
                            );
                        }
                    );
            },
            Math.max(
                0,
                startAt - nowMs()
            )
        );

        appendLog(
            "Playback",
            "RESTART scheduled"
        );
    }

    function sendSeekCommand(
        position
    ) {
        if (
            !currentVideo.videoUrl
        ) {
            return;
        }

        const duration =
            Number(
                masterVideo.duration
            ) || 0;

        const safePosition =
            Math.max(
                0,
                duration > 0
                    ? Math.min(
                        position,
                        duration
                    )
                    : position
            );

        masterVideo.currentTime =
            safePosition;

        sendWs({
            type: "seek",

            position:
                safePosition,

            currentTime:
                safePosition
        });

        appendLog(
            "Playback",
            `SEEK → ${formatTime(safePosition)}`
        );
    }

    function sendRateCommand(
        rate
    ) {
        const safeRate =
            Number(rate) || 1;

        masterVideo.playbackRate =
            safeRate;

        sendWs({
            type: "setRate",

            playbackRate:
                safeRate
        });

        appendLog(
            "Playback",
            `Rate → ${safeRate}x`
        );
    }

    // ============================================================
    // VIDEO EVENT HANDLERS
    // ============================================================

    function handleLoadedMetadata() {
        const duration =
            Number(
                masterVideo.duration
            ) || 0;

        currentVideo.duration =
            duration;

        if (videoDuration) {
            videoDuration.textContent =
                formatTime(duration);
        }

        appendLog(
            "Media",
            `Metadata loaded. Duration: ${formatTime(duration)}`
        );

        /*
         * IMPORTANT:
         * Only capture after metadata is available.
         */

        refreshAudioCapture();

        sendCurrentLoadState();
    }

    function handleCanPlay() {
        appendLog(
            "Media",
            "Video is ready to play."
        );

        /*
         * Some browsers expose the capture stream
         * only after the media becomes playable.
         */

        if (!capturedAudioTrack) {
            refreshAudioCapture();
        }
    }

    function handleVideoError() {
        const error =
            masterVideo.error;

        if (!error) {
            return;
        }

        appendLog(
            "Media",
            `Host playback error: ${error.message || "Media format error"}`
        );

        setWebRTCStatus(
            "Video error",
            "The browser could not decode this media source."
        );
    }

    function handleEnded() {
        appendLog(
            "Playback",
            "Movie ended."
        );

        if (
            ws &&
            ws.readyState ===
                WebSocket.OPEN
        ) {
            sendWs({
                type: "stop",
                position:
                    masterVideo.duration ||
                    0
            });
        }
    }

    // ============================================================
    // VIDEO UI LOOP
    // ============================================================

    function updatePositionUI() {
        if (
            !masterVideo ||
            destroyed
        ) {
            return;
        }

        if (videoPosition) {
            videoPosition.textContent =
                formatTime(
                    masterVideo.currentTime
                );
        }

        window.requestAnimationFrame(
            updatePositionUI
        );
    }

    // ============================================================
    // CLIENT LIST
    // ============================================================

    function updateClients(
        clients
    ) {
        connectedClients.clear();

        if (
            Array.isArray(clients)
        ) {
            for (
                const client of clients
            ) {
                if (
                    !client ||
                    !client.clientId
                ) {
                    continue;
                }

                /*
                 * Host itself should not be
                 * treated as a receiver.
                 */

                if (
                    client.role === "host"
                ) {
                    continue;
                }

                connectedClients.set(
                    client.clientId,
                    client
                );
            }
        }

        renderClientList();

        /*
         * Critical:
         * If a receiver joined before a movie
         * was loaded, it gets connected here
         * after audio becomes available.
         */

        if (capturedAudioTrack) {
            connectAllReceivers();
        }

        updateWebRTCUI();
    }

    function renderClientList() {
        if (!clientList) {
            return;
        }

        if (
            connectedClients.size === 0
        ) {
            clientList.innerHTML =
                `
                <div class="empty-clients">
                    No receiver devices connected.
                </div>
                `;

            return;
        }

        clientList.innerHTML = "";

        for (
            const client of
            connectedClients.values()
        ) {
            const item =
                document.createElement(
                    "div"
                );

            item.className =
                "client-item";

            const name =
                client.deviceName ||
                `Phone (${String(
                    client.clientId
                ).slice(-4)})`;

            const state =
                webRtcConnectedTargets.has(
                    client.clientId
                )
                    ? "audio connected"
                    : "waiting";

            item.innerHTML =
                `
                <span class="client-name">
                    ${escapeHtml(name)}
                </span>

                <span class="client-state">
                    ${escapeHtml(state)}
                </span>
                `;

            clientList.appendChild(
                item
            );
        }
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    // ============================================================
    // SERVER MESSAGE HANDLER
    // ============================================================

    async function handleServerMessage(
        message
    ) {
        if (!message) {
            return;
        }

        switch (message.type) {
            case "welcome":
                appendLog(
                    "Signaling",
                    "Host registration successful."
                );

                if (
                    message.clients
                ) {
                    updateClients(
                        message.clients
                    );
                }

                if (
                    message.session
                ) {
                    applySessionState(
                        message.session
                    );
                }

                break;

            case "client-list":
                updateClients(
                    message.clients ||
                    []
                );
                break;

            case "session-state":
                applySessionState(
                    message
                );
                break;

            case "webrtc-offer":
            case "webrtc-answer":
            case "webrtc-candidate":
                if (
                    webrtcManager
                ) {
                    await webrtcManager
                        .handleSignalMessage(
                            message
                        );
                }

                break;

            case "error":
                appendLog(
                    "Server",
                    message.error ||
                        "Unknown server error."
                );
                break;

            default:
                break;
        }
    }

    // ============================================================
    // APPLY SESSION STATE
    // ============================================================

    function applySessionState(
        state
    ) {
        if (!state) {
            return;
        }

        if (
            state.roomId &&
            roomIdElement
        ) {
            roomIdElement.textContent =
                state.roomId;
        }

        if (
            state.videoName &&
            !currentFile
        ) {
            videoName.textContent =
                state.videoName;
        }

        /*
         * Do not replace the local Blob URL with a
         * remote session URL while the host owns a
         * local file.
         */

        if (
            state.duration !==
            undefined &&
            Number(state.duration) > 0
        ) {
            currentVideo.duration =
                Number(
                    state.duration
                );
        }
    }

    // ============================================================
    // WEBSOCKET
    // ============================================================

    function connectWebSocket() {
        if (destroyed) {
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

        appendLog(
            "WebSocket",
            `Connecting signaling server: ${wsUrl}`
        );

        setConnectionStatus(
            false,
            "Connecting..."
        );

        try {
            ws =
                new WebSocket(
                    wsUrl
                );
        } catch (error) {
            appendLog(
                "WebSocket",
                `Connection creation failed: ${error.message}`
            );

            scheduleReconnect();

            return;
        }

        ws.onopen = () => {
            appendLog(
                "WebSocket",
                "WebSocket connected."
            );

            setConnectionStatus(
                true,
                "LAN Connected"
            );

            sendWs({
                type: "host",

                token:
                    new URLSearchParams(
                        window.location.search
                    ).get("token") ||
                    DEFAULT_ROOM_TOKEN,

                clientId:
                    HOST_CLIENT_ID,

                deviceName:
                    "BeatSync Host",

                role:
                    "host"
            });

            startHeartbeat();
        };

        ws.onmessage =
            async (event) => {
                try {
                    const message =
                        JSON.parse(
                            event.data
                        );

                    await handleServerMessage(
                        message
                    );
                } catch (error) {
                    appendLog(
                        "WebSocket",
                        `Message error: ${error.message}`
                    );
                }
            };

        ws.onerror = () => {
            appendLog(
                "WebSocket",
                "WebSocket error."
            );
        };

        ws.onclose = () => {
            appendLog(
                "WebSocket",
                "WebSocket disconnected."
            );

            setConnectionStatus(
                false,
                "Disconnected"
            );

            stopHeartbeat();

            if (!destroyed) {
                scheduleReconnect();
            }
        };
    }

    function scheduleReconnect() {
        if (
            reconnectTimer ||
            destroyed
        ) {
            return;
        }

        reconnectTimer =
            window.setTimeout(
                () => {
                    reconnectTimer =
                        null;

                    connectWebSocket();
                },
                RECONNECT_DELAY_MS
            );
    }

    function startHeartbeat() {
        stopHeartbeat();

        heartbeatTimer =
            window.setInterval(
                () => {
                    sendWs({
                        type: "ping"
                    });
                },
                2500
            );
    }

    function stopHeartbeat() {
        if (
            heartbeatTimer
        ) {
            clearInterval(
                heartbeatTimer
            );

            heartbeatTimer =
                null;
        }
    }

    // ============================================================
    // BUTTONS
    // ============================================================

    if (localFileInput) {
        localFileInput.addEventListener(
            "change",
            () => {
                const file =
                    localFileInput.files?.[0];

                if (!file) {
                    return;
                }

                loadLocalFile(
                    file
                );
            }
        );
    }

    if (playBtn) {
        playBtn.addEventListener(
            "click",
            () => {
                if (
                    masterVideo.paused
                ) {
                    sendPlayCommand(
                        masterVideo.currentTime
                    );
                }
            }
        );
    }

    if (pauseBtn) {
        pauseBtn.addEventListener(
            "click",
            () => {
                sendPauseCommand();
            }
        );
    }

    if (stopBtn) {
        stopBtn.addEventListener(
            "click",
            () => {
                sendStopCommand();
            }
        );
    }

    if (restartBtn) {
        restartBtn.addEventListener(
            "click",
            () => {
                sendRestartCommand();
            }
        );
    }

    if (loadFromPathBtn) {
        loadFromPathBtn.addEventListener(
            "click",
            () => {
                loadFromPath();
            }
        );
    }

    if (sampleVideoBtn) {
        sampleVideoBtn.addEventListener(
            "click",
            () => {
                loadSampleVideo();
            }
        );
    }

    // ============================================================
    // VIDEO EVENTS
    // ============================================================

    if (masterVideo) {
        masterVideo.addEventListener(
            "loadedmetadata",
            handleLoadedMetadata
        );

        masterVideo.addEventListener(
            "canplay",
            handleCanPlay
        );

        masterVideo.addEventListener(
            "error",
            handleVideoError
        );

        masterVideo.addEventListener(
            "ended",
            handleEnded
        );

        masterVideo.addEventListener(
            "loadeddata",
            () => {
                if (
                    !capturedAudioTrack
                ) {
                    refreshAudioCapture();
                }
            }
        );
    }

    // ============================================================
    // KEYBOARD
    // ============================================================

    window.addEventListener(
        "keydown",
        (event) => {
            const tag =
                event.target?.tagName;

            if (
                tag === "INPUT" ||
                tag === "TEXTAREA" ||
                tag === "SELECT"
            ) {
                return;
            }

            if (
                event.code ===
                "Space"
            ) {
                event.preventDefault();

                if (
                    masterVideo.paused
                ) {
                    sendPlayCommand(
                        masterVideo.currentTime
                    );
                } else {
                    sendPauseCommand();
                }

                return;
            }

            if (
                event.code ===
                "ArrowLeft"
            ) {
                event.preventDefault();

                sendSeekCommand(
                    Math.max(
                        0,
                        masterVideo.currentTime -
                            10
                    )
                );

                return;
            }

            if (
                event.code ===
                "ArrowRight"
            ) {
                event.preventDefault();

                sendSeekCommand(
                    masterVideo.currentTime +
                        10
                );
            }
        }
    );

    // ============================================================
    // BEFORE UNLOAD
    // ============================================================

    window.addEventListener(
        "beforeunload",
        () => {
            destroyed = true;

            stopHeartbeat();

            if (
                reconnectTimer
            ) {
                clearTimeout(
                    reconnectTimer
                );
            }

            stopCapturedStream();

            if (webrtcManager) {
                try {
                    webrtcManager.destroy();
                } catch (_) {}
            }

            if (ws) {
                try {
                    ws.close();
                } catch (_) {}
            }

            revokeCurrentBlobUrl();
        }
    );

    // ============================================================
    // INITIALIZATION
    // ============================================================

    function initialize() {
        appendLog(
            "System",
            "BeatSync-Pro Host initialized. Protocol v2."
        );

        appendLog(
            "System",
            "WebRTC: Offline LAN"
        );

        appendLog(
            "System",
            "Signaling: WebSocket"
        );

        appendLog(
            "System",
            "Clock: Authoritative"
        );

        appendLog(
            "System",
            "Sync: Enabled"
        );

        if (roomIdElement) {
            roomIdElement.textContent =
                new URLSearchParams(
                    window.location.search
                ).get("room") ||
                "movie-night";
        }

        initializeWebRTC();

        connectWebSocket();

        updatePositionUI();

        updateWebRTCUI();
    }

    // ============================================================
    // DEBUG API
    // ============================================================

    window.BeatSyncHost = {
        getState() {
            return {
                connected:
                    ws?.readyState ===
                    WebSocket.OPEN,

                video:
                    currentVideo,

                videoCurrentTime:
                    masterVideo?.currentTime ||
                    0,

                videoDuration:
                    masterVideo?.duration ||
                    0,

                capturedAudio:
                    Boolean(
                        capturedAudioTrack
                    ),

                capturedAudioTrackId:
                    capturedAudioTrack?.id ||
                    null,

                clients:
                    Array.from(
                        connectedClients.values()
                    ),

                webRtcConnected:
                    Array.from(
                        webRtcConnectedTargets
                    ),

                webRtcDiagnostics:
                    webrtcManager
                        ?.getDiagnostics?.() ||
                    null
            };
        },

        captureAudio() {
            return captureMovieAudio();
        },

        connectReceiver(
            clientId
        ) {
            connectReceiverAudio(
                clientId
            );
        },

        sendPlay() {
            sendPlayCommand(
                masterVideo.currentTime
            );
        },

        sendPause() {
            sendPauseCommand();
        },

        sendStop() {
            sendStopCommand();
        },

        sendRestart() {
            sendRestartCommand();
        },

        sendSeek(
            position
        ) {
            sendSeekCommand(
                Number(position)
            );
        },

        sendRate(
            rate
        ) {
            sendRateCommand(
                Number(rate)
            );
        }
    };

    // ============================================================
    // START
    // ============================================================

    initialize();

})();