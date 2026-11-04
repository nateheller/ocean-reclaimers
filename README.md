# Ocean Reclaimers - v0.2 (Meaningful Progression and Cargo Tenders)

A casual, top-down arcade ocean-cleanup game for **International Sibling Society (ISS)**, inspired by
*SB012 - Open Ocean Plastic-to-Fuel Autonomous Flotilla*.

> **This is a fictional, simplified game.** It is a stylized interpretation of the ISS 2030 SDG Acceleration
> Blueprint idea and makes no scientific, environmental or technology claims. The clearer water and extra wildlife at
> the 25 / 50 / 75% milestones are stylized rewards, not predictions.

Drive a small cleanup boat around Coral Bay, scoop up floating plastic, unload at the Reclamation Station for
credits, and grow your operation: five levels each of cargo, engine and collection arms, then a **Cargo Tender**
(and a second one) that ferries your catch to the station while you keep collecting. Clean 75% of the starting
debris to bring the bay back to life.

**Stack:** TypeScript, Phaser 3, Vite. 2D, runs entirely in the browser. No accounts, APIs or paid services.
All art is drawn procedurally at runtime and all audio is synthesized with the Web Audio API, so the game ships
with no external image/audio files and no licensing concerns (the UI font is the bundled CC0 *ManusCC0* font).

The v0.1 prototype is preserved as the git tag `v0.1-prototype`
(`git checkout v0.1-prototype`). Existing v0.1 saves are migrated automatically (see "Saving").

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
| `R` | Call a Cargo Tender to take cargo from your hold (once you own one) |
| `1` - `5` | Buy an upgrade while docked (or click it) |
| `Esc` | Pause (or leave the dock menu) |
| `M` | Mute / unmute |

## How to play

1. Sail into floating plastic. Anything inside the arms in front of your bow is collected automatically.
2. Items must fit entirely: **bottle** 1 cargo / 2 credits, **container** 2 / 4, **fishing net** 4 / 10.
   There is no partial collection. Your hold starts at 20 units.
3. Return to the glowing station ring and press `E` to unload everything and bank the credits.
4. Spend credits at the station. Every boat upgrade has **five levels** and visibly changes the boat:
   * **Cargo Hold**: +5 units per level (20 -> 45). More crates are stacked on deck.
   * **Engine**: +5% speed and acceleration per level, up to +25%. More exhaust, bigger wake.
   * **Collection Arms**: +8% width per level, up to +40%. The net arms grow longer and gain floats and mesh.
5. After a few station visits the **Cargo Tender** is offered (see below).
6. Chain pickups quickly for **combo score** (3 = x1.2, 5 = x1.5, 10 = x2.0). Combos multiply the arcade score
   only, never cargo or credits.
7. Reach 25%, 50% and 75% cleaned for clearer water, returning coral colors and more wildlife.

Collisions with islands, reefs and rocks are solid but harmless: you slide along them.

### Cargo Tender

A small autonomous barge that carries cargo - it never collects debris itself. Press `R` and the nearest free
tender sails to you, takes whole items from your hold (up to its capacity), carries them to the station,
unloads, and returns to your side. Credits are paid **only when the delivery happens**, never at dispatch. You
keep collecting the whole time. Tenders steer around islands and reefs using a shared navigation grid and have a
recovery routine if they ever get stuck (cargo is never lost or duplicated).

| Level | Effect |
| --- | --- |
| 1 | Unlocks your first tender (carries 10) |
| 2 | Capacity 15 |
| 3 | +35% travel speed |
| 4 | Capacity 25 |
| 5 | Automatic dispatch: when your hold is about 70% full a free tender comes on its own |

A separate **Second Tender** purchase (needs Cargo Tender level 2) adds a second, fully independent tender with its
own cargo, position and status. A small status chip per tender (Available, Heading to you, Loading, Delivering,
Returning) sits under the cargo meter - there is no fleet panel.

### Upgrade prices

