'use strict';
const $ = id => document.getElementById(id);
const socket = io();

// persistent identity so refresh/reconnect returns you to your seat
let token = localStorage.getItem('pokerToken');
if (!token) { token = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); localStorage.setItem('pokerToken', token); }
$('name').value = localStorage.getItem('pokerName') || '';
const myName = () => { const n = $('name').value.trim() || 'Player'; localStorage.setItem('pokerName', n); return n; };

function show(id) {
  if (!['lobby', 'game'].includes(id)) { Voice.disable(); $('voicePanel').classList.add('hidden'); }
  ['menu', 'single', 'hostSetup', 'lobby', 'game', 'rules'].forEach(s => $(s).classList.toggle('hidden', s !== id));
  $('overModal').classList.add('hidden');
}
function toast(msg) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = 'none'), 3000); }
socket.on('toast', toast);

let cfg = { claude: false };
fetch('/api/config').then(r => r.json()).then(c => (cfg = c)).catch(() => {});

// ---------- menu ----------
$('btnSingle').onclick = () => { $('aiNote').textContent = cfg.claude ? 'Opponents are powered by Claude.' : 'Opponents use the free built-in poker AI.'; show('single'); };
$('btnHost').onclick = () => show('hostSetup');
$('btnRules').onclick = () => { renderRankings(); show('rules'); window.scrollTo(0, 0); };
$('rulesBack').onclick = () => show('menu');

// example hands for the rules page (s/h/d/c = suit, r = rank 2-14)
const RANKINGS = [
  ['Royal Flush', 'Ten through Ace, all the same suit.', [[14,'s'],[13,'s'],[12,'s'],[11,'s'],[10,'s']]],
  ['Straight Flush', 'Five cards in a row, all the same suit.', [[9,'h'],[8,'h'],[7,'h'],[6,'h'],[5,'h']]],
  ['Four of a Kind', 'Four cards of the same rank.', [[9,'s'],[9,'h'],[9,'d'],[9,'c'],[3,'s']]],
  ['Full House', 'Three of one rank plus a pair.', [[13,'s'],[13,'h'],[13,'d'],[4,'c'],[4,'s']]],
  ['Flush', 'Any five cards of the same suit.', [[14,'d'],[11,'d'],[8,'d'],[6,'d'],[2,'d']]],
  ['Straight', 'Five cards in a row, mixed suits.', [[10,'c'],[9,'h'],[8,'d'],[7,'s'],[6,'c']]],
  ['Three of a Kind', 'Three cards of the same rank.', [[7,'s'],[7,'h'],[7,'d'],[13,'c'],[2,'s']]],
  ['Two Pair', 'Two different pairs.', [[12,'s'],[12,'h'],[5,'d'],[5,'c'],[14,'s']]],
  ['Pair', 'Two cards of the same rank.', [[10,'s'],[10,'h'],[14,'d'],[8,'c'],[3,'s']]],
  ['High Card', 'None of the above: your highest card plays.', [[14,'s'],[11,'h'],[8,'d'],[6,'c'],[3,'s']]],
];
function renderRankings() {
  $('rankList').innerHTML = RANKINGS.map((r, i) =>
    `<div class="rank"><div class="rname"><b>${i + 1}. ${r[0]}</b><span>${r[1]}</span></div><div class="cards">${r[2].map(c => cardHTML({ r: c[0], s: c[1] })).join('')}</div></div>`).join('');
}
$('btnJoin').onclick = () => {
  const code = $('joinCode').value.trim().toUpperCase();
  if (code.length < 5) { $('menuErr').textContent = 'Enter the 5-letter game code.'; return; }
  socket.emit('join', { code, name: myName(), token }, r => {
    if (r.error) $('menuErr').textContent = r.error; else { sessionStorage.setItem('pokerCode', r.code); $('menuErr').textContent = ''; }
  });
};
$('single').querySelector('#singleBack').onclick = () => show('menu');
$('hostBack').onclick = () => show('menu');
// Human + AI sliders: the total can never exceed 10 (moving one slider limits the other); a game needs at least 2 seats.
const MAX_SEATS = 10;
function linkSeatSliders(hId, aId, lblH, lblA, note, minHumans, onCommit) {
  const H = $(hId), A = $(aId);
  const sync = changed => {
    let h = +H.value, a = +A.value;
    if (h + a > MAX_SEATS) { if (changed === 'a') h = MAX_SEATS - a; else a = MAX_SEATS - h; }
    h = Math.max(h, minHumans()); a = Math.min(a, MAX_SEATS - h);
    H.value = h; A.value = a; A.max = Math.min(9, MAX_SEATS - h);
    $(lblH).textContent = h; $(lblA).textContent = a;
    if (note) $(note).textContent = 'Total seats: ' + (h + a) + ' of ' + MAX_SEATS + (h + a < 2 ? ' - need at least 2 (add an AI player)' : '');
    return { h, a };
  };
  H.oninput = () => sync('h');
  A.oninput = () => sync('a');
  if (onCommit) { H.onchange = A.onchange = () => onCommit(sync()); }
  return sync;
}
const syncHost = linkSeatSliders('hostHumans', 'hostAi', 'hostHumansLbl', 'hostAiLbl', 'hostTotal', () => 1);
syncHost('h');
$('hostGo').addEventListener('click', e => {
  if (+$('hostHumans').value + +$('hostAi').value < 2) { e.stopImmediatePropagation(); toast('Add at least one AI player, or allow 2+ human players.'); }
}, true);
let lobbyPlayers = 1;
linkSeatSliders('lobbyHumans', 'lobbyAi', 'lobbyHumansLbl', 'lobbyAiLbl', null, () => lobbyPlayers,
  v => socket.emit('setSeats', { humanSlots: v.h, aiCount: v.a }));

