# Ocean Reclaimers - v0.3 (Fleet, Exploration and Arcade Competition)

A casual, top-down arcade ocean-cleanup game for **International Sibling Society (ISS)**, inspired by
*SB012 - Open Ocean Plastic-to-Fuel Autonomous Flotilla*.

> **This is a fictional, simplified game.** It is a stylized interpretation of the ISS 2030 SDG Acceleration
> Blueprint idea and makes no scientific, environmental or technology claims. The clearer water and extra wildlife at
> the 25 / 50 / 75% milestones are stylized rewards, not predictions. Scores and times are game values only.

Drive a small cleanup boat around Coral Bay, scoop up floating plastic, unload at the Reclamation Station for
credits and grow your operation: five levels each of cargo, engine and collection arms, **Cargo Tenders** that ferry
your catch home, **Auto Trawlers** that collect on their own, and an **Ocean Sonar** that finds the plastic for you.
Clean 75% of the starting debris to complete the expedition, then chase a better time and score on the local
high-score table.

**Stack:** TypeScript, Phaser 3, Vite. 2D, runs entirely in the browser. No accounts, APIs or paid services. All art
is drawn procedurally at runtime and all audio is synthesized with the Web Audio API, so the game ships with no
external image/audio files (the UI font is the bundled CC0 *ManusCC0* font).

Earlier versions are tagged in git: `v0.1-prototype`, and the v0.2 checkpoint on `main`. Older saves are migrated
automatically (see "Saving and migration").

## Run it

