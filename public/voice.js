'use strict';
// Peer-to-peer voice chat (WebRTC mesh; max 6 players so at most 5 connections each).
const Voice = (() => {
  const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
  let sock, stream = null, on = false, muted = false, actx = null;
  let roster = [];                       // [{id,name,muted}] from server
  const peers = new Map();               // socketId -> {pc, audio, queue, analyser}
  const speaking = new Set();
  let meter = null, analyserSelf = null;
  let onChange = () => {};

  const emitChange = () => onChange({ on, muted, roster, speaking: new Set(speaking), me: sock && sock.id });

  function makeAnalyser(mediaStream) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const src = actx.createMediaStreamSource(mediaStream), an = actx.createAnalyser();
      an.fftSize = 512; src.connect(an);
      return an;
    } catch (e) { return null; }
  }
  function level(an) {
    const d = new Uint8Array(an.fftSize); an.getByteTimeDomainData(d);
    let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i] - 128));
    return m;
  }
  function startMeter() {
    clearInterval(meter);
    meter = setInterval(() => {
      const prev = [...speaking].sort().join();
      speaking.clear();
      if (analyserSelf && !muted && level(analyserSelf) > 12) speaking.add(sock.id);
      peers.forEach((p, id) => { if (p.analyser && level(p.analyser) > 12) speaking.add(id); });
      if ([...speaking].sort().join() !== prev) emitChange();
    }, 150);
  }

  function dropPeer(id) {
    const p = peers.get(id); if (!p) return;
    try { p.pc.close(); } catch (e) {}
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    peers.delete(id); speaking.delete(id);
  }

  function connect(id, initiator) {
    const pc = new RTCPeerConnection(ICE);
    const p = { pc, audio: null, queue: [], analyser: null };
    peers.set(id, p);
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    pc.onicecandidate = e => { if (e.candidate) sock.emit('voiceSignal', { to: id, data: { ice: e.candidate } }); };
    pc.ontrack = e => {
      if (p.audio) return;
      const a = document.createElement('audio');
      a.autoplay = true; a.srcObject = e.streams[0]; a.style.display = 'none';
      document.body.appendChild(a); p.audio = a;
      p.analyser = makeAnalyser(e.streams[0]);
      a.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) dropPeer(id); };
    if (initiator) {
      pc.createOffer().then(o => pc.setLocalDescription(o))
        .then(() => sock.emit('voiceSignal', { to: id, data: { sdp: pc.localDescription } })).catch(() => {});
    }
    return p;
  }

  async function onSignal({ from, data }) {
    if (!on) return;
    let p = peers.get(from) || connect(from, false);
    try {
      if (data.sdp) {
        await p.pc.setRemoteDescription(data.sdp);
        while (p.queue.length) await p.pc.addIceCandidate(p.queue.shift()).catch(() => {});
        if (data.sdp.type === 'offer') {
          await p.pc.setLocalDescription(await p.pc.createAnswer());
          sock.emit('voiceSignal', { to: from, data: { sdp: p.pc.localDescription } });
        }
      } else if (data.ice) {
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(data.ice).catch(() => {});
        else p.queue.push(data.ice);
      }
    } catch (e) { /* ignore glitches; peer will be retried on rejoin */ }
  }

  return {
    init(socket, cb) {
      sock = socket; onChange = cb;
      socket.on('voicePeers', ids => { if (on) ids.forEach(id => connect(id, true)); });
      socket.on('voiceSignal', onSignal);
      socket.on('voiceGone', dropPeer);
      socket.on('voiceState', list => { roster = list; emitChange(); });
    },
    get on() { return on; },
    get muted() { return muted; },
    supported: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection),
    async enable() {
      if (on) return;
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      on = true; muted = false;
      analyserSelf = makeAnalyser(stream);
      if (actx && actx.state === 'suspended') actx.resume();
      startMeter();
      sock.emit('voiceJoin');
      emitChange();
    },
    disable(quiet) {
      if (!on && !stream) return;
      on = false; muted = false;
      clearInterval(meter); analyserSelf = null;
      [...peers.keys()].forEach(dropPeer);
      if (stream) stream.getTracks().forEach(t => t.stop());
      stream = null; roster = []; speaking.clear();
      if (!quiet) sock.emit('voiceLeave');
      emitChange();
    },
    setMuted(m) {
      if (!on) return;
      muted = m;
      stream.getAudioTracks().forEach(t => (t.enabled = !m));
      sock.emit('voiceMute', { muted: m });
      emitChange();
    },
  };
})();