// ---------- single setup ----------
$('nBots').oninput = () => ($('nBotsLbl').textContent = $('nBots').value);
$('singleGo').onclick = () => {
  socket.emit('createSingle', { name: myName(), token, balance: +$('myBal').value, nBots: +$('nBots').value }, r => {
    if (r.error) return toast(r.error); sessionStorage.setItem('pokerCode', r.code);
  });
};

// ---------- host / lobby ----------
$('hostGo').onclick = () => socket.emit('createMulti', { name: myName(), token, balance: +$('hostBal').value, humanSlots: +$('hostHumans').value, aiCount: +$('hostAi').value }, r => {
  if (r.error) return toast(r.error); sessionStorage.setItem('pokerCode', r.code);
});
$('copyCode').onclick = () => { navigator.clipboard && navigator.clipboard.writeText($('lobbyCode').textContent); toast('Code copied'); };
$('lobbyBal').onchange = () => socket.emit('setBalance', { balance: +$('lobbyBal').value });
$('lobbyStart').onclick = () => socket.emit('start', {}, r => r && r.error && toast(r.error));
function leave() { socket.emit('leave'); sessionStorage.removeItem('pokerCode'); lastState = null; show('menu'); }
$('lobbyLeave').onclick = leave;
$('gLeave').onclick = () => { if (confirm('Leave the game? Your chips are forfeited.')) leave(); };
$('overBtn').onclick = leave;

socket.on('lobby', l => {
  show('lobby');
  $('voicePanel').classList.remove('hidden');
  $('lobbyCode').textContent = l.code;
  lobbyPlayers = l.players.length;
  $('lobbyPlayers').innerHTML = l.players.map(p => `<li>${esc(p.name)}${p.host ? ' 👑' : ''}${p.connected ? '' : ' (disconnected)'}</li>`).join('')
    + Array.from({ length: Math.max(0, l.humanSlots - l.players.length) }, () => '<li class="dim">⏳ Open seat, waiting for a player</li>').join('')
    + Array.from({ length: l.aiCount }, () => '<li>🤖 AI player</li>').join('');
  $('lobbyAiRow').classList.toggle('hidden', !l.isHost);
  $('lobbyHumansRow').classList.toggle('hidden', !l.isHost);
  $('lobbyAiView').classList.toggle('hidden', l.isHost);
  $('lobbyHumans').min = l.players.length;
  if (document.activeElement !== $('lobbyHumans') && document.activeElement !== $('lobbyAi')) {
    $('lobbyHumans').value = l.humanSlots; $('lobbyAi').value = l.aiCount;
    $('lobbyAi').max = Math.min(9, MAX_SEATS - l.humanSlots);
    $('lobbyHumansLbl').textContent = l.humanSlots; $('lobbyAiLbl').textContent = l.aiCount;
  }
  $('lobbyAiView').textContent = `Human seats: ${l.humanSlots} · AI players: ${l.aiCount}`;
  $('lobbyBalRow').classList.toggle('hidden', !l.isHost);
  $('lobbyBalView').classList.toggle('hidden', l.isHost);
  if (document.activeElement !== $('lobbyBal')) $('lobbyBal').value = l.balance;
  $('lobbyBalView').textContent = `Starting balance: ${l.balance}`;
  $('lobbyStart').classList.toggle('hidden', !l.isHost);
  $('lobbyWait').textContent = l.isHost ? (l.players.length + l.aiCount < 2 ? 'Add an AI player or wait for someone to join…' : '') : 'Waiting for the host to start…';
});

