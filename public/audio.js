'use strict';
// Synthesized sound effects + generative chill background music (Web Audio, no asset files).
const Sound = (() => {
  let ctx, master, sfxBus, musicBus, delay, started = false, timer = null;
  const pref = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) {} };
  const state = { music: pref('pokerMusic', true), sfx: pref('pokerSfx', true) };

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    setTimeout(loadSamples, 0);
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = state.sfx ? 0.8 : 0; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = state.music ? 0.32 : 0; musicBus.connect(master);
    // soft echo for the music
    delay = ctx.createDelay(1); delay.delayTime.value = 0.42;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(musicBus);
  }

  const midi = n => 440 * Math.pow(2, (n - 69) / 12);

  function tone(bus, { f, t = ctx.currentTime, dur = 0.2, type = 'sine', vol = 0.3, attack = 0.005, slide = 0, send = 0, lpf = 0 }) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (lpf) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lpf; o.connect(fl); node = fl; }
    node.connect(g); g.connect(bus);
    if (send && delay) { const s = ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(delay); }
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(bus, { t = ctx.currentTime, dur = 0.08, vol = 0.2, freq = 3000, q = 1, type = 'bandpass' }) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = ctx.createBufferSource(); s.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(bus); s.start(t);
  }

  // ---------- sound effects: chips hitting the table ----------
  // Optional real recordings: put chip1.mp3 / chip2.mp3 / ... (or .ogg/.wav) in public/sounds/.
  // If any load, they are used instead of the synthesized sound.
  const samples = [];   // bet sounds: bet1..bet6
  let dealBuf = null;   // card-dealing sound: deal.wav
  const decode = url => fetch(url).then(r => (r.ok ? r.arrayBuffer() : Promise.reject()))
    .then(b => new Promise((res, rej) => ctx.decodeAudioData(b, res, rej)));
  function loadSamples() {
    ['mp3', 'ogg', 'wav'].forEach(ext => {
      decode(`sounds/deal.${ext}`).then(b => (dealBuf = b)).catch(() => {});
      for (let i = 1; i <= 6; i++) decode(`sounds/bet${i}.${ext}`).then(b => samples.push(b)).catch(() => {});
    });
  }
  function playBuf(buf, t, vol, rate = 1) {
    const src = ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
    const g = ctx.createGain(); g.gain.value = vol; src.connect(g); g.connect(sfxBus); src.start(t);
  }
  function playSample(t, vol) { playBuf(samples[Math.floor(Math.random() * samples.length)], t, vol); }

  // Synthesized clay-chip click: a sharp contact transient plus a few short, inharmonic ringing modes
  // (chips are stiff discs, so they "tick" rather than "thud"), and a tiny table thump underneath.
  function chipHit(t, vol) {
    const r = 0.92 + Math.random() * 0.16;
    noise(sfxBus, { t, dur: 0.006, vol: 0.9 * vol, freq: 2500, q: 0.4, type: 'highpass' });          // contact snap
    [[1150, 0.55, 0.05], [2480, 0.5, 0.04], [3900, 0.35, 0.03], [5600, 0.2, 0.02]].forEach(([f, v, d]) =>
      noise(sfxBus, { t, dur: d, vol: v * vol, freq: f * r, q: 14 }));                                  // ringing modes
    tone(sfxBus, { f: 170 * r, t, dur: 0.04, vol: 0.28 * vol, type: 'sine', attack: 0.001, slide: -60 }); // felt/table thump
  }
  // Fold: a card tossed face-down onto the felt: a short filtered-noise swish that sweeps down, then a soft tap.
  function foldToss() {
    const t = ctx.currentTime, dur = 0.22, len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) { const x = i / len; d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * Math.min(1, x * 1.2)) ** 2; }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.1;
    f.frequency.setValueAtTime(5200, t); f.frequency.exponentialRampToValueAtTime(1400, t + dur);
    const g = ctx.createGain(); g.gain.value = 0.55;
    src.connect(f); f.connect(g); g.connect(sfxBus); src.start(t);
    noise(sfxBus, { t: t + dur - 0.03, dur: 0.03, vol: 0.25, freq: 1800, q: 0.8 });          // card lands
    tone(sfxBus, { f: 140, t: t + dur - 0.03, dur: 0.05, vol: 0.16, type: 'sine', attack: 0.002, slide: -40 });
  }
  const sfx = {
    fold() { foldToss(); },
    deal(vol = 1) { if (dealBuf) playBuf(dealBuf, ctx.currentTime, vol); },
    // n = number of chips landing (1..6): they clatter onto each other with decaying volume.
    chips(n = 2) {
      let t = ctx.currentTime;
      if (samples.length) n = n > 2 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const v = Math.max(0.35, 1 - i * 0.15) * (0.85 + Math.random() * 0.15);
        if (samples.length) playSample(t, v); else chipHit(t, v);
        t += samples.length ? 0.12 + Math.random() * 0.06 : 0.03 + Math.random() * 0.045;
      }
    },
  };

  // ---------- chill background music ----------
  // Slow lo-fi progression: Cmaj7 - Am7 - Fmaj7 - G6, soft pads, bass, sparse pentatonic plucks with echo.
  const CHORDS = [[48, 55, 59, 64, 67], [45, 52, 55, 60, 64], [41, 48, 52, 57, 64], [43, 50, 55, 59, 64]];
  const SCALE = [72, 74, 76, 79, 81, 84, 79, 76]; // C major pentatonic-ish
  const BPM = 66, BEAT = 60 / BPM, BAR = BEAT * 4;
  let nextBar = 0, barIdx = 0;

  function scheduleBar(t, idx) {
    const chord = CHORDS[idx % CHORDS.length];
    // pad: soft detuned triangle/sine with long attack
    chord.slice(1).forEach(n => {
      tone(musicBus, { f: midi(n), t, dur: BAR + 0.6, type: 'triangle', vol: 0.05, attack: 1.2, lpf: 900 });
      tone(musicBus, { f: midi(n) * 1.004, t, dur: BAR + 0.6, type: 'sine', vol: 0.045, attack: 1.4 });
    });
    // bass on beats 1 and 3
    [0, 2].forEach(b => tone(musicBus, { f: midi(chord[0] - 12), t: t + b * BEAT, dur: BEAT * 1.8, type: 'sine', vol: 0.2, attack: 0.02 }));
    // soft brushed hat on offbeats
    for (let i = 0; i < 8; i++) if (i % 2) noise(musicBus, { t: t + i * BEAT / 2, dur: 0.05, vol: 0.025, freq: 7000, q: 0.6, type: 'highpass' });
    // soft kick on 1 and 3
    [0, 2].forEach(b => tone(musicBus, { f: 90, t: t + b * BEAT, dur: 0.18, type: 'sine', vol: 0.12, slide: -45 }));
    // random sparse melody (electric-piano-ish)
    let step = Math.floor(Math.random() * 3);
    for (let i = 0; i < 8; i++) {
      if (Math.random() < 0.38) {
        step = (step + Math.floor(Math.random() * 5) - 2 + SCALE.length) % SCALE.length;
        tone(musicBus, { f: midi(SCALE[step] - (Math.random() < 0.3 ? 12 : 0)), t: t + i * BEAT / 2 + (Math.random() * 0.03), dur: 1.1, type: 'sine', vol: 0.08, attack: 0.01, send: 0.5 });
      }
    }
  }

  function pump() {
    if (!ctx) return;
    while (nextBar < ctx.currentTime + 2.5) { scheduleBar(nextBar, barIdx++); nextBar += BAR; }
  }
  function startMusic() {
    if (!ctx || timer) return;
    nextBar = ctx.currentTime + 0.1; pump();
    timer = setInterval(pump, 500);
  }

  function setGain(bus, v) { if (bus) bus.gain.setTargetAtTime(v, ctx.currentTime, 0.15); }

  return {
    state,
    // call from a user gesture to satisfy browser autoplay rules
    start() {
      init(); if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      if (!started) { started = true; startMusic(); }
    },
    play(name, arg) { if (ctx && state.sfx && ctx.state === 'running' && sfx[name]) { try { sfx[name](arg); } catch (e) {} } },
    toggleMusic() { state.music = !state.music; save('pokerMusic', state.music); init(); if (ctx) setGain(musicBus, state.music ? 0.32 : 0); return state.music; },
    toggleSfx() { state.sfx = !state.sfx; save('pokerSfx', state.sfx); init(); if (ctx) setGain(sfxBus, state.sfx ? 0.8 : 0); return state.sfx; },
  };
})();
