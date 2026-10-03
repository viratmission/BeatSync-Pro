/**
 * BeatSync-Pro
 * Offline LAN WebRTC Audio Manager
 *
 * Protocol v2
 *
 * Purpose:
 *     Host browser
 *         |
 *         | captured movie audio
 *         v
 *     WebRTC PeerConnection
 *         |
 *         | LAN
 *         v
 *     Receiver phone
 *
 * Important:
 *     WebRTC offers are NOT created until a local audio track exists.
 *
 * This prevents Chrome from throwing:
 *
 *     ERROR_CONTENT
 *     max-bundle configured but session description has no BUNDLE group
 *
 * No STUN/TURN servers are used.
 */

(function (global) {
    "use strict";

    const PROTOCOL_VERSION = 2;

    const ICE_SERVERS = [];

    const CONNECTION_TIMEOUT_MS = 15000;

    const OFFER_RETRY_DELAY_MS = 500;

    class OfflineWebRTCManager {
        constructor(isHost, clientId, sendMessage) {
            this.isHost = Boolean(isHost);

            this.clientId =
                clientId ||
                `client-${Math.random().toString(36).slice(2, 10)}`;

            this.sendMessage =
                typeof sendMessage === "function"
                    ? sendMessage
                    : () => {};

            this.peers = new Map();

            this.localMediaStream = null;

            this.localAudioTrack = null;

            this.pendingTargets = new Set();

            this.isDestroyed = false;

            this.onRemoteStream = null;
            this.onPeerStateChange = null;
            this.onPeerConnected = null;
            this.onPeerDisconnected = null;
            this.onError = null;

            this.debugEnabled = true;

            this.log(
                `OfflineWebRTCManager initialized. role=${
                    this.isHost ? "host" : "receiver"
                }, clientId=${this.clientId}`
            );
        }

        // ============================================================
        // Logging
        // ============================================================

        log(...args) {
            if (!this.debugEnabled) {
                return;
            }

            console.log("[BeatSync WebRTC]", ...args);
        }

        warn(...args) {
            console.warn("[BeatSync WebRTC]", ...args);
        }

        error(...args) {
            console.error("[BeatSync WebRTC]", ...args);
        }

        reportError(error, context = "") {
            this.error(context, error);

            if (typeof this.onError === "function") {
                try {
                    this.onError(error, context);
                } catch (callbackError) {
                    this.error(
                        "onError callback failed:",
                        callbackError
                    );
                }
            }
        }

        // ============================================================
        // Utility
        // ============================================================

        normalizeClientId(clientId) {
            if (!clientId) {
                return "";
            }

            return String(clientId);
        }

        safeSend(message) {
            if (this.isDestroyed) {
                return false;
            }

            try {
                this.sendMessage({
                    version: PROTOCOL_VERSION,
                    ...message
                });

                return true;
            } catch (error) {
                this.reportError(error, "Failed to send signaling message");
                return false;
            }
        }

        getPeer(targetId) {
            return this.peers.get(
                this.normalizeClientId(targetId)
            );
        }

        hasPeer(targetId) {
            return this.peers.has(
                this.normalizeClientId(targetId)
            );
        }

        // ============================================================
        // Peer creation
        // ============================================================

        createPeer(targetId) {
            const normalizedTarget =
                this.normalizeClientId(targetId);

            if (!normalizedTarget) {
                throw new Error(
                    "Cannot create WebRTC peer without targetId."
                );
            }

            if (this.peers.has(normalizedTarget)) {
                return this.peers.get(normalizedTarget);
            }

            const peerConnection =
                new RTCPeerConnection({
                    iceServers: ICE_SERVERS,
                    bundlePolicy: "max-bundle",
                    rtcpMuxPolicy: "require"
                });

            const peer = {
                targetId: normalizedTarget,
                pc: peerConnection,

                remoteStream: null,

                pendingCandidates: [],

                makingOffer: false,

                offerInProgress: false,

                offerCreated: false,

                answerReceived: false,

                connected: false,

                connectionTimer: null,

                lastOfferAt: 0,

                destroyed: false
            };

            this.peers.set(
                normalizedTarget,
                peer
            );

            // --------------------------------------------------------
            // ICE candidates
            // --------------------------------------------------------

            peerConnection.onicecandidate = (event) => {
                if (!event.candidate) {
                    return;
                }

                this.safeSend({
                    type: "webrtc-candidate",

                    targetId: normalizedTarget,

                    clientId: this.clientId,

                    payload: {
                        candidate:
                            event.candidate.toJSON
                                ? event.candidate.toJSON()
                                : event.candidate
                    }
                });
            };

            // --------------------------------------------------------
            // ICE gathering
            // --------------------------------------------------------

            peerConnection.onicegatheringstatechange = () => {
                this.log(
                    `ICE gathering [${normalizedTarget}]:`,
                    peerConnection.iceGatheringState
                );
            };

            // --------------------------------------------------------
            // ICE connection
            // --------------------------------------------------------

            peerConnection.oniceconnectionstatechange = () => {
                const state =
                    peerConnection.iceConnectionState;

                this.log(
                    `ICE connection [${normalizedTarget}]:`,
                    state
                );

                this.handlePeerState(
                    peer,
                    state
                );
            };

            // --------------------------------------------------------
            // Overall connection state
            // --------------------------------------------------------

            peerConnection.onconnectionstatechange = () => {
                const state =
                    peerConnection.connectionState;

                this.log(
                    `Connection state [${normalizedTarget}]:`,
                    state
                );

                if (
                    state === "connected"
                ) {
                    this.markPeerConnected(peer);
                }

                if (
                    state === "failed" ||
                    state === "closed"
                ) {
                    this.markPeerDisconnected(peer);
                }

                if (
                    state === "disconnected"
                ) {
                    this.emitPeerState(
                        normalizedTarget,
                        state
                    );
                }
            };

            // --------------------------------------------------------
            // Signaling state
            // --------------------------------------------------------

            peerConnection.onsignalingstatechange = () => {
                this.log(
                    `Signaling state [${normalizedTarget}]:`,
                    peerConnection.signalingState
                );
            };

            // --------------------------------------------------------
            // Remote media
            // --------------------------------------------------------

            peerConnection.ontrack = (event) => {
                this.log(
                    `Remote track received from ${normalizedTarget}.`
                );

                let stream = event.streams?.[0];

                if (!stream) {
                    stream =
                        new MediaStream([
                            event.track
                        ]);
                }

                peer.remoteStream = stream;

                if (
                    typeof this.onRemoteStream ===
                    "function"
                ) {
                    try {
                        this.onRemoteStream(
                            stream,
                            normalizedTarget,
                            event
                        );
                    } catch (callbackError) {
                        this.error(
                            "onRemoteStream callback failed:",
                            callbackError
                        );
                    }
                }
            };

            this.emitPeerState(
                normalizedTarget,
                "new"
            );

            return peer;
        }

        // ============================================================
        // Local media
        // ============================================================

        setLocalMediaStream(stream) {
            if (this.isDestroyed) {
                return;
            }

            this.log(
                "setLocalMediaStream()",
                stream
            );

            this.localMediaStream = stream || null;

            const audioTracks =
                stream
                    ? stream.getAudioTracks()
                    : [];

            const newAudioTrack =
                audioTracks.length > 0
                    ? audioTracks[0]
                    : null;

            if (!newAudioTrack) {
                this.localAudioTrack = null;

                this.warn(
                    "Local media stream has no audio track. WebRTC offers will wait."
                );

                return;
            }

            const previousTrack =
                this.localAudioTrack;

            this.localAudioTrack =
                newAudioTrack;

            this.log(
                "Local audio track ready:",
                newAudioTrack.id
            );

            // --------------------------------------------------------
            // Attach/replace track on all existing peers.
            // --------------------------------------------------------

            for (const peer of this.peers.values()) {
                this.attachAudioTrack(
                    peer,
                    newAudioTrack,
                    previousTrack
                );
            }

            // --------------------------------------------------------
            // Any receivers that joined before the movie started
            // are waiting here.
            // --------------------------------------------------------

            if (this.pendingTargets.size > 0) {
                const pending =
                    Array.from(
                        this.pendingTargets
                    );

                this.pendingTargets.clear();

                for (const targetId of pending) {
                    this.createOfferFor(targetId)
                        .catch((error) => {
                            this.reportError(
                                error,
                                `Failed to create delayed offer for ${targetId}`
                            );
                        });
                }
            }
        }

        clearLocalMediaStream() {
            this.localMediaStream = null;
            this.localAudioTrack = null;

            this.log(
                "Local media stream cleared."
            );
        }

        hasLocalAudio() {
            return Boolean(
                this.localAudioTrack &&
                this.localAudioTrack.readyState !== "ended"
            );
        }

        // ============================================================
        // Attach audio track
        // ============================================================

        attachAudioTrack(
            peer,
            audioTrack,
            previousTrack = null
        ) {
            if (
                !peer ||
                !peer.pc ||
                peer.destroyed
            ) {
                return;
            }

            if (!audioTrack) {
                return;
            }

            const senders =
                peer.pc.getSenders();

            const audioSender =
                senders.find(
                    (sender) =>
                        sender.track &&
                        sender.track.kind === "audio"
                );

            // --------------------------------------------------------
            // Existing sender.
            // --------------------------------------------------------

            if (audioSender) {
                if (
                    audioSender.track?.id !==
                    audioTrack.id
                ) {
                    audioSender
                        .replaceTrack(audioTrack)
                        .then(() => {
                            this.log(
                                `Audio track replaced for ${peer.targetId}.`
                            );
                        })
                        .catch((error) => {
                            this.reportError(
                                error,
                                `replaceTrack failed for ${peer.targetId}`
                            );
                        });
                }

                return;
            }

            // --------------------------------------------------------
            // No audio sender yet.
            // --------------------------------------------------------

            try {
                peer.pc.addTrack(
                    audioTrack,
                    this.localMediaStream ||
                    new MediaStream([
                        audioTrack
                    ])
                );

                this.log(
                    `Audio track attached to ${peer.targetId}.`
                );
            } catch (error) {
                this.reportError(
                    error,
                    `addTrack failed for ${peer.targetId}`
                );
            }
        }

        // ============================================================
        // Connect receiver
        // ============================================================

        connectToReceiver(targetId) {
            const normalizedTarget =
                this.normalizeClientId(targetId);

            if (!normalizedTarget) {
                return;
            }

            this.log(
                `connectToReceiver(${normalizedTarget})`
            );

            // --------------------------------------------------------
            // Critical:
            //
            // Do NOT create an offer until an audio track exists.
            // --------------------------------------------------------

            if (!this.hasLocalAudio()) {
                this.warn(
                    `Audio not ready. Queuing receiver ${normalizedTarget}.`
                );

                this.pendingTargets.add(
                    normalizedTarget
                );

                // Create the peer object now so that when
                // audio becomes available the track can be attached.
                this.createPeer(
                    normalizedTarget
                );

                return;
            }

            this.createOfferFor(
                normalizedTarget
            ).catch((error) => {
                this.reportError(
                    error,
                    `connectToReceiver failed for ${normalizedTarget}`
                );
            });
        }

        // Compatibility alias used by host.js.
        connectReceiverAudio(targetId) {
            return this.connectToReceiver(
                targetId
            );
        }

        // ============================================================
        // Create offer
        // ============================================================

        async createOfferFor(targetId) {
            const normalizedTarget =
                this.normalizeClientId(targetId);

            if (!normalizedTarget) {
                return;
            }

            // --------------------------------------------------------
            // Critical safety check.
            // --------------------------------------------------------

            if (!this.hasLocalAudio()) {
                this.warn(
                    `Cannot create offer for ${normalizedTarget}: audio track is not ready.`
                );

                this.pendingTargets.add(
                    normalizedTarget
                );

                return;
            }

            const peer =
                this.createPeer(
                    normalizedTarget
                );

            // --------------------------------------------------------
            // Avoid duplicate offer creation.
            // --------------------------------------------------------

            if (peer.offerInProgress) {
                this.log(
                    `Offer already in progress for ${normalizedTarget}.`
                );

                return;
            }

            if (
                peer.pc.signalingState !==
                "stable"
            ) {
                this.log(
                    `Skipping offer for ${normalizedTarget}; signaling state is ${peer.pc.signalingState}.`
                );

                return;
            }

            // --------------------------------------------------------
            // Make absolutely sure audio is attached before offer.
            // --------------------------------------------------------

            this.attachAudioTrack(
                peer,
                this.localAudioTrack
            );

            const audioSenders =
                peer.pc
                    .getSenders()
                    .filter(
                        (sender) =>
                            sender.track &&
                            sender.track.kind ===
                                "audio"
                    );

            if (
                audioSenders.length === 0
            ) {
                this.warn(
                    `No audio sender exists for ${normalizedTarget}; delaying offer.`
                );

                this.pendingTargets.add(
                    normalizedTarget
                );

                return;
            }

            // --------------------------------------------------------
            // Offer creation.
            // --------------------------------------------------------

            peer.offerInProgress = true;

            try {
                const now = Date.now();

                if (
                    now - peer.lastOfferAt <
                    OFFER_RETRY_DELAY_MS
                ) {
                    await new Promise(
                        (resolve) =>
                            setTimeout(
                                resolve,
                                OFFER_RETRY_DELAY_MS
                            )
                    );
                }

                const offer =
                    await peer.pc.createOffer({
                        offerToReceiveAudio: false,
                        offerToReceiveVideo: false
                    });

                await peer.pc.setLocalDescription(
                    offer
                );

                peer.offerCreated = true;

                peer.lastOfferAt =
                    Date.now();

                this.log(
                    `WebRTC offer created for ${normalizedTarget}.`
                );

                this.safeSend({
                    type: "webrtc-offer",

                    targetId:
                        normalizedTarget,

                    clientId:
                        this.clientId,

                    payload: {
                        description:
                            peer.pc.localDescription
                    }
                });

                this.startConnectionTimeout(
                    peer
                );
            } catch (error) {
                this.reportError(
                    error,
                    `createOffer failed for ${normalizedTarget}`
                );

                throw error;
            } finally {
                peer.offerInProgress =
                    false;
            }
        }

        // ============================================================
        // Renegotiation
        // ============================================================

        async renegotiate(targetId) {
            const normalizedTarget =
                this.normalizeClientId(targetId);

            if (!this.hasLocalAudio()) {
                this.warn(
                    `Cannot renegotiate ${normalizedTarget}: audio is not ready.`
                );

                this.pendingTargets.add(
                    normalizedTarget
                );

                return;
            }

            const peer =
                this.createPeer(
                    normalizedTarget
                );

            if (
                peer.pc.signalingState !==
                "stable"
            ) {
                this.log(
                    `Renegotiation skipped for ${normalizedTarget}; state=${peer.pc.signalingState}`
                );

                return;
            }

            this.attachAudioTrack(
                peer,
                this.localAudioTrack
            );

            await this.createOfferFor(
                normalizedTarget
            );
        }

        // ============================================================
        // Handle offer
        // ============================================================

        async handleOffer(message) {
            const payload =
                message?.payload || {};

            const description =
                payload.description ||
                message.description ||
                payload.offer ||
                message.offer;

            const senderId =
                message.clientId ||
                message.senderId ||
                message.from;

            if (!description) {
                this.warn(
                    "Received WebRTC offer without description."
                );

                return;
            }

            if (!senderId) {
                this.warn(
                    "Received WebRTC offer without sender ID."
                );

                return;
            }

            const peer =
                this.createPeer(
                    senderId
                );

            try {
                await peer.pc.setRemoteDescription(
                    new RTCSessionDescription(
                        description
                    )
                );

                await this.flushPendingCandidates(
                    peer
                );

                const answer =
                    await peer.pc.createAnswer();

                await peer.pc.setLocalDescription(
                    answer
                );

                peer.answerReceived = true;

                this.safeSend({
                    type: "webrtc-answer",

                    targetId: senderId,

                    clientId: this.clientId,

                    payload: {
                        description:
                            peer.pc.localDescription
                    }
                });

                this.log(
                    `WebRTC answer created for ${senderId}.`
                );

                this.startConnectionTimeout(
                    peer
                );
            } catch (error) {
                this.reportError(
                    error,
                    `Failed to handle WebRTC offer from ${senderId}`
                );
            }
        }

        // ============================================================
        // Handle answer
        // ============================================================

        async handleAnswer(message) {
            const payload =
                message?.payload || {};

            const description =
                payload.description ||
                message.description ||
                payload.answer ||
                message.answer;

            const senderId =
                message.clientId ||
                message.senderId ||
                message.from;

            if (!description) {
                this.warn(
                    "Received WebRTC answer without description."
                );

                return;
            }

            if (!senderId) {
                this.warn(
                    "Received WebRTC answer without sender ID."
                );

                return;
            }

            const peer =
                this.getPeer(
                    senderId
                );

            if (!peer) {
                this.warn(
                    `No peer found for answer from ${senderId}.`
                );

                return;
            }

            try {
                await peer.pc.setRemoteDescription(
                    new RTCSessionDescription(
                        description
                    )
                );

                await this.flushPendingCandidates(
                    peer
                );

                this.log(
                    `WebRTC answer applied from ${senderId}.`
                );

                this.startConnectionTimeout(
                    peer
                );
            } catch (error) {
                this.reportError(
                    error,
                    `Failed to handle WebRTC answer from ${senderId}`
                );
            }
        }

        // ============================================================
        // Handle ICE candidate
        // ============================================================

        async handleCandidate(message) {
            const payload =
                message?.payload || {};

            const candidate =
                payload.candidate ||
                message.candidate;

            const senderId =
                message.clientId ||
                message.senderId ||
                message.from;

            if (!candidate) {
                return;
            }

            if (!senderId) {
                this.warn(
                    "ICE candidate has no sender ID."
                );

                return;
            }

            const peer =
                this.createPeer(
                    senderId
                );

            // --------------------------------------------------------
            // Remote description may not exist yet.
            // Queue candidate until it does.
            // --------------------------------------------------------

            if (
                !peer.pc.remoteDescription
            ) {
                peer.pendingCandidates.push(
                    candidate
                );

                this.log(
                    `Queued ICE candidate for ${senderId}.`
                );

                return;
            }

            try {
                await peer.pc.addIceCandidate(
                    new RTCIceCandidate(
                        candidate
                    )
                );

                this.log(
                    `ICE candidate applied for ${senderId}.`
                );
            } catch (error) {
                this.reportError(
                    error,
                    `Failed to add ICE candidate for ${senderId}`
                );
            }
        }

        // ============================================================
        // Flush queued ICE candidates
        // ============================================================

        async flushPendingCandidates(peer) {
            if (
                !peer ||
                !peer.pc.remoteDescription
            ) {
                return;
            }

            if (
                peer.pendingCandidates.length ===
                0
            ) {
                return;
            }

            const candidates =
                peer.pendingCandidates.splice(
                    0
                );

            for (const candidate of candidates) {
                try {
                    await peer.pc.addIceCandidate(
                        new RTCIceCandidate(
                            candidate
                        )
                    );
                } catch (error) {
                    this.reportError(
                        error,
                        `Failed to flush ICE candidate for ${peer.targetId}`
                    );
                }
            }

            this.log(
                `Flushed ${candidates.length} ICE candidates for ${peer.targetId}.`
            );
        }

        // ============================================================
        // Unified signaling message handler
        // ============================================================

        async handleSignalMessage(message) {
            if (!message) {
                return;
            }

            const version =
                Number(
                    message.version ??
                    PROTOCOL_VERSION
                );

            if (
                version !==
                PROTOCOL_VERSION
            ) {
                this.warn(
                    `Ignoring WebRTC message with protocol version ${version}.`
                );

                return;
            }

            switch (message.type) {
                case "webrtc-offer":
                    await this.handleOffer(
                        message
                    );
                    break;

                case "webrtc-answer":
                    await this.handleAnswer(
                        message
                    );
                    break;

                case "webrtc-candidate":
                    await this.handleCandidate(
                        message
                    );
                    break;

                default:
                    break;
            }
        }

        // Compatibility aliases.

        handleWebRTCOffer(message) {
            return this.handleOffer(
                message
            );
        }

        handleWebRTCAnswer(message) {
            return this.handleAnswer(
                message
            );
        }

        handleWebRTCCandidate(message) {
            return this.handleCandidate(
                message
            );
        }

        // ============================================================
        // Peer state
        // ============================================================

        handlePeerState(
            peer,
            iceState
        ) {
            if (!peer) {
                return;
            }

            if (
                iceState === "connected" ||
                iceState === "completed"
            ) {
                this.markPeerConnected(
                    peer
                );

                return;
            }

            if (
                iceState === "failed" ||
                iceState === "closed"
            ) {
                this.markPeerDisconnected(
                    peer
                );

                return;
            }

            this.emitPeerState(
                peer.targetId,
                iceState
            );
        }

        markPeerConnected(peer) {
            if (!peer || peer.destroyed) {
                return;
            }

            if (peer.connected) {
                return;
            }

            peer.connected = true;

            this.clearConnectionTimeout(
                peer
            );

            this.log(
                `WebRTC connected: ${peer.targetId}`
            );

            this.emitPeerState(
                peer.targetId,
                "connected"
            );

            if (
                typeof this.onPeerConnected ===
                "function"
            ) {
                try {
                    this.onPeerConnected(
                        peer.targetId,
                        peer
                    );
                } catch (error) {
                    this.error(
                        "onPeerConnected callback failed:",
                        error
                    );
                }
            }
        }

        markPeerDisconnected(peer) {
            if (!peer) {
                return;
            }

            const wasConnected =
                peer.connected;

            peer.connected = false;

            this.clearConnectionTimeout(
                peer
            );

            this.emitPeerState(
                peer.targetId,
                "disconnected"
            );

            if (
                wasConnected &&
                typeof this.onPeerDisconnected ===
                    "function"
            ) {
                try {
                    this.onPeerDisconnected(
                        peer.targetId,
                        peer
                    );
                } catch (error) {
                    this.error(
                        "onPeerDisconnected callback failed:",
                        error
                    );
                }
            }
        }

        emitPeerState(
            targetId,
            state
        ) {
            if (
                typeof this.onPeerStateChange !==
                "function"
            ) {
                return;
            }

            try {
                this.onPeerStateChange(
                    targetId,
                    state
                );
            } catch (error) {
                this.error(
                    "onPeerStateChange callback failed:",
                    error
                );
            }
        }

        // ============================================================
        // Connection timeout
        // ============================================================

        startConnectionTimeout(peer) {
            if (!peer) {
                return;
            }

            this.clearConnectionTimeout(
                peer
            );

            peer.connectionTimer =
                setTimeout(() => {
                    if (
                        peer.connected ||
                        peer.destroyed
                    ) {
                        return;
                    }

                    this.warn(
                        `WebRTC connection timeout: ${peer.targetId}`
                    );

                    this.emitPeerState(
                        peer.targetId,
                        "timeout"
                    );
                }, CONNECTION_TIMEOUT_MS);
        }

        clearConnectionTimeout(peer) {
            if (
                peer?.connectionTimer
            ) {
                clearTimeout(
                    peer.connectionTimer
                );

                peer.connectionTimer =
                    null;
            }
        }

        // ============================================================
        // Peer cleanup
        // ============================================================

        closePeer(targetId) {
            const normalizedTarget =
                this.normalizeClientId(targetId);

            const peer =
                this.peers.get(
                    normalizedTarget
                );

            if (!peer) {
                return;
            }

            peer.destroyed = true;

            this.clearConnectionTimeout(
                peer
            );

            try {
                peer.pc.close();
            } catch (error) {
                this.warn(
                    "Peer close error:",
                    error
                );
            }

            this.peers.delete(
                normalizedTarget
            );

            this.pendingTargets.delete(
                normalizedTarget
            );

            this.log(
                `Peer closed: ${normalizedTarget}`
            );
        }

        disconnect(targetId) {
            this.closePeer(
                targetId
            );
        }

        closeAllPeers() {
            const ids =
                Array.from(
                    this.peers.keys()
                );

            for (const id of ids) {
                this.closePeer(id);
            }
        }

        // ============================================================
        // Diagnostics
        // ============================================================

        getPeerState(targetId) {
            const peer =
                this.getPeer(
                    targetId
                );

            if (!peer) {
                return null;
            }

            return {
                targetId:
                    peer.targetId,

                connected:
                    peer.connected,

                connectionState:
                    peer.pc.connectionState,

                iceConnectionState:
                    peer.pc.iceConnectionState,

                iceGatheringState:
                    peer.pc.iceGatheringState,

                signalingState:
                    peer.pc.signalingState,

                hasRemoteDescription:
                    Boolean(
                        peer.pc.remoteDescription
                    ),

                hasLocalDescription:
                    Boolean(
                        peer.pc.localDescription
                    ),

                audioSenders:
                    peer.pc
                        .getSenders()
                        .filter(
                            (sender) =>
                                sender.track &&
                                sender.track.kind ===
                                    "audio"
                        )
                        .length,

                remoteTracks:
                    peer.pc
                        .getReceivers()
                        .filter(
                            (receiver) =>
                                receiver.track
                        )
                        .length
            };
        }

        getDiagnostics() {
            const peers = {};

            for (const [
                targetId
            ] of this.peers) {
                peers[targetId] =
                    this.getPeerState(
                        targetId
                    );
            }

            return {
                protocolVersion:
                    PROTOCOL_VERSION,

                role:
                    this.isHost
                        ? "host"
                        : "receiver",

                clientId:
                    this.clientId,

                localStream:
                    Boolean(
                        this.localMediaStream
                    ),

                localAudioTrack:
                    Boolean(
                        this.localAudioTrack
                    ),

                localAudioTrackId:
                    this.localAudioTrack?.id ||
                    null,

                localAudioTrackState:
                    this.localAudioTrack
                        ?.readyState ||
                    null,

                pendingTargets:
                    Array.from(
                        this.pendingTargets
                    ),

                peerCount:
                    this.peers.size,

                peers
            };
        }

        // ============================================================
        // Destroy
        // ============================================================

        destroy() {
            if (this.isDestroyed) {
                return;
            }

            this.isDestroyed = true;

            this.closeAllPeers();

            this.pendingTargets.clear();

            this.localMediaStream =
                null;

            this.localAudioTrack =
                null;

            this.log(
                "OfflineWebRTCManager destroyed."
            );
        }
    }

    // ================================================================
    // Global export
    // ================================================================

    global.OfflineWebRTCManager =
        OfflineWebRTCManager;

    // CommonJS compatibility
    if (
        typeof module !== "undefined" &&
        module.exports
    ) {
        module.exports =
            OfflineWebRTCManager;
    }

})(window);