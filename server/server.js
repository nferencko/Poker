'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Table } = require('./engine');
const { STYLES, botDecide, claudeEnabled } = require('./bot');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/api/config', (req, res) => res.json({ claude: claudeEnabled() }));

const rooms = new Map();
const MAX_PLAYERS = 10; // humans + AI, hard cap per table
const MIN_BAL = 10, MAX_BAL = 1000000;

const cleanName = n => String(n || 'Player').replace(/[<>]/g, '').trim().slice(0, 16) || 'Player';
const cleanBal = b => Math.max(MIN_BAL, Math.min(MAX_BAL, Math.floor(+b) || 1000));
const bbFor = bal => Math.max(2, Math.round(bal / 50 / 2) * 2); // ~2% of stack, even number

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += letters[Math.floor(Math.random() * letters.length)];
    if (!rooms.has(c)) return c;
  }
}

function lobbyView(room, token) {
  return {
    code: room.code, isHost: token === room.host, balance: room.balance, humanSlots: room.humanSlots, aiCount: room.aiCount || 0, maxPlayers: MAX_PLAYERS,
    players: room.members.map(m => ({ name: m.name, host: m.token === room.host, connected: m.connected })),
  };
}

function broadcast(room) {
  for (const m of room.members) {
    if (!m.socketId) continue;
    if (room.table) io.to(m.socketId).emit('state', { code: room.code, mode: room.mode, ...room.table.view(m.token) });
    else io.to(m.socketId).emit('lobby', lobbyView(room, m.token));
  }
}

function destroyRoom(room) {
  if (room.table) room.table.destroy();
  clearTimeout(room.idleTimer);
  rooms.delete(room.code);
}

function makeBots(n, chips, avoid = []) {
  const pool = STYLES.slice().sort(() => Math.random() - 0.5);
  const taken = new Set(avoid);
  const bots = [];
  for (let i = 0; i < n; i++) {
    const st = pool[i % pool.length];
    let name = st.name;
    while (taken.has(name)) name += ' AI';
    taken.add(name);
    bots.push({ name, bot: true, style: st, chips });
  }
  return bots;
}
// humanSlots = number of human seats; the AI count can never push the table past MAX_PLAYERS
const cleanSlots = (n, min) => Math.max(min, Math.min(MAX_PLAYERS, Math.floor(+n) || min));
const cleanAi = (n, humanSlots) => Math.max(0, Math.min(MAX_PLAYERS - 1, MAX_PLAYERS - humanSlots, Math.floor(+n) || 0));

function startTable(room, bots) {
  const specs = room.members.map(m => ({ token: m.token, name: m.name, chips: m.chips || room.balance }));
  (bots || []).forEach(b => specs.push(b));
  const avg = specs.reduce((s, p) => s + p.chips, 0) / specs.length;
  room.table = new Table({
    players: specs, bb: bbFor(avg), onChange: () => broadcast(room), botFn: botDecide,
    turnMs: room.mode === 'multi' ? 45000 : 0, autoDisconnect: room.mode === 'multi',
  });
  room.table.startHand();
}

function findRoom(socket) {
  const room = rooms.get(socket.data.code);
  if (!room) return {};
  return { room, member: room.members.find(m => m.token === socket.data.token) };
}

function attach(socket, room, member) {
  member.socketId = socket.id; member.connected = true;
  clearTimeout(member.dropTimer);
  clearTimeout(room.idleTimer);
  socket.data.code = room.code; socket.data.token = member.token;
  socket.join(room.code);
  if (room.table) room.table.setConnected(member.token, true);
  broadcast(room);
}

