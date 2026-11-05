# Ocean Reclaimers development instructions

These instructions apply throughout this repository. Ocean Reclaimers v0.3 is a browser-based ocean-cleanup arcade game built with Phaser 3, TypeScript, and Vite.

## Permanent rules

- Preserve existing gameplay features unless the user explicitly directs otherwise.
- Maintain compatibility with existing saved games whenever possible. Inspect persistence, validation, migration, and restore behavior before changing persisted state.
- Make small, focused, reviewable changes. Avoid unrelated refactoring and formatting churn.
- Keep the player actively involved while autonomous systems reduce repetitive work. Preserve meaningful steering, collecting, exploration, and arcade decisions.
- Favor enjoyable, understandable arcade gameplay over complicated management interfaces.
- Preserve the existing visual style and performance, including procedural art, synthesized audio, spatial indexing, and adaptive resolution.
- After changes, run relevant automated tests, TypeScript checks, and the production build. Report the commands actually executed and their outcomes, including failures or checks not run. Never claim a test passed unless it was executed.
- Do not introduce paid services or unnecessary cloud dependencies.
- Avoid unnecessary changes to Manus-specific scripts until their purpose and dependencies are understood. Treat asset restoration, sharing metadata, and preview/tuning integration as existing infrastructure.
- Do not push to GitHub, delete files, or make major architectural changes without the user's approval. Task authorization does not imply permission for those actions.

## Repository map and architecture

- `src/main.ts`: Phaser startup, DOM UI wiring, resize handling, and adaptive render resolution.
- `src/config/balance.ts`: gameplay tuning, upgrade costs and stats, scoring, sensors, and persistence keys. `src/config/world.ts`: seeded Coral Bay layout and debris patches.
- `src/core/`: pure TypeScript gameplay logic. `GameModel` owns cargo, credits, upgrades, debris removal, progress, scoring, completion, and fleets. Keep this layer independent of Phaser and DOM rendering.
- `src/core/tender.ts` and `trawler.ts`: autonomous fleet state machines; navigation and vessel motion live in adjacent core modules. `debrisField.ts` supplies shared spatial queries for collection and sensors.
- `src/scenes/GameScene.ts`: orchestration of input, simulation, camera, rendering, UI, persistence, and title/playing/docked/paused/win modes.
- `src/render/`: procedural textures, world/vessel views, wildlife, input, and audio. `src/ui/`: DOM overlays, CSS, and canvas minimap.
- `tests/`: five Vitest suites for core gameplay, tenders, trawlers, v0.3 features, and headless pacing simulations. Vitest runs in Node, configured in `vite.config.ts`.
- `scripts/manus-game-assets/`, `scripts/manus-game-sharing/`, `scripts/manus-tuning/`, and `scripts/__manus__/`: asset, sharing, and preview tooling. Supporting metadata includes `assets.lock.json`, `game-sharing.json`, and `.manus-webdev/`.
- `public/` and `assets/`: static resources; `dist/` is generated production output.

## Gameplay invariants

- Collect whole items only; never duplicate debris removal, cargo, credits, or progress.
- Player pickups earn cleanup progress and arcade/combo score; credits arrive on delivery.
- Tenders transport existing cargo, without new cleanup progress or arcade score. Trawlers collect for cleanup progress and delivery credits, without arcade/combo score; preserve their courtesy behavior around the player.
- Completion is captured once at 75% cleanup. Preserve the active-play clock rules: docking counts, while paused/title/completion screens do not.
- Preserve sonar, free late-game assistance, navigation, milestones, upgrades, minimap, local scores, and continued sailing unless explicitly asked to change them.

## Saved-game compatibility

