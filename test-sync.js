const signalR = require('./BeatSync.Client/node_modules/@microsoft/signalr');

async function testSync() {
  console.log('--- Starting BeatSync SignalR Multi-User Test ---');

  const hubUrl = 'http://localhost:5000/hubs/room';

  // 1. Create Host connection
  const hostConn = new signalR.HubConnectionBuilder()
    .withUrl(hubUrl)
    .build();

  // 2. Create Listener connection
  const listenerConn = new signalR.HubConnectionBuilder()
    .withUrl(hubUrl)
    .build();

  let listenerReceivedPlay = false;
  let listenerReceivedSeek = false;
  let listenerReceivedTrackChange = false;
  let hostReceivedUserJoined = false;
  let hostReceivedUserLeft = false;

  hostConn.on('UserJoined', (participant) => {
    console.log('[Host Event] UserJoined:', participant.username, 'IsHost:', participant.isHost);
    if (participant.username === 'silent-wolf') {
      hostReceivedUserJoined = true;
    }
  });

  hostConn.on('UserLeft', (username) => {
    console.log('[Host Event] UserLeft:', username);
    if (username === 'silent-wolf') {
      hostReceivedUserLeft = true;
    }
  });

  listenerConn.on('PlaybackStateChanged', (state) => {
    console.log('[Listener Event] PlaybackStateChanged:', state);
    if (state.isPlaying) {
      listenerReceivedPlay = true;
    }
  });

  listenerConn.on('SeekChanged', (position, timestamp) => {
    console.log('[Listener Event] SeekChanged to:', position, 'at server time:', timestamp);
    listenerReceivedSeek = true;
  });

  listenerConn.on('TrackChanged', (track, state) => {
    console.log('[Listener Event] TrackChanged to:', track.title);
    listenerReceivedTrackChange = true;
  });

  await hostConn.start();
  console.log('Host connected to SignalR Hub.');

  await listenerConn.start();
  console.log('Listener connected to SignalR Hub.');

  // Dynamically create a test room
  const createRes = await fetch('http://localhost:5000/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostUsername: 'productive-eagle', name: 'Test Sync Room' })
  });
  const roomData = await createRes.json();
  const roomCode = roomData.roomCode;
  console.log(`Created test room: ${roomCode}`);

  // Host joins
  const hostState = await hostConn.invoke('JoinRoom', roomCode, 'productive-eagle');
  console.log('Host joined room. Current participants:', hostState.participants.length);

  // Listener joins
  const listenerState = await listenerConn.invoke('JoinRoom', roomCode, 'silent-wolf');
  console.log('Listener joined room. Current participants:', listenerState.participants.length);

  // Wait a moment for join event propagation
  await new Promise(r => setTimeout(r, 600));

  // Host triggers Play
  console.log('Host triggering PLAY at 5.0 seconds...');
  await hostConn.invoke('Play', roomCode, 5.0, 1);
  await new Promise(r => setTimeout(r, 600));

  // Host triggers Seek
  console.log('Host triggering SEEK to 22.5 seconds...');
  await hostConn.invoke('Seek', roomCode, 22.5, 1);
  await new Promise(r => setTimeout(r, 600));

  // Host triggers ChangeTrack
  console.log('Host triggering CHANGE TRACK to Track 2...');
  await hostConn.invoke('ChangeTrack', roomCode, 2);
  await new Promise(r => setTimeout(r, 600));

  // Listener leaves
  console.log('Listener leaving room...');
  await listenerConn.invoke('LeaveRoom', roomCode);
  await new Promise(r => setTimeout(r, 600));

  await hostConn.stop();
  await listenerConn.stop();

  console.log('\n--- Test Summary Results ---');
  console.log('1. Host received UserJoined:', hostReceivedUserJoined ? 'PASS' : 'FAIL');
  console.log('2. Listener received Play state:', listenerReceivedPlay ? 'PASS' : 'FAIL');
  console.log('3. Listener received Seek event:', listenerReceivedSeek ? 'PASS' : 'FAIL');
  console.log('4. Listener received TrackChange event:', listenerReceivedTrackChange ? 'PASS' : 'FAIL');
  console.log('5. Host received UserLeft:', hostReceivedUserLeft ? 'PASS' : 'FAIL');

  const allPassed = hostReceivedUserJoined && listenerReceivedPlay && listenerReceivedSeek && listenerReceivedTrackChange && hostReceivedUserLeft;
  console.log('\nOverall Result:', allPassed ? 'ALL TESTS PASSED SUCCESSFULLY!' : 'SOME TESTS FAILED');
  process.exit(allPassed ? 0 : 1);
}

testSync().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
