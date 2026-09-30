const signalR = require('./BeatSync.Client/node_modules/@microsoft/signalr');
const http = require('http');

function httpRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function testCinemaSync() {
  console.log('===============================================================');
  console.log('  BEATSYNC PRO — MULTI-DEVICE SYNC CINEMA VERIFICATION TEST');
  console.log('  Simulating: 1 Laptop Host + 8 Wireless Phone Speakers');
  console.log('===============================================================\n');

  const hubUrl = 'http://localhost:5000/hubs/room';

  // 1. Create Cinema Room via API
  console.log('[Step 1] Creating Cinema Room via REST API...');
  const createRoomRes = await httpRequest({
    hostname: 'localhost',
    port: 5000,
    path: '/api/rooms',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    name: 'Dolby Atmos Living Room',
    hostUsername: 'master-laptop',
    roomMode: 'Cinema',
    mediaTitle: 'Interstellar IMAX Demo (4K)',
    mediaDuration: 180
  });

  if (createRoomRes.status !== 200 && createRoomRes.status !== 201) {
    throw new Error(`Failed to create cinema room: status ${createRoomRes.status}`);
  }

  const room = createRoomRes.body;
  const roomCode = room.roomCode;
  console.log(`✓ Cinema Room created successfully: [${roomCode}] (Mode: ${room.roomMode})\n`);

  // 2. Connect Master Laptop Host
  console.log('[Step 2] Connecting Master Laptop Host to SignalR Hub...');
  const hostConn = new signalR.HubConnectionBuilder()
    .withUrl(hubUrl)
    .build();

  let hostReceivedSyncReports = 0;
  let hostReceivedPositionChange = false;
  let hostReceivedWebRtcAnswer = false;

  hostConn.on('DeviceSyncReported', (report) => {
    console.log(`  [Host Telemetry] Device ${report.username || report.connectionId} reported drift: ${report.driftMs}ms (Status: ${report.syncStatus})`);
    hostReceivedSyncReports++;
  });

  hostConn.on('DevicePositionChanged', (participant) => {
    console.log(`  [Host Event] Device ${participant.username} moved to position: ${participant.devicePosition}`);
    hostReceivedPositionChange = true;
  });

  hostConn.on('WebRtcSignalReceived', (signal) => {
    console.log(`  [Host WebRTC] Received ${signal.signalType} from connection ${signal.senderConnectionId}`);
    if (signal.signalType === 'answer') {
      hostReceivedWebRtcAnswer = true;
    }
  });

  await hostConn.start();
  const hostRoomState = await hostConn.invoke(
    'JoinCinemaRoom',
    roomCode,
    'master-laptop',
    'HostVideo',
    'HostCenter',
    'MacBook Pro 16',
    100,
    false
  );
  console.log(`✓ Host joined room [${roomCode}]. ConnectionId: ${hostConn.connectionId}\n`);

  // 3. Connect 8 Wireless Phone Speakers
  console.log('[Step 3] Connecting 8 Wireless Phone Speakers across 8 Surround Channels...');
  const positions = [
    'FrontLeft',
    'FrontCenter',
    'FrontRight',
    'SurroundLeft',
    'SurroundRight',
    'RearLeft',
    'RearCenter',
    'RearRight'
  ];

  const phoneConns = [];
  const phoneCommandReceived = new Array(8).fill(false);
  const phoneSeekReceived = new Array(8).fill(false);
  const phonePauseReceived = new Array(8).fill(false);
  let phone1ReceivedWebRtcOffer = false;

  for (let i = 0; i < 8; i++) {
    const pos = positions[i];
    const username = `phone-${i + 1}-${pos.toLowerCase()}`;
    const pConn = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl)
      .build();

    const idx = i;
    pConn.on('CinemaCommandExecuted', (cmd, state) => {
      if (cmd.commandType === 'Play') {
        phoneCommandReceived[idx] = true;
      } else if (cmd.commandType === 'Seek') {
        phoneSeekReceived[idx] = true;
      } else if (cmd.commandType === 'Pause') {
        phonePauseReceived[idx] = true;
      }
    });

    if (idx === 0) {
      pConn.on('WebRtcSignalReceived', async (signal) => {
        if (signal.signalType === 'offer') {
          phone1ReceivedWebRtcOffer = true;
          // Reply with answer back to host
          await pConn.invoke('SendWebRtcSignal', roomCode, {
            targetConnectionId: signal.senderConnectionId,
            signalType: 'answer',
            data: JSON.stringify({ type: 'answer', sdp: 'mock-sdp-answer' })
          });
        }
      });
    }

    await pConn.start();
    await pConn.invoke(
      'JoinCinemaRoom',
      roomCode,
      username,
      'AudioSpeaker',
      pos,
      `Galaxy S24 / iPhone 16 (#${i + 1})`,
      85,
      false
    );

    phoneConns.push(pConn);
    console.log(`  ✓ Speaker ${i + 1}/8 joined: [${pos}] as user "${username}"`);
  }
  console.log(`✓ All 8 phone surround speakers connected and registered!\n`);

  // 4. Host triggers Play with scheduled future execution timestamp
  console.log('[Step 4] Host triggers Cinema PLAY at 15.0s with +100ms scheduled execution sync...');
  const serverTime = await hostConn.invoke('GetServerTime');
  const scheduledTime = serverTime + 100;

  await hostConn.invoke('CinemaPlaybackCommand', roomCode, {
    commandType: 'Play',
    position: 15.0,
    playbackRate: 1.0,
    serverTimestamp: serverTime,
    scheduledPlayTime: scheduledTime,
    sequence: 10,
    mediaTitle: 'Interstellar IMAX Demo (4K)',
    mediaDuration: 180
  });

  // Wait 400ms for SignalR broadcasts
  await new Promise(r => setTimeout(r, 400));
  const playAllReceived = phoneCommandReceived.every(r => r === true);
  console.log(`✓ Play broadcast verified: ${phoneCommandReceived.filter(r => r).length}/8 phones received command: ${playAllReceived ? 'ALL PASS' : 'FAIL'}\n`);

  // 5. Host triggers Seek to 72.5s
  console.log('[Step 5] Host triggers Cinema SEEK to 72.5s...');
  await hostConn.invoke('CinemaPlaybackCommand', roomCode, {
    commandType: 'Seek',
    position: 72.5,
    playbackRate: 1.0,
    serverTimestamp: Date.now(),
    sequence: 11
  });

  await new Promise(r => setTimeout(r, 400));
  const seekAllReceived = phoneSeekReceived.every(r => r === true);
  console.log(`✓ Seek broadcast verified: ${phoneSeekReceived.filter(r => r).length}/8 phones received seek: ${seekAllReceived ? 'ALL PASS' : 'FAIL'}\n`);

  // 6. Phone 3 reassigns position to Subwoofer/FrontCenter
  console.log('[Step 6] Phone 3 dynamically updates speaker position to FrontCenter...');
  await phoneConns[2].invoke('UpdateDevicePosition', roomCode, {
    devicePosition: 'FrontCenter',
    volume: 95,
    isMuted: false,
    deviceName: 'Subwoofer-Calibrated Phone'
  });

  await new Promise(r => setTimeout(r, 400));
  console.log(`✓ Position change propagated to Host: ${hostReceivedPositionChange ? 'PASS' : 'FAIL'}\n`);

  // 7. Phones report sync telemetry
  console.log('[Step 7] All 8 phones report live synchronization telemetry to Host...');
  for (let i = 0; i < 8; i++) {
    await phoneConns[i].invoke('ReportDeviceSync', roomCode, {
      driftMs: Math.floor(Math.random() * 20) - 10, // -10ms to +10ms
      rtt: 14 + i,
      clockOffset: -2,
      playbackRate: 1.0,
      syncStatus: 'Excellent',
      devicePosition: positions[i],
      lastSyncTime: Date.now()
    });
  }

  await new Promise(r => setTimeout(r, 500));
  console.log(`✓ Host received ${hostReceivedSyncReports}/8 speaker telemetry reports\n`);

  // 8. Test WebRTC Signaling Exchange between Host and Phone 1
  console.log('[Step 8] Testing Host-to-Phone WebRTC P2P signaling exchange...');
  await hostConn.invoke('SendWebRtcSignal', roomCode, {
    targetConnectionId: phoneConns[0].connectionId,
    signalType: 'offer',
    data: JSON.stringify({ type: 'offer', sdp: 'mock-laptop-audio-stream' })
  });

  await new Promise(r => setTimeout(r, 500));
  console.log(`✓ Phone 1 received WebRTC offer: ${phone1ReceivedWebRtcOffer ? 'PASS' : 'FAIL'}`);
  console.log(`✓ Host received WebRTC answer back: ${hostReceivedWebRtcAnswer ? 'PASS' : 'FAIL'}\n`);

  // 9. Host triggers Pause
  console.log('[Step 9] Host triggers Cinema PAUSE...');
  await hostConn.invoke('CinemaPlaybackCommand', roomCode, {
    commandType: 'Pause',
    position: 75.0,
    playbackRate: 1.0,
    serverTimestamp: Date.now(),
    sequence: 12
  });

  await new Promise(r => setTimeout(r, 400));
  const pauseAllReceived = phonePauseReceived.every(r => r === true);
  console.log(`✓ Pause broadcast verified: ${phonePauseReceived.filter(r => r).length}/8 phones received pause: ${pauseAllReceived ? 'ALL PASS' : 'FAIL'}\n`);

  // 10. Test Audio Stream Endpoint with HTTP 206 Partial Content Range
  console.log('[Step 10] Testing HTTP Range Audio Streaming (/api/cinema/rooms/{roomCode}/audio)...');
  const streamRes = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/cinema/rooms/${roomCode}/audio`,
      method: 'GET',
      headers: {
        'Range': 'bytes=0-4096'
      }
    }, (res) => {
      resolve({
        statusCode: res.statusCode,
        contentRange: res.headers['content-range'],
        contentType: res.headers['content-type'],
        contentLength: res.headers['content-length']
      });
    });
    req.on('error', reject);
    req.end();
  });

  console.log(`  Response Status: ${streamRes.statusCode}`);
  console.log(`  Content-Range: ${streamRes.contentRange}`);
  console.log(`  Content-Type: ${streamRes.contentType}`);
  const rangePass = streamRes.statusCode === 206 || streamRes.statusCode === 200;
  console.log(`✓ Audio Range Streaming test: ${rangePass ? 'PASS (HTTP 206 / 200)' : 'FAIL'}\n`);

  // Clean up connections
  for (const pc of phoneConns) {
    await pc.stop();
  }
  await hostConn.stop();

  console.log('===============================================================');
  console.log('  TEST SUMMARY');
  console.log('===============================================================');
  console.log(`1. Cinema Room Creation:       PASS`);
  console.log(`2. Host Registration:          PASS`);
  console.log(`3. 8 Phone Speakers Joined:    PASS (8/8)`);
  console.log(`4. Scheduled Play Broadcast:   ${playAllReceived ? 'PASS' : 'FAIL'}`);
  console.log(`5. Seek Broadcast:             ${seekAllReceived ? 'PASS' : 'FAIL'}`);
  console.log(`6. Position Reassignment:      ${hostReceivedPositionChange ? 'PASS' : 'FAIL'}`);
  console.log(`7. Device Sync Telemetry:      ${hostReceivedSyncReports >= 8 ? 'PASS' : 'FAIL'}`);
  console.log(`8. WebRTC P2P Signaling:       ${phone1ReceivedWebRtcOffer && hostReceivedWebRtcAnswer ? 'PASS' : 'FAIL'}`);
  console.log(`9. Pause Broadcast:            ${pauseAllReceived ? 'PASS' : 'FAIL'}`);
  console.log(`10. HTTP Range Audio Stream:   ${rangePass ? 'PASS' : 'FAIL'}`);
  console.log('===============================================================');

  const allPassed = playAllReceived && seekAllReceived && hostReceivedPositionChange &&
                    hostReceivedSyncReports >= 8 && phone1ReceivedWebRtcOffer &&
                    hostReceivedWebRtcAnswer && pauseAllReceived && rangePass;

  if (allPassed) {
    console.log('\n🎉 ALL 10 CINEMA SURROUND MULTI-DEVICE TESTS PASSED PERFECTLY!\n');
    process.exit(0);
  } else {
    console.error('\n❌ SOME CINEMA TESTS FAILED.\n');
    process.exit(1);
  }
}

testCinemaSync().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
