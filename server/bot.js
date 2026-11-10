'use strict';
const { bestOf } = require('./engine');

const STYLES = [
  { name: 'Ace', loose: 0.0, aggr: 0.6, bluff: 0.06 },
  { name: 'Maverick', loose: 0.08, aggr: 0.85, bluff: 0.14 },
  { name: 'Judge', loose: -0.08, aggr: 0.35, bluff: 0.02 },
  { name: 'Lucky', loose: 0.1, aggr: 0.5, bluff: 0.1 },
  { name: 'Shark', loose: -0.02, aggr: 0.75, bluff: 0.08 },
  { name: 'Duke', loose: -0.05, aggr: 0.55, bluff: 0.04 },
  { name: 'Vegas', loose: 0.06, aggr: 0.7, bluff: 0.12 },
  { name: 'Rookie', loose: 0.12, aggr: 0.3, bluff: 0.05 },
  { name: 'Ginger', loose: 0.02, aggr: 0.45, bluff: 0.07 },
  { name: 'Bishop', loose: -0.1, aggr: 0.4, bluff: 0.03 },
];

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

// Rough hand strength 0..1
function strength(hole, community) {
  if (!community.length) {
    const [a, b] = hole.map(c => c.r).sort((x, y) => y - x);
    const suited = hole[0].s === hole[1].s;
    let s;
    if (a === b) s = 0.5 + ((a - 2) / 12) * 0.5;
    else {
      s = ((a + b - 5) / 23) * 0.55;
      if (suited) s += 0.06;
      if (a - b === 1) s += 0.05; else if (a - b === 2) s += 0.02; else if (a - b > 4) s -= 0.05;
    }
    return clamp(s);
  }
  const sc = bestOf(hole.concat(community));
  const cat = sc[0];
  let s = [0.12, 0.3, 0.65, 0.75, 0.82, 0.86, 0.94, 0.98, 1][cat];
  if (cat === 0) s += ((Math.max(hole[0].r, hole[1].r) - 2) / 12) * 0.08;
  if (cat === 1) {
    const pr = sc[1];
    const mine = hole.some(c => c.r === pr);
    s += ((pr - 2) / 12) * 0.2;
    if (!mine) s -= 0.12;
    else if (pr >= Math.max(...community.map(c => c.r))) s += 0.06; // top pair
  }
  if (cat === 2 && !hole.some(c => c.r === sc[1]) && !hole.some(c => c.r === sc[2])) s -= 0.2;
  if (community.length < 5 && cat < 5) {
    const all = hole.concat(community);
    for (const suit of ['s', 'h', 'd', 'c']) {
      if (all.filter(c => c.s === suit).length === 4 && hole.some(c => c.s === suit)) s += 0.12;
    }
  }
  return clamp(s);
}

// Free built-in AI: no API key required.
function heuristic(v, style) {
  style = style || STYLES[0];
  const rnd = Math.random;
  let s = strength(v.hole, v.community) + style.loose + (rnd() - 0.5) * 0.16;
  s -= Math.max(0, v.opponents - 1) * 0.015;
  const potOdds = v.toCall / (v.pot + v.toCall || 1);
  const raiseTo = frac => {
    const t = v.currentBet + Math.max(v.minRaiseTo - v.currentBet, Math.round(v.pot * frac));
    return Math.max(v.minRaiseTo, Math.min(t, v.maxTo));
  };
  if (v.toCall === 0) {
    if (v.canRaise) {
      if (s > 0.72 && rnd() < 0.5 + style.aggr * 0.4) return { action: 'raise', amount: raiseTo(0.5 + rnd() * 0.6) };
      if (s > 0.5 && rnd() < style.aggr * 0.45) return { action: 'raise', amount: raiseTo(0.4) };
      if (rnd() < style.bluff) return { action: 'raise', amount: raiseTo(0.6) };
    }
    return { action: 'check' };
  }
  const risk = v.toCall / (v.chips || 1);
  if (v.canRaise && s > 0.85 && rnd() < 0.4 + style.aggr * 0.4) return { action: 'raise', amount: raiseTo(0.75) };
  if (s > potOdds + 0.12 && (risk < 0.5 || s > 0.7)) return { action: 'call' };
  if (risk < 0.15 && rnd() < style.bluff * 2) return { action: 'call' };
  return { action: 'fold' };
}

// Optional: Claude-powered decisions when ANTHROPIC_API_KEY is set.
async function claudeDecide(v, player) {
  const key = process.env.ANTHROPIC_API_KEY;
  const model = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
  const card = c => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[c.r] || c.r) + c.s;
  const style = player.style || STYLES[0];
  const prompt = [
    `You are "${player.name}", a Texas Hold'em player (no-limit, Vegas cash rules). Personality: aggression ${style.aggr}/1, bluff frequency ${style.bluff}.`,
    `Your hole cards: ${v.hole.map(card).join(' ')}`,
    `Board (${v.phase}): ${v.community.length ? v.community.map(card).join(' ') : '(none)'}`,
    `Pot: ${v.pot}. To call: ${v.toCall}. Your stack: ${v.chips}. Big blind: ${v.bb}. Opponents still in hand: ${v.opponents}. You are ${v.isButton ? '' : 'not '}on the button.`,
    `Can raise: ${v.canRaise}${v.canRaise ? ` (raise-to total must be between ${v.minRaiseTo} and ${v.maxTo}; ${v.maxTo} is all-in)` : ''}.`,
    `Players: ${v.table.map(t => `${t.name} stack ${t.chips} bet ${t.bet}${t.folded ? ' folded' : ''}${t.allIn ? ' all-in' : ''}${t.you ? ' (you)' : ''}`).join('; ')}`,
    `Recent: ${v.recent.join(' | ')}`,
    `Reply with ONLY JSON: {"action":"fold|check|call|raise","amount":<raise-to total, only for raise>}. "check" only if to-call is 0.`,
  ].join('\n');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 100, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('Claude API ' + res.status);
  const data = await res.json();
  const text = (data.content || []).map(c => c.text || '').join('');
  const m = text.match(/\{[^}]*\}/);
  if (!m) throw new Error('no JSON');
  const d = JSON.parse(m[0]);
  if (!['fold', 'check', 'call', 'raise'].includes(d.action)) throw new Error('bad action');
  return d;
}

const claudeEnabled = () => !!process.env.ANTHROPIC_API_KEY;

async function botDecide(v, player) {
  if (claudeEnabled()) {
    try { return await claudeDecide(v, player); } catch (e) { /* fall back to free AI */ }
  }
  return heuristic(v, player.style);
}

module.exports = { STYLES, heuristic, botDecide, claudeEnabled };