// reconnect after refresh / network blip
function tryRejoin() {
  const code = sessionStorage.getItem('pokerCode');
  if (code) socket.emit('rejoin', { code, token }, r => { if (r && r.error) { sessionStorage.removeItem('pokerCode'); show('menu'); } });
}
socket.on('connect', tryRejoin);

// ---------- game ----------
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const cardHTML = c => c ? `<div class="card ${c.s === 'h' || c.s === 'd' ? 'red' : ''}">${RANK[c.r] || c.r}<small>${SUIT[c.s]}</small></div>` : '<div class="card back"></div>';

// ---- chip stack graphics ----
const CHIP_TIERS = [[50, 'c-purple'], [25, 'c-black'], [10, 'c-green'], [5, 'c-blue'], [2, 'c-red'], [1, 'c-white']];
function chipStack(amount, bb, max = 9) {
  if (amount <= 0) return '';
  let units = Math.max(1, Math.round(amount / bb)), out = [];
  for (const [v, cls] of CHIP_TIERS) {
    while (units >= v && out.length < max) { out.push(cls); units -= v; }
  }
  if (!out.length) out.push('c-white');
  if (out.length < 2 && amount > bb * 0.5 && units > 0) out.push('c-white');
  return `<div class="stack">${out.map(c => `<i class="chip ${c}"></i>`).join('')}</div>`;
}

let lastState = null, timerInt = null;
socket.on('state', st => { soundFx(lastState, st); lastState = st; render(st); });