```bash
pnpm install        # or: npm install
pnpm dev            # dev server (PORT / HOST env vars override; default http://127.0.0.1:3000)
pnpm test           # automated tests (vitest, 128 tests)
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
| `1` - `8` | Buy an upgrade while docked (or click it) |
| `Tab` | Expand / collapse the minimap |
| `Esc` | Pause (or leave the dock menu) |
| `M` | Mute / unmute |

## What is new in v0.3

1. **Minimap** (every player, from the start). Lower-right, north-up: your boat and heading, the station, the major
   islands and the three zone boundaries (Harbor, Shallows, Open Water). It does not reveal debris. `Tab` enlarges it.
2. **Station arrow that does not vanish.** A gold arrow with the distance to the **dock entrance** stays on the edge
   of the screen whenever the dock is *outside the camera view*, at any distance, and fades out when the dock is clearly
   visible (with hysteresis, so it does not flicker at the edge). It is hidden only once you are in docking range.
3. **Ocean Sonar** (upgrade, 5 levels). Progressively better debris detection - see below.
4. **Free late-game assistance.** From 60% cleaned the game quietly helps you find what is left, with or without sonar.
5. **Auto Trawlers** (upgrade, up to two). Small unmanned vessels that sail out, scoop plastic, bring it home and go
   again. They are visually distinct from tenders and have compact status chips (`A1 Collecting 4/10`).
6. **Completion-time scoring.** At the first moment 75% is reached the expedition is *finalised*:
   `Final score = base arcade score x time multiplier`.
7. **Local high-score table** (top 10), name entry, personal bests, and a rebuilt completion screen.
8. **Save format v3** with automatic migration from v1 and v2 saves. High scores live under a separate key.

Cargo Tenders are unchanged - they work exactly as in v0.2.

## How to play

1. Sail into floating plastic. Anything inside the arms in front of your bow is collected automatically.
2. Items must fit entirely: **bottle** 1 cargo / 2 credits, **container** 2 / 4, **fishing net** 4 / 10. There is no
   partial collection. Your hold starts at 20 units.
3. Return to the glowing station ring and press `E` to unload everything and bank the credits.
4. Spend credits at the station (eight rows, each with a short effect line):
   * **Cargo Hold**, **Engine**, **Collection Arms** - five levels each; they visibly change the boat.
   * **Cargo Tender** (5 levels) and **Second Tender** - see v0.2 notes below.
   * **Ocean Sonar** (5 levels) - detection.
   * **Auto Trawler** (5 levels) and **Second Trawler**.
5. Chain pickups quickly for **combo score** (3 = x1.2, 5 = x1.5, 10 = x2.0). Combos multiply the arcade score only,
   never cargo, credits or cleanup progress.
6. Reach 25%, 50% and 75% cleaned for clearer water, returning coral colors and more wildlife.

Collisions with islands, reefs and rocks are solid but harmless: you slide along them.

### Cargo Tender (unchanged from v0.2)

An autonomous barge that carries cargo - it never collects debris itself. Press `R` and the nearest free tender sails
to you, takes whole items from your hold, carries them to the station, unloads and returns. Credits are paid only when
the delivery happens. Tenders create **no** cleanup progress and **no** arcade score (the player already earned both
when collecting).

### Auto Trawlers

Trawlers launch from the station, pick a target, sail around obstacles using the shared navigation grid, scoop items
into their own hold, return when full (or when nothing suitable is left), unload for credits and depart again, with no
commands. Rules that are enforced by tests:

* A trawler never targets an item that is gone or already claimed by another trawler.
* It carries whole items only; a partially filled hold is delivered correctly.
* Debris, credits and cleanup progress are never duplicated (the model is the single place an item leaves the water).
* Trawler pickups give **cleanup progress and credits only** - never arcade score and never combo.
* Stuck detection and relocation, as for tenders; unreachable items are given up on.
* **Courtesy rule:** trawlers do not choose new targets within 420 px of your boat (`trawler.yieldToPlayerRadius`),
  so they do not snatch the plastic you are about to scoop. This also keeps the player the main collector.

| Level | Hold | Speed | Scoop time | Detection | Route | Price |
| ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 1 | 6 | 135 | 0.9 s | 520 px | nearest first | 60 |
| 2 | 10 | 135 | 0.9 s | 520 px | nearest first | 30 |
| 3 | 10 | 170 | 0.55 s | 520 px | nearest first | 40 |
| 4 | 12 | 170 | 0.55 s | 900 px | prefers shorter trips home | 55 |
| 5 | 14 | 195 | 0.4 s | 1100 px | prefers shorter trips home | 70 |

**Second Trawler** (70) requires Auto Trawler level 2 and is fully independent (own hold, position, status).
For comparison the player's boat travels at 250 px/s. Everything is in `BALANCE.upgrades.trawler`.

### Ocean Sonar

Sonar only ever reports debris that is **really still in the water**: it reads the live debris index every frame, so
markers vanish the moment you, a trawler or anything else collects the last item of a patch.

| Level | Name | Capability | Price |
| ---: | --- | --- | ---: |
| 0 | No Sonar | Find debris by eye | |
| 1 | Debris Scanner | 1 edge arrow to the nearest substantial concentration within 1,000 px | 18 |
| 2 | Extended Detection | Up to 3 arrows, range 1,700 px | 30 |
| 3 | Ocean Sonar | Range 2,400 px; concentrations appear on the minimap within 1,900 px | 48 |
| 4 | Advanced Sonar | Whole-bay arrows (4) and minimap concentrations | 72 |
| 5 | Precision Scanner | Isolated remaining items shown on the minimap, exact distances | 104 |

Early levels point at *concentrations* with rounded distances ("~100 m"); higher levels get more precise. The visual
language is subtle: a slow expanding pulse around the boat, a small mast on the cabin (bigger at higher levels),
green-tinted arrows and glowing minimap blobs.

### Free late-game assistance

Independent of sonar purchases (all thresholds in `BALANCE.assist`):

| Cleaned | Help |
| ---: | --- |
| 60% | Subtle, faint arrow to the nearest remaining concentration |
| 65% | Clear arrows toward substantial concentrations (6+ units) |
| 70% | Isolated remaining items are shown on the minimap and pointed to |

Sonar and assistance are merged taking the better of each property, so buying sonar never makes the late game worse,
and Coral Bay never ends with minutes of aimless searching.

### Scoring, completion and the high-score table

* **Cleanup progress** = share of the starting debris (in cargo units) removed by you *or* trawlers.
* **Arcade score** = per-item points x your combo multiplier. Only your own pickups score.
* **Credits** are paid on delivery (by you, a tender or a trawler).

| | Cleanup progress | Arcade score / combo | Credits |
| --- | :---: | :---: | :---: |
| Player collection | yes | yes | on unload |
| Cargo tender | no (already counted) | no | on delivery |
| Auto trawler | yes | **no** | on delivery |

Trawlers therefore help you finish *faster* (a better time multiplier) but any plastic they collect is no longer
available to you for combo score: the best result balances both.

The completion time is the **active play clock**: paused time and the title / completion screens are excluded.
The dock menu does *not* stop the clock, because tenders and trawlers keep working while it is open (stopping it would be
exploitable). The clock is captured **once**, at the first moment 75% is reached; later sailing never changes the
recorded result.

| Completion time | Multiplier |
| --- | ---: |
| Under 4:00 | x1.50 |
| 4:00 - 5:00 | x1.35 |
| 5:00 - 6:00 | x1.20 |
| 6:00 - 8:00 | x1.10 |
| 8:00 or more | x1.00 |

These bands are **provisional and configurable** (`BALANCE.scoring.timeBands`); they are not an established benchmark.
Band edges are exclusive upper bounds (exactly 4:00 is in the 4-5 band). The multiplier is never below 1, times are
rounded to hundredths and the final score to a whole number, in one place (`core/scoring.ts`).

**Completion screen** ("CORAL BAY COMPLETE!"): base arcade score, completion time, time multiplier, final score,
best combo, credits, and whether the score qualifies. It appears once; *Keep Sailing*, *High Scores* and *New Game*
are offered. If the score makes the top 10 you can enter a name (12 characters max, default `CAPTAIN`).

**High scores:** top 10 for Coral Bay, shown with rank, name, final score and time (plus bonus and date). Names are
trimmed, upper-cased and restricted to safe characters; comparisons for **personal bests** use the same normalised
name. Beating your best shows *NEW PERSONAL BEST!* with previous / new / improvement. One expedition can be recorded only
once (its `runId` is remembered), even if you keep sailing, reload, or submit twice. Entries store: name, region
(`coral-bay`), mode (`standard`), final and base score, time, multiplier, best combo, map seed, balance version and
date, and boards are keyed by region + mode, so future challenge modes will not be mixed with standard runs.
Records live under `oceanreclaimers.scores.v1`, separate from the expedition save, so **New Game never erases scores**.

### Upgrade prices

`src/config/balance.ts` keeps the original design table as `baseCosts` and multiplies it by `upgrades.priceScale`
(currently **0.2**, see "Economy"). Resulting prices:

| Level | Cargo Hold | Engine | Collection Arms | Cargo Tender | Sonar | Auto Trawler |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 7 | 8 | 9 | 50 | 18 | 60 |
| 2 | 12 | 14 | 16 | 30 | 30 | 30 |
| 3 | 19 | 22 | 25 | 45 | 48 | 40 |
| 4 | 29 | 34 | 38 | 65 | 72 | 55 |
| 5 | 44 | 52 | 58 | 80 | 104 | 70 |

Second Tender 60, Second Trawler 70. The tender is offered after 3 station visits so you feel the chore first.

## Economy and pacing results (automated bot - not human playtesting)

`tests/pacing.test.ts` plays Coral Bay headlessly with a greedy bot (steering noise, follows the real navigation grid,
buys upgrades, calls tenders). It prints these tables when the suite runs. **The bot knows where every item is, never
gets lost and is roughly twice as fast as the human v0.2 tester (about 6 minutes), so absolute times are optimistic.**
It cannot value sonar (it never searches), so sonar looks like pure cost to it. Use the numbers only to spot obvious
problems.

Five purchasing strategies, one run each (minutes; skill 0.85):

| Strategy | 1st buy | 1st trawler | 1st sonar | Credits earned | Complete | Arcade | Mult | Final |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 Player-focused (boat only) | 0.2 | - | - | 632 | 3.1 | 6,733 | x1.50 | 10,100 |
| 2 Cargo tenders | 0.2 | - | - | 582 | 3.2 | 6,376 | x1.50 | 9,564 |
| 3 Auto trawlers | 0.2 | 0.4 | - | 536 | 2.9 | 5,229 | x1.50 | 7,844 |
| 4 Early sonar | 0.2 | - | 0.2 | 660 | 3.8 | 6,273 | x1.50 | 9,410 |
| 5 Balanced | 0.2 | 0.4 | 0.9 | 626 | 3.3 | 5,667 | x1.50 | 8,501 |

What this tells us (and what it does not):

* Every strategy finishes, the first upgrade comes within about 15 seconds, the first trawler and first sonar are
  affordable in the first quarter of the expedition, and the shop is not exhausted early (purchases are spread from 5%
  to 75%). Spread between slowest and fastest is under 30%, so no single path dominates completion time.
* The bot finishes under 4:00, so every strategy sits in the top x1.50 band and the time multiplier does not separate
  them. **A human at 5-6 minutes will land in lower bands where the multiplier matters.**
* **Open concern:** the boat-only run has the *highest* final score, because trawlers remove about 11-13% of the plastic
  (roughly 45-55 of Coral Bay's 421 cargo units) and shave only about 0.2 minutes, while costing about 20-25% of the
  arcade score. For an omniscient bot that is expected; for a human who must search, trawlers should save much more time. This
  is the first thing to check in human playtesting. If trawlers feel like a score penalty, raise their hold/speed in
  `BALANCE.upgrades.trawler`, reduce `trawler.yieldToPlayerRadius`, or widen the time bands.
* Sonar's benefit is **not measured** by the bot. Whether sonar is worth its price needs human testing.

Also guarded by tests: first upgrade < 4 minutes, tender attainable between 10% and 30% cleanup, boat upgrades alone
do not empty the shop before 15%, something is left to buy after 50%, 75% reachable, tenders reduce station trips,
every strategy reaches 75%, and autonomous pickups never score.

Performance (browser, software-rendered sandbox, so not representative of a real GPU): with 2 tenders, 2 trawlers,
sonar level 5 and the minimap, scene update costs about 0.26 ms per frame and a trawler update about 0.01 ms; target
searches use a spatial grid and never scan the whole map per frame. The game lowers its internal resolution
automatically if a GPU is slow.

## Saving and migration

* Expedition save key `oceanreclaimers.save.v1`, **format version 3**: credits, score, upgrade levels, removed debris,
  milestones, run statistics, boat, every tender and trawler (position, status, cargo), the run id, the play clock and the
  completion record. Auto-saved every few seconds and on unload / purchase / delivery / milestone / pause / tab close.
  A corrupt, tampered or incompatible save is ignored safely.
* **v1 -> v3:** the three one-time upgrades become levels (Cargo Hold 2, Engine 3, Arms 3). No tenders, trawlers or sonar.
* **v2 -> v3:** everything is kept; trawlers and sonar start at 0; the run gets a fresh id. A v2 expedition that had
  already reached 75% has no completion record - its time was never captured - so it is **never offered to the
  leaderboard**, and loading it never re-triggers the completion screen.
* A save made mid-delivery resumes safely (cargo is neither lost nor paid twice) for tenders and trawlers.
* High scores: separate key `oceanreclaimers.scores.v1`; settings (mute): `oceanreclaimers.settings.v1`.
* **New Game** (with confirmation) erases the expedition only; the high-score table is kept.

## Project layout

```
src/
  config/
    balance.ts      <- ALL gameplay numbers (handling, costs, trawlers, sonar, assist, scoring bands, audio...)
    world.ts        <- Coral Bay layout: zones, islands, reefs, rocks, station, dock, debris patches
  core/             <- pure TypeScript, no Phaser, unit-tested
    model.ts        game state: cargo, credits, score, upgrades, tenders, trawlers, progress, completion
    upgrades.ts     upgrade registry (name, levels, costs, effect text, purchase rules) - add new tracks here
    stats.ts        vessel, tender and trawler stats derived from upgrade levels
    cargo.ts, combo.ts, boat.ts, rng.ts, worldgen.ts   hold rules, combo, physics, seeded placement
    debrisField.ts  live spatial index of floating debris + per-patch aggregates (one source of truth)
    tender.ts       TenderFleet; trawler.ts  TrawlerFleet; vesselMotion.ts  shared motion/unstick helpers
    nav.ts, navmap.ts  navigation grid, A*, Coral Bay obstacles
    sensors.ts      sonar levels + free late-game assistance -> arrows and minimap markers
    navigation.ts   visibility-aware screen-edge indicator math (hysteresis, safe-area insets)
    scoring.ts      time multiplier, final score, completion record
    leaderboard.ts  local top-10, names, personal bests, duplicate protection
    events.ts       typed game events and run statistics
    save.ts         versioned, validated localStorage persistence (v1/v2 -> v3)
  render/           <- Phaser / canvas / Web Audio
    textures.ts, worldart.ts, boatView.ts, tenderView.ts, trawlerView.ts, wildlife.ts, audio.ts, input.ts
  scenes/GameScene.ts   ties core + rendering together (game feel, FX, flow)
  ui/ui.ts, ui.css, minimap.ts   compact DOM HUD, dock, chips, edge arrows, minimap, completion + scores panels