io.on('connection', socket => {
  const tokOk = t => typeof t === 'string' && t.length >= 8 && t.length <= 64;

  socket.on('createSingle', (d, cb) => {
    if (!tokOk(d.token)) return cb && cb({ error: 'Bad token' });
    const n = Math.max(1, Math.min(MAX_PLAYERS - 1, Math.floor(+d.nBots) || 1));
    const mine = cleanBal(d.balance);
    const bots = makeBots(n, mine);
    const room = { code: makeCode(), host: d.token, mode: 'single', balance: mine, members: [{ token: d.token, name: cleanName(d.name), chips: mine, connected: true }] };
    rooms.set(room.code, room);
    attach(socket, room, room.members[0]);
    startTable(room, bots);
    cb && cb({ ok: true, code: room.code });
  });

  socket.on('createMulti', (d, cb) => {
    if (!tokOk(d.token)) return cb && cb({ error: 'Bad token' });
    const room = { code: makeCode(), host: d.token, mode: 'multi', balance: cleanBal(d.balance), humanSlots: cleanSlots(d.humanSlots, 1), aiCount: cleanAi(d.aiCount, cleanSlots(d.humanSlots, 1)), members: [{ token: d.token, name: cleanName(d.name), connected: true }] };
    rooms.set(room.code, room);
    attach(socket, room, room.members[0]);
    cb && cb({ ok: true, code: room.code });
  });

  socket.on('join', (d, cb) => {
    if (!tokOk(d.token)) return cb && cb({ error: 'Bad token' });
    const room = rooms.get(String(d.code || '').toUpperCase().trim());
    if (!room || room.mode !== 'multi') return cb && cb({ error: 'Game not found. Check the code.' });
    let m = room.members.find(x => x.token === d.token);
    if (!m) {
      if (room.table) return cb && cb({ error: 'That game has already started.' });
      if (room.members.length >= room.humanSlots) return cb && cb({ error: 'Game is full (the host set a limit on human players).' });
      let name = cleanName(d.name);
      while (room.members.some(x => x.name === name)) name = name.slice(0, 13) + Math.floor(Math.random() * 90 + 10);
      m = { token: d.token, name, connected: true };
      room.members.push(m);
    }
    attach(socket, room, m);
    cb && cb({ ok: true, code: room.code });
  });

  socket.on('rejoin', (d, cb) => {
    const room = rooms.get(String(d.code || '').toUpperCase());
    const m = room && room.members.find(x => x.token === d.token);
    if (!m || (room.table && room.table.players.find(p => p.token === m.token).left)) return cb && cb({ error: 'gone' });
    attach(socket, room, m);
    cb && cb({ ok: true, code: room.code, started: !!room.table });
  });

  socket.on('setBalance', d => {
    const { room, member } = findRoom(socket);
    if (!room || room.table || !member || member.token !== room.host) return;
    room.balance = cleanBal(d && d.balance);
    broadcast(room);
  });

  // host sets how many human seats and how many AI players (total never exceeds MAX_PLAYERS)
  socket.on('setSeats', d => {
    const { room, member } = findRoom(socket);
    if (!room || room.table || room.mode !== 'multi' || !member || member.token !== room.host) return;
    room.humanSlots = cleanSlots(d && d.humanSlots, room.members.length);
    room.aiCount = cleanAi(d && d.aiCount, room.humanSlots);
    broadcast(room);
  });

  socket.on('start', (d, cb) => {
    const { room, member } = findRoom(socket);
    if (!room || room.table || !member || member.token !== room.host) return;
    const ai = cleanAi(room.aiCount, room.humanSlots);
    if (room.members.length + ai < 2) return cb && cb({ error: 'Need at least 2 players (add AI players or wait for others).' });
    startTable(room, makeBots(ai, room.balance, room.members.map(m => m.name)));
    cb && cb({ ok: true });
  });

  socket.on('action', (d, cb) => {
    const { room, member } = findRoom(socket);
    if (!room || !room.table || !member) return;
    const p = room.table.players.find(x => x.token === member.token);
    const r = room.table.act(p.seat, d && d.action, d && d.amount);
    if (!r.ok) socket.emit('toast', r.error);
    cb && cb(r);
  });

  // ---- voice chat signaling (audio itself is peer-to-peer WebRTC; the server only relays setup messages) ----
  const voiceList = room => [...(room.voice || new Map()).entries()].map(([id, v]) => ({ id, name: v.name, muted: v.muted }));
  function voiceLeave(room) {
    if (room && room.voice && room.voice.delete(socket.id)) {
      io.to(room.code).emit('voiceGone', socket.id);
      io.to(room.code).emit('voiceState', voiceList(room));
    }
  }
  socket.on('voiceJoin', () => {
    const { room, member } = findRoom(socket);
    if (!room || room.mode !== 'multi' || !member) return;
    room.voice = room.voice || new Map();
    const peers = [...room.voice.keys()].filter(id => id !== socket.id);
    room.voice.set(socket.id, { name: member.name, muted: false });
    socket.emit('voicePeers', peers);
    io.to(room.code).emit('voiceState', voiceList(room));
  });
  socket.on('voiceSignal', d => {
    const { room } = findRoom(socket);
    if (!room || !room.voice || !d || !room.voice.has(socket.id) || !room.voice.has(d.to)) return;
    io.to(d.to).emit('voiceSignal', { from: socket.id, data: d.data });
  });
  socket.on('voiceMute', d => {
    const { room } = findRoom(socket);
    const v = room && room.voice && room.voice.get(socket.id);
    if (!v) return;
    v.muted = !!(d && d.muted);
    io.to(room.code).emit('voiceState', voiceList(room));
  });
  socket.on('voiceLeave', () => voiceLeave(findRoom(socket).room));

  function leaveRoom(socket) {
    const { room, member } = findRoom(socket);
    if (!room || !member) return;
    voiceLeave(room);
    socket.leave(room.code);
    socket.data.code = null;
    if (room.mode === 'single') return destroyRoom(room);
    if (room.table) room.table.leave(member.token);
    else room.members = room.members.filter(m => m !== member);
    member.socketId = null; member.connected = false;
    if (room.host === member.token) {
      const next = room.members.find(m => m.connected && m !== member);
      if (next) room.host = next.token;
    }
    if (!room.members.some(m => m.connected)) return destroyRoom(room);
    broadcast(room);
  }
  socket.on('leave', () => leaveRoom(socket));

  socket.on('disconnect', () => {
    const { room, member } = findRoom(socket);
    if (room) voiceLeave(room);
    if (!room || !member || member.socketId !== socket.id) return;
    member.connected = false; member.socketId = null;
    if (room.table) room.table.setConnected(member.token, false);
    else {
      member.dropTimer = setTimeout(() => {
        if (member.connected) return;
        room.members = room.members.filter(m => m !== member);
        if (room.host === member.token && room.members[0]) room.host = room.members[0].token;
        if (!room.members.length) destroyRoom(room); else broadcast(room);
      }, 15000);
    }
    if (!room.members.some(m => m.connected)) {
      clearTimeout(room.idleTimer);
      room.idleTimer = setTimeout(() => destroyRoom(room), 10 * 60 * 1000);
    } else broadcast(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Poker running on http://localhost:${PORT}  (bots: ${claudeEnabled() ? 'Claude' : 'built-in AI'})`));