function render(st) {
  show('game');
  $('voicePanel').classList.toggle('hidden', st.mode !== 'multi');
  $('gCode').textContent = 'Code ' + st.code;
  $('gInfo').textContent = `Hand #${st.handNo} · Blinds ${st.sb}/${st.bb}`;
  $('pot').textContent = st.pot ? `Pot: ${st.pot}` : '';
  $('board').innerHTML = st.community.map(cardHTML).join('');

  // seats around the table, you at the bottom
  const tbl = $('table'); tbl.querySelectorAll('.seat, .betpile').forEach(e => e.remove());
  tbl.classList.toggle('many', st.players.length > 6);
  const n = st.players.length, base = Math.max(0, st.mySeat);
  const winners = new Set(st.phase === 'between' && st.result ? st.result.pots.flatMap(p => p.winners.map(w => w.seat)) : []);
  st.players.forEach(p => {
    const r = (p.seat - base + n) % n;
    const ang = Math.PI / 2 + (r * 2 * Math.PI) / n;
    const el = document.createElement('div');
    el.className = 'seat' + (p.seat === st.mySeat ? ' me' : '') + (p.seat === st.toAct ? ' turn' : '') + (p.folded && !p.out ? ' folded' : '') + (p.out ? ' out' : '') + (winners.has(p.seat) ? ' win' : '');
    el.style.left = 50 + 46 * Math.cos(ang) + '%';
    el.style.top = 50 + 46 * Math.sin(ang) + '%';
    let cards = '';
    if (p.cards) cards = p.cards.map(cardHTML).join('');
    else if (p.hasCards) cards = cardHTML(null) + cardHTML(null);
    const status = p.out ? (p.left ? 'Left' : 'Out') : p.lastAction;
    const handName = st.phase === 'between' && st.result && st.result.hands && st.result.hands[p.seat] ? ` · ${st.result.hands[p.seat]}` : '';
    el.innerHTML = `<div class="nm">${esc(p.name)}${p.seat === st.dealer && !p.out ? '<span class="dealer">D</span>' : ''}${p.bot ? ' 🤖' : ''}${!p.connected && !p.bot ? ' ⚠' : ''}</div>
      <div class="chips"><span class="mystack">${chipStack(p.chips, st.bb)}</span>${p.chips}</div><div class="act">${esc(status || '')}${esc(handName)}</div>
      <div class="cards">${cards}</div>`;
    tbl.appendChild(el);
    if (p.bet) {
      const pile = document.createElement('div');
      pile.className = 'betpile' + (!lastState || (lastState.players[p.seat] || {}).bet !== p.bet ? ' drop' : '');
      pile.style.left = 50 + 26 * Math.cos(ang) + '%';
      pile.style.top = 50 + 24 * Math.sin(ang) + '%';
      pile.innerHTML = chipStack(p.bet, st.bb, 7) + `<span>${p.bet}</span>`;
      tbl.appendChild(pile);
    }
  });

  // banner
  let banner = '';
  if (st.phase === 'between' && st.result) {
    banner = st.result.pots.map(pt => `${pt.winners.map(w => esc(w.name)).join(' & ')} win${pt.winners.length > 1 ? '' : 's'} ${pt.amount}${pt.hand ? ' with ' + pt.hand : ''}`).join('<br>');
  }
  $('banner').innerHTML = banner;

  // action bar / spectator bar
  const me = st.players[st.mySeat];
  const spectating = !me || me.out;
  $('spectate').classList.toggle('hidden', !(spectating && !st.over));
  if (spectating) $('spectate').innerHTML = `You're out of chips — spectating. <button onclick="document.getElementById('gLeave').click()">Leave game</button>`;
  const myTurn = !spectating && st.toAct === st.mySeat && ['preflop', 'flop', 'turn', 'river'].includes(st.phase);
  $('actions').classList.toggle('hidden', spectating || st.over);
  setupActions(st, myTurn, me);

  $('log').innerHTML = st.log.slice().reverse().map(l => `<div>${esc(l)}</div>`).join('');

  clearInterval(timerInt);
  if (myTurn && st.deadline) {
    const tick = () => { $('timer').textContent = `Auto-fold in ${Math.max(0, Math.ceil((st.deadline - Date.now()) / 1000))}s`; };
    tick(); timerInt = setInterval(tick, 500);
  } else $('timer').textContent = myTurn ? 'Your turn' : '';

  if (st.over) {
    const w = st.players[st.winner];
    $('overTitle').textContent = w && st.winner === st.mySeat ? '🏆 You win the game!' : w ? `${w.name} wins the game` : 'Game over';
    $('overModal').classList.remove('hidden');
  }
}

let raiseTouched = false, lastTurnKey = '';
function setupActions(st, myTurn, me) {
  const dis = !myTurn;
  ['aFold', 'aCall', 'aRaise', 'raiseSlider', 'raiseNum'].forEach(i => ($(i).disabled = dis));
  document.querySelectorAll('#presets button').forEach(b => (b.disabled = dis || !st.canRaise));
  $('aFold').textContent = 'Fold';
  const call = Math.min(st.toCall, me ? me.chips : 0);
  $('aCall').textContent = st.toCall === 0 ? 'Check' : (call >= (me ? me.chips : 0) ? `All-in ${call}` : `Call ${call}`);
  $('raiseRow').style.display = $('presets').style.display = st.canRaise || dis ? '' : 'none';
  if (!st.canRaise) { $('aRaise').disabled = true; $('raiseSlider').disabled = true; $('raiseNum').disabled = true; }
  const s = $('raiseSlider'), num = $('raiseNum');
  s.min = num.min = st.minRaiseTo; s.max = num.max = st.maxTo;
  const key = st.handNo + st.phase + st.toAct;
  if (key !== lastTurnKey) { lastTurnKey = key; s.value = num.value = st.minRaiseTo; }
  updRaiseLabel(st);
}
function updRaiseLabel(st) {
  st = st || lastState; if (!st) return;
  const v = +$('raiseNum').value;
  $('aRaise').textContent = v >= st.maxTo ? `All-in ${st.maxTo}` : `${st.currentBet ? 'Raise to' : 'Bet'} ${v}`;
}
$('raiseSlider').oninput = () => { $('raiseNum').value = $('raiseSlider').value; updRaiseLabel(); };
$('raiseNum').oninput = () => { $('raiseSlider').value = $('raiseNum').value; updRaiseLabel(); };
document.querySelectorAll('#presets button').forEach(b => (b.onclick = () => {
  const st = lastState, p = b.dataset.p;
  let v;
  if (p === 'min') v = st.minRaiseTo; else if (p === 'max') v = st.maxTo;
  else v = st.currentBet + Math.round(st.pot * +p + st.toCall * (+p === 1 ? 1 : 0));
  v = Math.max(st.minRaiseTo, Math.min(st.maxTo, v));
  $('raiseNum').value = $('raiseSlider').value = v; updRaiseLabel();
}));
const act = (action, amount) => socket.emit('action', { action, amount });
$('aFold').onclick = () => act('fold');
$('aCall').onclick = () => act(lastState.toCall === 0 ? 'check' : 'call');
$('aRaise').onclick = () => act('raise', +$('raiseNum').value);