`src/config/balance.ts` keeps the original design table as `baseCosts` and multiplies it by
`upgrades.priceScale` (currently **0.2**). Why: Coral Bay holds about 898 credits of plastic in total, 75% cleanup is
about 674 credits, but the unscaled design table (1,935 credits for boat upgrades alone) could never be bought.
Without changing debris amounts, the scale makes the full shop add up to roughly what a good run earns by 75%.

| Level | Cargo Hold | Engine | Collection Arms | Cargo Tender | Second Tender |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 7 | 8 | 9 | 50 | 60 |
| 2 | 12 | 14 | 16 | 30 | |
| 3 | 19 | 22 | 25 | 45 | |
| 4 | 29 | 34 | 38 | 65 | |
| 5 | 44 | 52 | 58 | 80 | |

Set `priceScale` to `1` to use the original table (very expensive - fine for testing a much longer game).

The pacing test plays the game with a bot (see below). With the shipped numbers it buys roughly: seven early boat
levels before 15% cleaned, the tender at about 20%, more boat and tender levels between 25% and 55%, and the last
upgrades at 55-75%. A human pilot needs longer in minutes but passes the same percentage milestones.

## Project layout

```
src/
  config/
    balance.ts      <- ALL gameplay numbers (speeds, costs, cargo, tenders, combo, audio levels...)
    world.ts        <- Coral Bay layout: zones, islands, reefs, rocks, station, debris patches
  core/             <- pure TypeScript, no Phaser, fully unit-tested
    model.ts        game state: cargo, credits, score, upgrade levels, fleet, progress, milestones
    upgrades.ts     upgrade registry (name, levels, costs, effect text, purchase rules) - add new tracks here
    stats.ts        vessel and tender stats derived from upgrade levels
    cargo.ts        hold rules (no partial collection / overflow)
    combo.ts        combo tracker (score only)
    tender.ts       TenderFleet: independent autonomous vessels, state machine, recovery, snapshots
    nav.ts          reusable navigation grid with A* and path smoothing (for any autonomous vessel)
    navmap.ts       the Coral Bay navigation grid and obstacle list
    events.ts       game events and lifetime run statistics (achievement-ready, nothing hard-wired)
    boat.ts         boat physics, collision resolution, collection zone, boost
    worldgen.ts     deterministic seeded debris placement and obstacle list
    save.ts         versioned, validated localStorage persistence (v1 -> v2 migration)
    rng.ts          seeded RNG + string hashing
  render/           <- Phaser / canvas / Web Audio
    textures.ts     procedural art for the boat, tender, debris, wildlife, water tiles
    worldart.ts     baked islands, reefs, rocks, station, depth shading
    boatView.ts     boat, net arms, hold crates and engines (five visible levels per track)
    tenderView.ts   tender sprites, wakes and status labels
    wildlife.ts     fish schools, turtles, dolphins, manta ray, whale (appear with milestones)
    audio.ts        synthesized ambience, engine hum and sound effects
    input.ts        keyboard input
  scenes/GameScene.ts   ties core + rendering together (game feel, FX, flow)
  ui/ui.ts, ui.css      compact DOM HUD, dock menu, tender chips, pause and result panels
tests/
  core.test.ts      cargo limits, credits, multi-level upgrade costs/effects, combos, progress, save/load, determinism
  tender.test.ts    tender transfers, conservation, credits, independence, navigation, save/load mid-delivery, recovery
  pacing.test.ts    headless bot playthrough: first upgrade, tender timing, purchase spread, trips saved by tenders
```

### Extending (prepared, not built)

* **Run upgrades, research, random choices, synergies:** every purchasable thing is an entry in `UPGRADES`
  (`core/upgrades.ts`) with its own level count, cost function and effect text; `core/stats.ts` turns levels into
  numbers. A future "three random options" or research layer can add entries or modifiers there without touching
  collection logic.
* **Auto Trawlers:** `TenderFleet` has no dependency on player input - each vessel owns its cargo, position and
  state, and navigation (`nav.ts`) is generic. A trawler would be another vessel kind that adds a "find debris and
  collect" state to the same pattern.
