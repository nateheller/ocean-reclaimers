# Ocean Reclaimers - Playable Prototype v0.1

A casual, top-down arcade ocean-cleanup game for **International Sibling Society (ISS)**, inspired by
*SB012 - Open Ocean Plastic-to-Fuel Autonomous Flotilla*.

> **This is a fictional, simplified game.** It is a stylized interpretation of the ISS 2030 SDG Acceleration
> Blueprint idea and makes no scientific, environmental or technology claims. The clearer water and extra wildlife at
> the 25 / 50 / 75% milestones are stylized rewards, not predictions.

Drive a small cleanup boat around Coral Bay, scoop up floating plastic, unload at the Reclamation Station for
credits, and buy upgrades. Clean 75% of the starting debris to bring the bay back to life.

**Stack:** TypeScript, Phaser 3, Vite. 2D, runs entirely in the browser. No accounts, APIs or paid services.
All art is drawn procedurally at runtime and all audio is synthesized with the Web Audio API, so the game ships
with no external image/audio files and no licensing concerns (the UI font is the bundled CC0 *ManusCC0* font).

## Run it

```bash
pnpm install        # or: npm install
pnpm dev            # dev server (PORT / HOST env vars override; default http://127.0.0.1:3000)
pnpm test           # automated tests (vitest)
pnpm build          # typecheck + production build into dist/
pnpm preview        # serve dist/ at http://localhost:4173
```

Requires Node 20+. `dist/` is fully static (relative base), so it can be hosted anywhere.

## Controls

| Key | Action |
| --- | --- |
| `W` / `Up`, `S` / `Down` | Forward / reverse |
| `A` / `Left`, `D` / `Right` | Steer |
| `Space` | Boost (short burst, then a cooldown) |
| `E` | Unload and open the upgrade menu when near the station |
| `1` `2` `3` | Buy an upgrade while docked (or click it) |
| `Esc` | Pause (or leave the dock menu) |
| `M` | Mute / unmute |

## How to play

1. Sail into floating plastic. Anything inside the arms in front of your bow is collected automatically.
2. Items must fit entirely: **bottle** 1 cargo / 2 credits, **container** 2 / 4, **fishing net** 4 / 10.
   There is no partial collection. Your hold starts at 20 units.
3. Return to the glowing station ring and press `E` to unload everything and bank the credits.
4. Spend credits on one-time upgrades: **Cargo Hold** (+10 capacity, 50), **Twin Engines** (+15% speed and
   acceleration, 60), **Wide Net Arms** (+25% collection width, 75). Each one visibly changes the boat.
5. Chain pickups quickly for **combo score** (3 = x1.2, 5 = x1.5, 10 = x2.0). Combos multiply the arcade score
   only, never cargo or credits.
6. Reach 25%, 50% and 75% cleaned for clearer water, returning coral colors and more wildlife.

Collisions with islands, reefs and rocks are solid but harmless: you slide along them.

## Project layout

```
src/
  config/
    balance.ts      <- ALL gameplay numbers (speeds, costs, cargo, combo, audio levels...)
    world.ts        <- Coral Bay layout: zones, islands, reefs, rocks, station, debris patches
  core/             <- pure TypeScript, no Phaser, fully unit-tested
    model.ts        game state: cargo, credits, score, upgrades, progress, milestones
    cargo.ts        hold rules (no partial collection / overflow)
    combo.ts        combo tracker (score only)
    stats.ts        vessel stats derived from upgrades
    boat.ts         boat physics, collision resolution, collection zone, boost
    worldgen.ts     deterministic seeded debris placement and obstacle list
    save.ts         versioned, validated localStorage persistence
    rng.ts          seeded RNG + string hashing
  render/           <- Phaser / canvas / Web Audio
    textures.ts     procedural art for the boat, debris, wildlife, water tiles
    worldart.ts     baked islands, reefs, rocks, station, depth shading
    boatView.ts     boat, net arms, hold crates and engines (upgrades are visible)
    wildlife.ts     fish schools, turtles, dolphins, manta ray, whale (appear with milestones)
    audio.ts        synthesized ambience, engine hum and sound effects
    input.ts        keyboard input
  scenes/GameScene.ts   ties core + rendering together (game feel, FX, flow)
  ui/ui.ts, ui.css      compact DOM HUD, dock menu, pause and result panels
tests/
  core.test.ts      cargo limits, credits, upgrade costs/effects, combos, progress, save/load, determinism
  pacing.test.ts    headless bot playthrough: checks the pacing of the first upgrade and the 75% goal
```

### Tuning

Open `src/config/balance.ts`. Handling (`boat`), collection zone, debris values, upgrade costs and effects, combo
tiers and window, milestones, camera and audio levels are all there. The debris layout is data in
`src/config/world.ts`; placement is generated from a fixed seed (`WORLD.seed`), so every New Game has identical
starting debris positions and a save only needs to store which items were removed.

`pnpm test` includes a pacing bot that fails if the first upgrade takes more than 4 minutes or if 75% is
unreachable, which is a useful guard when changing numbers. (The bot steers far better than a person, so human
pacing is slower: expect the first upgrade after roughly 1.5 to 2 minutes and 75% after about 10 to 15 minutes.)

### Saving

Progress (credits, score, upgrades, removed debris, milestones, boat position) is stored in `localStorage` under
a versioned key, auto-saved every few seconds, on every unload/purchase/milestone, on pause and when the tab
closes. A corrupt or incompatible save is ignored safely. **New Game** (title or pause menu, with a confirmation
click) erases it.

## Known limitations (v0.1)

- Keyboard only. No touch or gamepad controls yet.
- Art is procedurally drawn and intentionally simple; wildlife swims as sprites without skeletal animation.
- Tuned for desktop browsers. On slow GPUs the game lowers its internal resolution automatically.
- Debris is fixed per seed and does not respawn. After 75% you can keep sailing to clean the rest, but there is no
  further progression.
- Boat collision uses circles (islands are unions of circles), so shorelines are slightly forgiving.
- Audio starts after the first key press or click (browser autoplay rules).
- The 75% goal is a gentle result panel, not a scored finale. No leaderboards.
- Single region and single vessel by design: no fleets, currents, storms, carbon accounting or multiplayer.
- The pacing numbers come from a bot plus design estimates; they have not been tuned with real players yet.

## Suggestions for v0.2

- Touch and gamepad controls; accessibility options (reduced motion, color-blind-safe debris outlines).
- Repeatable upgrade levels with a soft economy curve, plus a couple of boat hull skins.
- Debris drifting slowly with a simple wind to reward reading the water (still no complex currents).
- Short journal entries when wildlife returns, written as clearly fictional flavor text.
- A timed "tide run" mode that uses combo score for a local personal-best board.
- Hand-painted sprite sheets and animated wildlife in place of procedural art.
- A first-pickup tutorial trail and an optional mini-map.

## Credits and licences

- Code, procedurally generated art and synthesized audio: original to this project.
- Font: *ManusCC0* (bundled in `public/fonts`, see `ManusCC0-LICENSE.txt`), CC0.
- Phaser 3 (MIT).