- `src/core/save.ts` writes format version 3 and accepts versions 1, 2, and 3. The expedition key remains `oceanreclaimers.save.v1` despite the format version.
- Scores use `oceanreclaimers.scores.v1`; mute settings use `oceanreclaimers.settings.v1`. New Game clears the expedition and preserves scores.
- Preserve v1 boolean-upgrade migration and v2 fleet migration. Legacy completed runs lack a captured completion time and must not become new leaderboard submissions.
- Preserve mid-delivery cargo and credit accounting, run IDs, and duplicate score submission protection.
- Saves are tied to `WORLD.seed` and generated debris IDs. World generation, seed, item identity, capacity, and upgrade changes can affect compatibility even without a schema change; assess migrations and regression coverage before changing them.
- Validate untrusted storage data and handle storage failures. For persistence changes, extend relevant migration, round-trip, corruption, and delivery tests.

## Commands from package.json

Use the declared package manager, `pnpm@10.18.0`, with the existing `pnpm-lock.yaml`. Do not change dependencies or regenerate lockfiles incidentally.

| Command | Actual behavior |
| --- | --- |
| `pnpm dev` | Runs `node scripts/manus-game-assets/restore.mjs && vite`. Defaults to `http://127.0.0.1:3000`; `HOST` and `PORT` override server settings. |
| `pnpm test` | Runs `vitest run` for the full automated suite. |
| `pnpm test -- tests/core.test.ts` | Runs a focused suite; substitute the relevant test file. |
| `pnpm typecheck` | Runs `tsc --noEmit`, including source, tests, and Vite configuration. |
| `pnpm build` | Restores referenced assets, invokes the Manus sharing build wrapper, which runs `manus:build-source`, then assembles sharing metadata in `dist/`. This is a local build, not a deployment. |
| `pnpm manus:build-source` | Runs `tsc --noEmit && vite build` directly; does not replace validation of the full build wrapper. |
| `pnpm preview` | Serves built output with `vite preview --port 4173 --strictPort`. |

For implementation changes, run focused tests as appropriate and finish with `pnpm test`, `pnpm typecheck`, and `pnpm build`. For UI/input/rendering changes, also perform relevant browser checks and describe what was actually observed. Tests and build success do not establish visual correctness or enjoyable gameplay.

## Known coverage gaps and development risks

- `.github/workflows/ci.yml` checks pushes to `main` and pull requests targeting `main` on Node.js 24, using the pnpm version declared in `package.json`. It installs with `pnpm install --frozen-lockfile`, then runs `pnpm test` (non-watch `vitest run`), `pnpm typecheck`, and `pnpm build`. Keep the existing `assets/share/favicon.png` in Git so clean CI builds do not require Manus storage credentials. CI checks do not deploy the game.

- Existing tests exercise core logic and simulated pacing, not browser-level Phaser/DOM integration, keyboard focus, resize behavior, audio, minimap rendering, or visual regressions.
- Scene-driven pause/visibility/autosave timing and real browser reload flows need integration coverage; in-memory storage tests do not verify the complete browser lifecycle.
- Pacing bots know debris locations and cannot measure sonar's search benefit or human enjoyment. Human playtesting is needed to assess trawler score tradeoffs and completion-time bands.
- Save compatibility depends on deterministic world generation and stable debris IDs. Local storage is device/browser/origin-specific; changing host or port can make existing saves appear absent.
- `GameScene.ts` combines many integration responsibilities; keep changes narrow and check affected modes without undertaking an unapproved architectural rewrite.
- Asset restoration can require external storage if referenced assets are missing. Sharing assembly can warn and continue, so inspect build output as well as its exit code. Understand these dependencies before modifying or removing infrastructure.
- No coverage threshold or browser test runner is configured in the inspected package scripts/Vite configuration. Do not equate the number of passing tests with complete coverage.

## Inspection baseline

On November 5, 2026, `pnpm test` executed successfully (5 files, 128 tests), `pnpm typecheck` exited successfully, and `pnpm build` completed successfully. This is a historical baseline, not a claim about later changes. The inspection introduced only this instruction file; generated build output is ignored by Git.
