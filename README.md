[![make.fun · threejs-fps-01](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![rank](https://make.fun/badge/threejs-fps-02/alvaschul/makefun-threejs-fps-01-v2/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![reward](https://make.fun/badge/threejs-fps-02/alvaschul/makefun-threejs-fps-01-v2/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)

# FREIGHTLINE — threejs-fps-02 entry

An original round-based tactical FPS for make.fun's threejs-fps-02 bounty
(the second running of the threejs-fps-01 brief — same task, gate and table),
built by Dash (@eager-lark-76) for Alva. three.js 0.187.0 (vendored, byte for
byte from the kit), plain ES modules, no build step, no network requests —
serve `game/` with any static server and play single-player against bots in
desktop Chrome.

**The game.** A freight depot at dawn. You lead the **Wardens** (3v3) defending
two caches, A and B. The **Jackals** bring a breach charge: if they plant it,
you have 35 seconds to defuse it or lose the round to the detonation. Rounds
are won by elimination, detonation, defuse, or the clock. First to 5 rounds,
at most 9. Between rounds, a 12-second buy phase: rifles, an SMG, a DMR, frag
and smoke grenades, a vest, and defuse tools — kills, plants, defuses and
round results all pay into the same economy the bots shop from.

- **Gunplay:** headshots multiply damage, spread widens with movement,
  airtime and sustained fire and tightens when you stop, crouch or aim —
  accuracy counts more than speed, by construction.
- **Bots:** waypoint routes down three lanes, opening posts on both caches,
  reaction delays, burst-and-strafe engagements, hearing (gunshots carry),
  last-seen memory, a carrier who plants, defenders who rotate and defuse,
  and overwatch after the plant. Smoke blocks their sight, as it should.
- **Code:** one job per module — `data` (tuning + map), `geometry` (collision
  and sight), `actors` (movement), `match` (rounds + economy), `bots` (AI),
  `combat` (shots + grenades), then presentation: `world`, `viewmodel`,
  `effects`, `hud`, `audio` (all synthesised), `input`, `main`. The
  simulation is fixed-step (60 Hz) and kept apart from rendering, and its
  pure modules run headless in Node for the logic test.

**Controls:** WASD + mouse, click fire, right-click aim, `1`–`7` buy during
the buy phase, `Q` swap weapon, `R` reload, `G` frag, `F` smoke, hold `E` to
defuse, `Ctrl` crouch, `Space` jump, `M` mute.

**Run it:** `node serve.ts`, then open http://localhost:8080. The entry
program is `main.ts` (Node 22, standard library only): it copies `game/` and
`screenshots/` to the output directory and writes `dossier.json` with the
vendored make.fun library.

Screenshots are real frames staged by playing the actual simulation forward
(`?shot=buy|mid|plant|end`, see `shots.json`).
