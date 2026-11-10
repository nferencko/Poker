'use strict';
// Simulates full games with bots only; checks chips are conserved and games finish.
const { Table, bestOf, cmp } = require('../server/engine');
const { heuristic, STYLES } = require('../server/bot');

// evaluator sanity
const C = (r, s) => ({ r, s });
const royal = bestOf([C(14, 's'), C(13, 's'), C(12, 's'), C(11, 's'), C(10, 's'), C(2, 'd'), C(3, 'c')]);
const wheel = bestOf([C(14, 's'), C(2, 'h'), C(3, 'd'), C(4, 'c'), C(5, 's'), C(9, 'd'), C(9, 'c')]);
const quads = bestOf([C(9, 's'), C(9, 'h'), C(9, 'd'), C(9, 'c'), C(5, 's'), C(2, 'd'), C(3, 'c')]);
const full = bestOf([C(9, 's'), C(9, 'h'), C(9, 'd'), C(5, 'c'), C(5, 's'), C(2, 'd'), C(3, 'c')]);
if (royal[0] !== 8 || wheel[0] !== 4 || wheel[1] !== 5 || quads[0] !== 7 || full[0] !== 6 || cmp(quads, full) <= 0) throw new Error('evaluator broken');

let games = 0;
const N = 200;
let pending = N;
for (let g = 0; g < N; g++) {
  const n = 2 + (g % 5);
  const players = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const chips = 100 + Math.floor(Math.random() * 900);
    total += chips;
    players.push({ name: 'P' + i, bot: true, style: STYLES[i % 5], chips });
  }
  const t = new Table({ players, bb: 40, fast: true, botFn: async v => heuristic(v, null) });
  let hands = 0;
  t.onChange = () => {
    const sum = t.players.reduce((s, p) => s + p.chips + p.total, 0);
    if (sum !== total) { console.error('CHIP LEAK', sum, total); process.exit(1); }
    if ((t.over || t.handNo >= 300) && !t._done) { t._done = true; t.destroy(); games++; if (--pending === 0) { console.log(`OK: ${games} games finished, chips conserved`); process.exit(0); } }
  };
  t.startHand();
}
setTimeout(() => { console.error(`TIMEOUT: only ${games}/${N} finished`); process.exit(1); }, 60000);
