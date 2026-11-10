'use strict';
// Texas Hold'em (no-limit, Vegas cash-game rules) engine.
const crypto = require('crypto');

const SUITS = ['s', 'h', 'd', 'c'];
const HAND_NAMES = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];

function newDeck() {
  const d = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function score5(c) {
  const rs = c.map(x => x.r).sort((a, b) => b - a);
  const flush = c.every(x => x.s === c[0].s);
  const cnt = {};
  rs.forEach(r => (cnt[r] = (cnt[r] || 0) + 1));
  const groups = Object.entries(cnt).map(([r, n]) => [+r, n]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const uniq = [...new Set(rs)];
  let sh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) sh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5) sh = 5; // wheel
  }
  const g = groups.map(x => x[1]).join('');
  const ks = groups.map(x => x[0]);
  if (sh && flush) return [8, sh];
  if (g === '41') return [7, ...ks];
  if (g === '32') return [6, ...ks];
  if (flush) return [5, ...rs];
  if (sh) return [4, sh];
  if (g === '311') return [3, ...ks];
  if (g === '221') return [2, ...ks];
  if (g === '2111') return [1, ...ks];
  return [0, ...rs];
}

function cmp(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

function bestOf(cards) {
  let best = null;
  const n = cards.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const s = score5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || cmp(s, best) > 0) best = s;
          }
  return best;
}

const BETTING = ['preflop', 'flop', 'turn', 'river'];

class Table {
  /**
   * opts: { players:[{token,name,chips,bot,style}], bb, onChange, botFn,
   *         turnMs (0 = no timer), autoDisconnect, fast }
   */
  constructor(opts) {
    this.players = opts.players.map((p, i) => ({
      seat: i, token: p.token || null, name: p.name, chips: p.chips, bot: !!p.bot, style: p.style || null,
      hand: [], bet: 0, total: 0, folded: false, allIn: false, acted: false,
      out: false, left: false, connected: true, lastAction: '',
    }));
    this.bb = opts.bb;
    this.sb = Math.floor(opts.bb / 2);
    this.onChange = opts.onChange || (() => {});
    this.botFn = opts.botFn;
    this.turnMs = opts.turnMs || 0;
    this.autoDisconnect = !!opts.autoDisconnect;
    this.fast = !!opts.fast;
    this.dealer = -1;
    this.phase = 'idle';
    this.community = [];
    this.handNo = 0;
    this.turnId = 0;
    this.toAct = -1;
    this.currentBet = 0;
    this.minRaise = this.bb;
    this.result = null;
    this.over = false;
    this.winner = null;
    this.deadline = null;
    this.log = [];
    this.timers = new Set();
  }

  get pot() { return this.players.reduce((s, p) => s + p.total, 0); }

