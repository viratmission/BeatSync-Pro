/**
 * BeatSync-Pro Offline LAN WebRTC Fallback Manager
 * Compliant with 100% offline local network operation.
 * NEVER connects to external STUN/TURN servers.
 */

class OfflineWebRTCManager {
  constructor(isHost, clientId, wsSender) {
    this.isHost = isHost;
    this.clientId = clientId;
    this.send = wsSender;
    // Strictly LAN offline configuration: NO STUN / NO TURN
    this.peerConnectionConfig = {
      iceServers: []
    };
    this.peers = new Map(); // targetId -> RTCPeerConnection
    this.localStream = null;
    this.onRemoteStream = null;
  }

  setLocalMediaStream(stream) {
    this.localStream = stream;
  }

  getOrCreatePeer(targetId) {
    if (this.peers.has(targetId)) {
      return this.peers.get(targetId);
    }

    const pc = new RTCPeerConnection(this.peerConnectionConfig);

    // Host candidate gathering only (offline LAN)
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.send({
          version: 1,
          type: "webrtc-candidate",
          targetId: targetId,
          candidate: event.candidate
        });
      }
    };

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0] && typeof this.onRemoteStream === 'function') {
        this.onRemoteStream(event.streams[0], targetId);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Peer ${targetId} state:`, pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.cleanupPeer(targetId);
      }
    };

    // Attach local audio/video tracks if host
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    this.peers.set(targetId, pc);
    return pc;
  }

  async createOfferFor(targetId) {
    const pc = this.getOrCreatePeer(targetId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.send({
      version: 1,
      type: "webrtc-offer",
      targetId: targetId,
      sdp: pc.localDescription
    });
  }

  async handleOffer(msg) {
    const senderId = msg.senderId;
    const pc = this.getOrCreatePeer(senderId);
    await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.send({
      version: 1,
      type: "webrtc-answer",
      targetId: senderId,
      sdp: pc.localDescription
    });
  }

  async handleAnswer(msg) {
    const senderId = msg.senderId;
    if (this.peers.has(senderId)) {
      const pc = this.peers.get(senderId);
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    }
  }

  async handleCandidate(msg) {
    const senderId = msg.senderId;
    if (this.peers.has(senderId) && msg.candidate) {
      const pc = this.peers.get(senderId);
      try {
        await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
      } catch (e) {
        console.warn("[WebRTC] Could not add candidate:", e);
      }
    }
  }

  cleanupPeer(targetId) {
    if (this.peers.has(targetId)) {
      const pc = this.peers.get(targetId);
      pc.close();
      this.peers.delete(targetId);
    }
  }

  destroy() {
    this.peers.forEach(pc => pc.close());
    this.peers.clear();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OfflineWebRTCManager };
}