* **Achievements and cosmetics:** `core/events.ts` emits typed events (pickups by type, combos, deliveries, milestones,
  purchases) and keeps persistent counters (bottles collected, nets recovered, best combo, tender deliveries...).
  No achievement UI exists yet.

### Tuning

Open `src/config/balance.ts`. Handling (`boat`), collection zone, debris values, upgrade costs and effects,
tender behaviour (`tender`), navigation grid (`nav`), combo tiers and window, milestones, camera and audio levels
are all there. The debris layout is data in `src/config/world.ts`; placement is generated from a fixed seed
(`WORLD.seed`), so every New Game has identical starting debris positions and a save only needs to store which
items were removed.

`pnpm test` includes a pacing bot that navigates with the same grid, buys upgrades like a casual player and calls
tenders. It fails if the first upgrade takes more than 4 minutes, if the tender is not attainable between 10% and 30%
cleanup, if boat upgrades alone empty the shop before 15%, if nothing is left to buy after 50%, or if 75% is
unreachable - a useful guard when changing numbers. The bot prints its purchase timeline when the suite runs.

### Saving

Progress (credits, score, upgrade levels, removed debris, milestones, run statistics, boat position and every
tender's position, status and cargo) is stored in `localStorage` under a versioned key, auto-saved every few
seconds, on every unload/purchase/delivery/milestone, on pause and when the tab closes. A corrupt or
incompatible save is ignored safely. **New Game** (title or pause menu, with a confirmation click) erases it.

*v0.1 saves migrate on load*: the old one-time upgrades become levels (Cargo Hold -> level 2, Engine -> 3, Arms -> 3,
roughly matching their old strength), so nobody loses power. A save made while a tender was mid-trip resumes safely:
a tender that had not yet picked anything up goes back to being available, one carrying cargo continues its delivery
and cargo is neither lost nor paid twice.

## Known limitations (v0.2)

* Keyboard only. No touch or gamepad controls yet.
* Art is procedurally drawn and intentionally simple; wildlife swims as sprites without skeletal animation.
* Tuned for desktop browsers. On slow GPUs the game lowers its internal resolution automatically.
* Debris is fixed per seed and does not respawn. After 75% you can keep sailing to clean the rest.
* Boat collision uses circles (islands are unions of circles), so shorelines are slightly forgiving.
* Tenders follow a coarse 40 px navigation grid. They look natural in open water but may take wide turns near
  tight reef gaps; if one is blocked for too long it is relocated to the nearest safe water with its cargo intact.
* A tender always carries whole items, so a hold full of nets may leave a unit or two behind at low tender levels.
* The price scale (0.2) came from the bot and from the credits available in the bay; it has not been tuned with
  real players yet. Early boat upgrades are cheap on purpose, the tender and the late levels carry the real cost.
* The achievements/statistics layer records data but has no user interface; there are no cosmetics yet.
* Audio starts after the first key press or click (browser autoplay rules).
* Single region by design: no weather, currents, multiplayer or carbon accounting.

## Suggestions for the next iteration

* Playtest the economy with real players and adjust `priceScale` and the tender price list (one number each).
* Offer three random upgrade choices at the 25 / 50 / 75% milestones to start the roguelite build variety.
* Auto Trawlers: a vessel type that finds debris, collects, returns and unloads, reusing the tender fleet and grid.
* Achievements with cosmetic rewards (hull colors, flags, tender paint) using the existing event stream.
* A third tender, a tender "priority target" (send it to the biggest items in your hold) and a tiny mini-map.
* Touch and gamepad controls; accessibility options (reduced motion, color-blind-safe debris outlines).
* Hand-painted sprite sheets and animated wildlife in place of procedural art.

## Credits and licences

* Code, procedurally generated art and synthesized audio: original to this project.
* Font: *ManusCC0* (bundled in `public/fonts`, see `ManusCC0-LICENSE.txt`), CC0.
* Phaser 3 (MIT).
