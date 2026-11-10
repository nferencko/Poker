# Texas Hold'em

No-limit Texas Hold'em with Vegas cash-game rules (dealer button, small/big blind, burn cards, min-raise = last raise, short all-in doesn't reopen betting, side pots).

- **Single player**: 1–9 AI opponents (10 seats max); one starting balance applies to everyone.
- **Multiplayer**: host gets a 5-letter code; others join with it (up to the host's human-seat limit). On the setup page the host sets the starting balance, the number of human seats and the number of AI players (10 seats total, never more). Busted players spectate or leave. 45s turn timer auto-folds/checks.

## Run
    npm install
    npm start        # http://localhost:3000

## AI opponents (free by default)
The default AI is a built-in heuristic poker bot: no API key, no cost.
To use Claude for opponent decisions instead, set `ANTHROPIC_API_KEY` (optionally `CLAUDE_MODEL`).
If a Claude call fails or times out, the bot falls back to the built-in AI. Note the Claude API is pay-per-use.

## Test
    npm test   # 200 simulated games, checks chip conservation

## Deploy
Needs a host that supports WebSockets / long-running Node (e.g. Render or Railway free tiers). Static-only hosts won't work for multiplayer.

## Sound
A realistic chip-on-table sound plays whenever chips are bet, over a generative chill background track are synthesized in the browser (Web Audio, no asset files). Use the 🎵 and 🔊 buttons (bottom right) to toggle; choices are remembered. Browsers only start audio after your first click.

## Voice chat (multiplayer)
Each player can switch voice **On/Off** (bottom-left panel; off by default) and **mute their mic** while on. Audio is peer-to-peer WebRTC, so the server only relays connection setup and bandwidth stays free. The list shows who is in the channel, who is muted, and who is speaking.
- Browsers only allow microphones on **https** or `localhost`. Hosts like Render/Railway provide https automatically; opening the game via a LAN IP over plain http will not allow the mic.
- It uses free public STUN servers. Most home networks connect fine; a few strict networks (some corporate/school/mobile) need a TURN relay, which isn't free, so voice may not connect for those players.
