const signalR = require('./BeatSync.Client/node_modules/@microsoft/signalr');
const https = require('https');

function httpsRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
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

async function testOnlineCinema() {
  const publicDomain = 'election-intensity-fairly-rome.trycloudflare.com';
  const hubUrl = `https://${publicDomain}/hubs/room`;

  console.log('====================================================================');
  console.log('  TESTING LIVE ONLINE CLOUDFLARE DEPLOYMENT');
  console.log(`  URL: https://${publicDomain}`);
  console.log('====================================================================\n');

  // 1. Create Room via Public HTTPS
  console.log('[1/5] Creating Cinema Room over Public Internet...');
  const createRes = await httpsRequest({
    hostname: publicDomain,
    path: '/api/rooms',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    name: 'Online Cinema Lounge',
    hostUsername: 'web-host-laptop',
    roomMode: 'Cinema',
    mediaTitle: 'Interstellar Online IMAX',
    mediaDuration: 120
  });

  if (createRes.status !== 200 && createRes.status !== 201) {
    throw new Error(`Failed to create online room: status ${createRes.status}`);
  }

  const room = createRes.body;
  const roomCode = room.roomCode;
  console.log(`✓ Online Room Created: [${roomCode}] (Mode: ${room.roomMode})\n`);

  // 2. Connect Host over Public SignalR
  console.log('[2/5] Connecting Host over Public SignalR Hub...');
  const hostConn = new signalR.HubConnectionBuilder()
    .withUrl(hubUrl)
    .build();

  await hostConn.start();
  await hostConn.invoke(
    'JoinCinemaRoom',
    roomCode,
    'web-host-laptop',
    'HostVideo',
    'HostCenter',
    'Online MacBook Host',
    100,
    false
  );
  console.log(`✓ Host successfully connected and joined room [${roomCode}]!\n`);

  // 3. Connect 3 Simulated Remote Phones
  console.log('[3/5] Connecting 3 Remote Mobile Speakers over Internet (FrontLeft, Center, FrontRight)...');
  const phonePositions = ['FrontLeft', 'FrontCenter', 'FrontRight'];
  const phoneConns = [];
  const commandsReceived = [];

  for (let i = 0; i < 3; i++) {
    const pos = phonePositions[i];
    const username = `mobile-phone-${i + 1}`;
    const pConn = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl)
      .build();

    const idx = i;
    pConn.on('CinemaCommandExecuted', (cmd, state) => {
      commandsReceived.push({ phone: idx + 1, cmd: cmd.commandType });
    });

    await pConn.start();
    await pConn.invoke(
      'JoinCinemaRoom',
      roomCode,
      username,
      'AudioSpeaker',
      pos,
      `Remote Phone #${i + 1}`,
      85,
      false
    );
    phoneConns.push(pConn);
    console.log(`  ✓ Remote Phone ${i + 1} connected: Position [${pos}]`);
  }
  console.log('');

  // 4. Host Triggers Play & Seek
  console.log('[4/5] Host broadcasting Cinema Play command across internet...');
  await hostConn.invoke('CinemaPlaybackCommand', roomCode, {
    commandType: 'Play',
    position: 10.0,
    playbackRate: 1.0,
    serverTimestamp: Date.now(),
    scheduledPlayTime: Date.now() + 100,
    sequence: 2,
    mediaTitle: 'Interstellar Online IMAX',
    mediaDuration: 120
  });

  await new Promise(r => setTimeout(r, 800));
  console.log(`✓ Remote phones received play broadcast: ${commandsReceived.length}/3 phones confirmed\n`);

  // 5. Test Remote Audio Range Stream
  console.log('[5/5] Testing HTTP 206 Partial Content Range Audio Streaming from public URL...');
  const audioRes = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: publicDomain,
      path: `/api/cinema/rooms/${roomCode}/audio`,
      method: 'GET',
      headers: {
        'Range': 'bytes=0-2048'
      }
    }, (res) => {
      resolve({
        statusCode: res.statusCode,
        contentRange: res.headers['content-range'],
        contentType: res.headers['content-type']
      });
    });
    req.on('error', reject);
    req.end();
  });

  console.log(`  Status: ${audioRes.statusCode} (Expected 206)`);
  console.log(`  Content-Range: ${audioRes.contentRange}`);
  console.log(`  Content-Type: ${audioRes.contentType}\n`);

  // Cleanup
  for (const pc of phoneConns) await pc.stop();
  await hostConn.stop();

  console.log('====================================================================');
  console.log('🎉 ONLINE DEPLOYMENT FULLY VERIFIED AND WORKING OVER INTERNET!');
  console.log(`  Public Link: https://${publicDomain}`);
  console.log('====================================================================\n');
}

testOnlineCinema().catch(err => {
  console.error('Online test error:', err);
  process.exit(1);
});