show('menu');

// ---------- sound ----------
function soundFx(prev, st) {
  if (!prev || prev.code !== st.code) return;
  if (st.handNo !== prev.handNo) { Sound.play('deal'); return; }
  if (st.community.length > prev.community.length) Sound.play('deal', 0.7);
  // fold sound when anyone folds
  st.players.forEach((p, i) => { const o = prev.players[i]; if (o && p.lastAction === 'Fold' && o.lastAction !== 'Fold') Sound.play('fold'); });
  // chip sound whenever chips go into the pot (call / bet / raise / all-in)
  st.players.forEach((p, i) => {
    const o = prev.players[i];
    if (!o || p.bet <= o.bet || p.lastAction === o.lastAction && p.bet === o.bet) return;
    const delta = p.bet - o.bet;
    Sound.play('chips', Math.max(1, Math.min(6, 1 + Math.floor(Math.log2(delta / st.bb + 1)))));
  });
}
function syncSoundBtns() {
  $('btnMusic').classList.toggle('off', !Sound.state.music);
  $('btnSfx').classList.toggle('off', !Sound.state.sfx);
}
$('btnMusic').onclick = () => { Sound.start(); Sound.toggleMusic(); syncSoundBtns(); };
$('btnSfx').onclick = () => { Sound.start(); Sound.toggleSfx(); syncSoundBtns(); Sound.play('chips', 3); };
// browsers require a user gesture before audio can play
document.addEventListener('pointerdown', () => Sound.start(), { once: true });
document.addEventListener('keydown', () => Sound.start(), { once: true });
syncSoundBtns();

// ---------- voice chat ----------
const vSupported = Voice.supported && (window.isSecureContext);
Voice.init(socket, v => {
  $('vToggle').textContent = v.on ? '🎙 Voice: On' : '🎙 Voice: Off';
  $('vToggle').classList.toggle('on', v.on);
  $('vMute').classList.toggle('hidden', !v.on);
  $('vMute').textContent = v.muted ? '🔇 Unmute' : '🎤 Mute';
  $('vMute').classList.toggle('muted', v.muted);
  $('vList').innerHTML = v.on ? v.roster.map(r =>
    `<li class="${v.speaking.has(r.id) ? 'speaking' : ''}"><span class="dot"></span><span>${esc(r.name)}${r.id === v.me ? ' (you)' : ''}</span><span>${r.muted ? '🔇' : ''}</span></li>`).join('') : '';
});
$('vNote').textContent = vSupported ? 'Off by default. Turn on to talk with other players.' : 'Voice needs a secure (https) page and microphone support.';
$('vToggle').onclick = async () => {
  if (Voice.on) return Voice.disable();
  if (!vSupported) return toast('Voice needs https (or localhost) and a browser with microphone support.');
  try { await Voice.enable(); }
  catch (e) { toast('Could not access your microphone. Check browser permissions.'); }
};
$('vMute').onclick = () => Voice.setMuted(!Voice.muted);
socket.on('disconnect', () => { if (Voice.on) { Voice.disable(true); toast('Voice disconnected'); } });