tests/
  core.test.ts      cargo limits, credits, upgrades, combo, progress, save/load, deterministic placement
  tender.test.ts    tender transfers, conservation, navigation, recovery, save mid-delivery
  trawler.test.ts   trawler targeting, claims, stuck recovery, conservation, courtesy rule, save mid-trip
  v03.test.ts       scoring bands, completion once, leaderboard, names, personal bests, edge indicator,
                    debris field, sonar / assist accuracy, save v3 round-trip and v1 / v2 migration
  pacing.test.ts    bot playthroughs and the five-strategy comparison
```

### Tuning

Open `src/config/balance.ts`. Configurable: trawler hold / speed / scoop rate / prices, sonar ranges / arrows / prices,
assistance thresholds, time bands and multipliers, leaderboard size and name length, handling, collection zone, debris
values, combo tiers, tender behaviour, milestones, camera and audio levels. The debris layout is data in
`src/config/world.ts`; placement comes from a fixed seed (`WORLD.seed`), so every New Game has identical starting
debris and a save only stores which items were removed. Bump `scoring.balanceVersion` when a change makes old scores
incomparable.

## Verification status

* `pnpm test`: 128 tests pass. `pnpm build`: succeeds.
* Checked by hand in a browser (screenshots): HUD, minimap, edge arrows, sonar mast and pulse, trawlers and chips, the
  eight-row dock menu, completion screen, name entry, high-score table, personal-best text, and loading a migrated
  save.
* **Not done:** no human playtest of v0.3. Balance, the usefulness of sonar and the trawler-versus-score trade-off are
  unverified by people. Not tested on touch devices, gamepads or real GPUs.

## Known limitations (v0.3)

* Keyboard only. No touch or gamepad controls.
* Art is procedural and intentionally simple; wildlife is not skeletally animated.
* Desktop browsers only; on slow GPUs the internal resolution drops automatically.
* Debris is fixed per seed and does not respawn. After 75% you can keep sailing to clean the rest, but the scored
  result is already locked.
* Boat collision uses circles, so shorelines are slightly forgiving. Tenders and trawlers use a coarse 40 px grid and
  may take wide turns near tight reef gaps; if blocked for too long they are relocated to safe water with cargo intact.
* The time bands are provisional; the bot is faster than people (see above), so real completion times will land lower
  in the table. The price scale (0.2) and trawler/sonar prices are bot-informed guesses.
* Trawler value for score chasing is questionable (see "Open concern").
* The dock menu does not pause the world or the clock.
* A score is stored only on this device; clearing site data erases it. Names are not verified, scores are not
  tamper-proof, and there is no online leaderboard (by design).
* Audio starts after the first key press or click (browser autoplay rules).
* Single region: no weather, currents, multiplayer or carbon accounting.

## Recommendations for the next version

* Human-playtest v0.3: record completion times, then retune the time bands and trawler strength (one table each).
* Decide whether trawlers should avoid combo-friendly patches entirely, or earn a small bonus (e.g. a share of the
  score) so fleet play is a real alternative strategy.
* Challenge modes (no-fleet, speed-run, fixed-upgrade) on their own leaderboards - the board key already supports this.
* A second region reusing `debrisField`, `sensors` and the navigation grid (region-specific distributions).
* Offer three random upgrade choices at the 25 / 50 / 75% milestones; achievements and cosmetics from `core/events.ts`.
* Touch and gamepad controls, reduced-motion and color-blind-safe options, hand-painted sprites.

## Credits and licences

* Code, procedurally generated art and synthesized audio: original to this project.
* Font: *ManusCC0* (bundled in `public/fonts`, see `ManusCC0-LICENSE.txt`), CC0.
* Phaser 3 (MIT).