  _later(fn, ms) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, this.fast ? 0 : ms);
    this.timers.add(t);
    return t;
  }
  destroy() { this.timers.forEach(clearTimeout); this.timers.clear(); this.destroyed = true; }
  _say(m) { this.log.push(m); if (this.log.length > 60) this.log.shift(); }
  _change() { if (!this.destroyed) this.onChange(); }
  _next(from, pred) {
    const n = this.players.length;
    for (let i = 1; i <= n; i++) {
      const s = (((from + i) % n) + n) % n;
      if (pred(this.players[s])) return s;
    }
    return -1;
  }
  _canAct(p) { return !p.out && !p.folded && !p.allIn && p.chips > 0; }
  _pay(p, n) {
    n = Math.min(n, p.chips);
    p.chips -= n; p.bet += n; p.total += n;
    if (p.chips === 0) p.allIn = true;
    return n;
  }

  startHand() {
    if (this.destroyed) return;
    this.timers.forEach(clearTimeout); this.timers.clear();
    this.result = null;
    const live = this.players.filter(p => p.chips > 0 && !p.left);
    if (live.length < 2) {
      this.over = true; this.winner = live[0] ? live[0].seat : null;
      this.phase = 'over'; this.toAct = -1; this.deadline = null;
      if (live[0]) this._say(`${live[0].name} wins the game!`);
      return this._change();
    }
    this.players.forEach(p => {
      if (p.chips <= 0 || p.left) p.out = true;
      p.hand = []; p.bet = 0; p.total = 0; p.folded = p.out; p.allIn = false; p.acted = false; p.lastAction = '';
    });
    this.handNo++;
    this.deck = newDeck();
    this.community = [];
    this.dealer = this._next(this.dealer, p => !p.out);
    const heads = live.length === 2;
    const sbSeat = heads ? this.dealer : this._next(this.dealer, p => !p.out);
    const bbSeat = this._next(sbSeat, p => !p.out);
    const sp = this.players[sbSeat], bp = this.players[bbSeat];
    this._pay(sp, this.sb); sp.lastAction = `SB ${sp.bet}`;
    this._pay(bp, this.bb); bp.lastAction = `BB ${bp.bet}`;
    // deal two hole cards each, starting left of the button
    for (let r = 0; r < 2; r++) {
      let s = this.dealer;
      for (let i = 0; i < this.players.length; i++) {
        s = this._next(s, p => !p.out);
        this.players[s].hand.push(this.deck.pop());
      }
    }
    this.phase = 'preflop';
    this.currentBet = this.bb;
    this.minRaise = this.bb;
    this._say(`— Hand #${this.handNo} — ${this.players[this.dealer].name} has the button`);
    this._advance(bbSeat);
  }

  _needs(p) {
    if (!this._canAct(p)) return false;
    if (p.bet < this.currentBet) return true;
    if (p.acted) return false;
    return this.players.some(o => o !== p && this._canAct(o)); // nobody to bet against otherwise
  }

  _advance(from) {
    const alive = this.players.filter(p => !p.out && !p.folded);
    if (alive.length === 1) return this._finishUncontested(alive[0]);
    const n = this.players.length;
    for (let i = 1; i <= n; i++) {
      const s = (from + i) % n;
      if (this._needs(this.players[s])) { this.toAct = s; return this._turnStart(); }
    }
    this.toAct = -1; this.deadline = null; this.turnId++;
    if (this.phase === 'river') return this._showdown();
    this._change();
    this._later(() => this._endRound(), 700);
  }

  _endRound() {
    if (this.destroyed) return;
    this.players.forEach(p => { p.bet = 0; p.acted = false; if (!p.folded && !p.out) p.lastAction = p.allIn ? 'All-in' : ''; });
    this.currentBet = 0; this.minRaise = this.bb;
    this.deck.pop(); // burn
    if (this.phase === 'preflop') { this.phase = 'flop'; for (let i = 0; i < 3; i++) this.community.push(this.deck.pop()); }
    else if (this.phase === 'flop') { this.phase = 'turn'; this.community.push(this.deck.pop()); }
    else if (this.phase === 'turn') { this.phase = 'river'; this.community.push(this.deck.pop()); }
    this._advance(this.dealer);
  }

  _turnStart() {
    this.turnId++;
    const id = this.turnId, seat = this.toAct, p = this.players[seat];
    this.deadline = null;
    if (p.bot) {
      this._later(() => this._botMove(seat, id), 900 + Math.random() * 1200);
    } else if (this.autoDisconnect && (!p.connected || p.left)) {
      this._later(() => this._auto(seat, id), 800);
    } else if (this.turnMs) {
      this.deadline = Date.now() + this.turnMs;
      this._later(() => this._auto(seat, id), this.turnMs);
    }
    this._change();
  }

  _auto(seat, id) {
    if (this.turnId !== id || this.toAct !== seat) return;
    const p = this.players[seat];
    this.act(seat, this.currentBet - p.bet > 0 ? 'fold' : 'check', 0, true);
  }

  botView(seat) {
    const p = this.players[seat];
    const maxTo = p.bet + p.chips;
    return {
      hole: p.hand, community: this.community, pot: this.pot, phase: this.phase,
      toCall: Math.max(0, this.currentBet - p.bet), currentBet: this.currentBet, myBet: p.bet,
      chips: p.chips, maxTo, minRaiseTo: Math.min(this.currentBet + this.minRaise, maxTo),
      canRaise: !p.acted && maxTo > this.currentBet, bb: this.bb,
      opponents: this.players.filter(o => o !== p && !o.out && !o.folded).length,
      table: this.players.filter(o => !o.out).map(o => ({ name: o.name, chips: o.chips, bet: o.bet, folded: o.folded, allIn: o.allIn, you: o === p })),
      isButton: this.dealer === seat,
      recent: this.log.slice(-8),
    };
  }

  async _botMove(seat, id) {
    if (this.turnId !== id || this.toAct !== seat) return;
    const p = this.players[seat];
    const view = this.botView(seat);
    let d = null;
    try { d = await this.botFn(view, p); } catch (e) { d = null; }
    if (this.turnId !== id || this.toAct !== seat || this.destroyed) return;
    let r = { ok: false };
    if (d && d.action) {
      let { action, amount } = d;
      if (action === 'raise') {
        if (!view.canRaise) action = view.toCall > 0 ? 'call' : 'check';
        else amount = Math.max(view.minRaiseTo, Math.min(Math.floor(+amount) || 0, view.maxTo));
      }
      r = this.act(seat, action, amount, true);
    }
    if (!r.ok) this.act(seat, view.toCall > 0 ? 'fold' : 'check', 0, true);
  }

  act(seat, action, amount, internal) {
    const p = this.players[seat];
    if (!p || this.toAct !== seat || !BETTING.includes(this.phase)) return { ok: false, error: 'Not your turn' };
    if (!internal && p.bot) return { ok: false, error: 'Not your turn' };
    const toCall = Math.max(0, this.currentBet - p.bet);
    let msg;
    switch (action) {
      case 'fold':
        p.folded = true; p.lastAction = 'Fold'; msg = `${p.name} folds`; break;
      case 'check':
        if (toCall > 0) return { ok: false, error: 'You must call, raise or fold' };
        p.lastAction = 'Check'; msg = `${p.name} checks`; break;
      case 'call': {
        if (toCall <= 0) { p.lastAction = 'Check'; msg = `${p.name} checks`; break; }
        const paid = this._pay(p, toCall);
        p.lastAction = p.allIn ? 'All-in' : 'Call'; msg = `${p.name} ${p.allIn ? 'is all-in for' : 'calls'} ${paid}`; break;
      }
      case 'raise': {
        const maxTo = p.bet + p.chips;
        let to = Math.floor(+amount);
        if (!Number.isFinite(to)) return { ok: false, error: 'Invalid amount' };
        if (p.acted) return { ok: false, error: 'Betting was not reopened — call or fold' };
        if (to <= this.currentBet) return { ok: false, error: 'Raise must exceed the current bet' };
        to = Math.min(to, maxTo);
        const minTo = this.currentBet + this.minRaise;
        if (to < minTo && to < maxTo) return { ok: false, error: `Minimum raise is to ${minTo}` };
        const verb = this.currentBet === 0 ? 'bets' : 'raises to';
        const full = to - this.currentBet >= this.minRaise;
        this._pay(p, to - p.bet);
        if (full) {
          this.minRaise = to - this.currentBet;
          this.players.forEach(o => { if (o !== p) o.acted = false; }); // reopen the betting
        }
        this.currentBet = to;
        p.lastAction = p.allIn ? 'All-in' : (verb === 'bets' ? 'Bet' : 'Raise');
        msg = `${p.name} ${p.allIn ? 'is all-in, ' + verb : verb} ${to}`;
        break;
      }
      default: return { ok: false, error: 'Unknown action' };
    }
    p.acted = true;
    this._say(msg);
    this._advance(seat);
    return { ok: true };
  }

  _finishUncontested(w) {
    const amount = this.pot;
    w.chips += amount;
    this._say(`${w.name} wins ${amount} (everyone else folded)`);
    this.result = { showdown: false, pots: [{ amount, winners: [{ seat: w.seat, name: w.name }], hand: null }] };
    this._afterHand(3500);
  }

  _showdown() {
    const alive = this.players.filter(p => !p.out && !p.folded);
    alive.forEach(p => { p.score = bestOf(p.hand.concat(this.community)); });
    const levels = [...new Set(alive.map(p => p.total))].sort((a, b) => a - b);
    let prev = 0;
    const pots = [];
    levels.forEach((lvl, i) => {
      const top = i === levels.length - 1;
      let amount = 0;
      this.players.forEach(p => {
        const hi = top ? p.total : Math.min(p.total, lvl);
        amount += Math.max(0, hi - Math.min(p.total, prev));
      });
      prev = lvl;
      if (amount <= 0) return;
      const elig = alive.filter(p => p.total >= lvl);
      let best = elig[0].score;
      elig.forEach(p => { if (cmp(p.score, best) > 0) best = p.score; });
      const winners = elig.filter(p => cmp(p.score, best) === 0);
      // odd chips go to the first winner clockwise from the button
      winners.sort((a, b) => ((a.seat - this.dealer + 99) % 99) - ((b.seat - this.dealer + 99) % 99));
      const share = Math.floor(amount / winners.length);
      let rem = amount - share * winners.length;
      winners.forEach(w => { w.chips += share + (rem-- > 0 ? 1 : 0); });
      pots.push({ amount, winners: winners.map(w => ({ seat: w.seat, name: w.name })), hand: HAND_NAMES[best[0]] });
    });
    const hands = {};
    alive.forEach(p => { hands[p.seat] = HAND_NAMES[p.score[0]]; });
    pots.forEach((pt, i) => this._say(`${pt.winners.map(w => w.name).join(' & ')} win${pt.winners.length > 1 ? '' : 's'} ${pt.amount}${i ? ' (side pot)' : ''} with ${pt.hand}`));
    this.result = { showdown: true, pots, hands };
    this._afterHand(7000);
  }

  _afterHand(delay) {
    this.phase = 'between'; this.toAct = -1; this.deadline = null; this.turnId++;
    this.players.forEach(p => {
      p.bet = 0; p.total = 0;
      if (p.chips <= 0 && !p.out) { p.out = true; this._say(`${p.name} is out of chips`); }
    });
    const live = this.players.filter(p => p.chips > 0 && !p.left);
    if (live.length < 2) {
      this.over = true; this.winner = live[0] ? live[0].seat : null; this.phase = 'over';
      if (live[0]) this._say(`${live[0].name} wins the game!`);
    } else {
      this._later(() => this.startHand(), delay);
    }
    this._change();
  }

  // ---- membership changes ----
  setConnected(token, v) {
    const p = this.players.find(x => x.token === token);
    if (!p) return;
    p.connected = v;
    if (!v && this.autoDisconnect && this.toAct === p.seat) this._auto(p.seat, this.turnId);
    this._change();
  }
  leave(token) {
    const p = this.players.find(x => x.token === token);
    if (!p || p.left) return;
    p.left = true; p.connected = false;
    this._say(`${p.name} left the table`);
    if (BETTING.includes(this.phase) && !p.out && !p.folded) {
      if (this.toAct === p.seat) this.act(p.seat, 'fold', 0, true);
      else {
        p.folded = true; p.lastAction = 'Fold';
        const alive = this.players.filter(o => !o.out && !o.folded);
        if (alive.length === 1) this._finishUncontested(alive[0]);
      }
    } else if (!BETTING.includes(this.phase)) {
      // between hands: chips stay out of play
      p.chips = 0; p.out = true;
      const live = this.players.filter(o => o.chips > 0 && !o.left);
      if (live.length < 2 && this.phase !== 'over') { this.timers.forEach(clearTimeout); this.timers.clear(); this._afterHand(0); return; }
    }
    this._change();
  }

  view(token) {
    const me = token ? this.players.find(p => p.token === token) : null;
    const reveal = this.phase === 'between' && this.result && this.result.showdown;
    const mp = me && !me.out ? me : null;
    const toCall = mp ? Math.max(0, this.currentBet - mp.bet) : 0;
    const maxTo = mp ? mp.bet + mp.chips : 0;
    return {
      handNo: this.handNo, phase: this.phase, community: this.community, pot: this.pot,
      currentBet: this.currentBet, bb: this.bb, sb: this.sb, dealer: this.dealer, toAct: this.toAct,
      deadline: this.deadline, mySeat: me ? me.seat : -1, toCall,
      minRaiseTo: mp ? Math.min(this.currentBet + this.minRaise, maxTo) : 0, maxTo,
      canRaise: !!mp && !mp.acted && maxTo > this.currentBet,
      players: this.players.map(p => ({
        seat: p.seat, name: p.name, chips: p.chips, bet: p.bet, folded: p.folded, allIn: p.allIn,
        out: p.out, left: p.left, bot: p.bot, connected: p.connected, lastAction: p.lastAction,
        hasCards: p.hand.length > 0 && !p.folded && !p.out,
        cards: p.hand.length && ((me && p.seat === me.seat) || (reveal && !p.folded && !p.out)) ? p.hand : null,
      })),
      result: this.result, log: this.log.slice(-14), over: this.over, winner: this.winner,
    };
  }
}

module.exports = { Table, bestOf, cmp, score5, HAND_NAMES, newDeck };
