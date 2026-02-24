# CLAUDE.md — Loiter Lawyer (BigLaw Associate Simulator)

This file documents the codebase structure, conventions, and workflows for AI assistants working on this project.

## Project Overview

**Loiter Lawyer** is a Tamagotchi-style desktop simulation game where the player manages the work-life balance of a BigLaw associate at the fictional firm "Lyle Cheatem & Steele" in Detroit. It features real-time stat decay, career progression, NPC arcs, minigames, and prestige loops. The humor is dark and the mechanics are inspired by BigLaw culture.

- **Runtime**: Electron (desktop) or static browser page (Cloudflare Pages)
- **Language**: Vanilla JavaScript — no framework, no TypeScript, no bundler
- **License**: Public domain (Unlicense)

---

## File Structure

```
loiter-lawyer-tamagotchi/
├── main.js          # Electron main process — creates BrowserWindow, loads index.html
├── index.html       # Full UI layout: three-panel layout + all overlay markup
├── renderer.js      # All game logic (~5,100 lines) — state, tick, render, events
├── store-api.js     # Shop system: built-in catalog + optional remote API client
├── style.css        # Dark theme styling (~235 lines)
├── package.json     # Electron + electron-builder dependencies and build config
├── wrangler.toml    # Cloudflare Pages deployment config (serves . as static site)
└── README.md        # Basic setup instructions
```

There are **no subdirectories** for source files. All application code lives at the root.

---

## Running the Project

```bash
npm install          # Install Electron dev dependencies
npm start            # Launch Electron app (opens index.html in a desktop window)
npm run dist         # Package for distribution (Windows NSIS, macOS DMG, Linux AppImage)
```

The app also runs as a plain static site — open `index.html` directly in a browser or deploy via Cloudflare Pages (`wrangler.toml` configures this with `pages_build_output_dir = "."`).

There are **no tests** and **no linter configuration**.

---

## Architecture

### Load Order

```
Electron: main.js → loads index.html
index.html: <script src="store-api.js"> → <script src="renderer.js">
renderer.js: init() → load() → renderAll() → gameLoop()
```

`store-api.js` must load before `renderer.js` because renderer references `window.storeApi`.

### Game Loop

The main loop runs via `requestAnimationFrame` and calls `tick()` every real-world second (throttled by timestamp comparison). The loop drives:

1. **Stat decay** — hunger, caffeine, sleep, stress degrade at per-minute rates
2. **Task progress** — active queue items advance toward completion
3. **Event checks** — holiday triggers, NPC spawns, junior associate spawns, offer refreshes
4. **Render** — DOM updates via `renderAll()` and canvas redraws

### State

All game state lives in a single `state` object. On startup, state is loaded from `localStorage` (key: `"biglaw-sim-save"`) or initialized with `defaultState()`. State is saved to localStorage on every significant action.

Key state shape (abbreviated):
```js
state = {
  lawyer:        { name, gender, hair, eyes, outfit },
  stats:         { hunger, caffeine, sleep, stress },   // 0–100
  office:        { plantAlive, windowClean, ... },
  store:         { fridge, coffeeMaker, desk, ... },    // one-time purchases
  perks:         { nightOwl, masterBiller, goldenVoice },
  perkProgress:  { nightOwlTasks, litTasksCompleted },
  money,
  billables,                                            // lifetime billable hours
  reputation:    { lit, corp, reg },
  offers: [],                                           // pending assignment offers
  queue: [],                                            // active tasks
  juniors: [],                                          // midlevel arc: junior associates
  rival:         { name, score, playerScore, momentum, resolved, ... },
  breakaway:     { count, multiplier, lifetimeEarnings },
  specialization,                                       // null | "lit" | "corp" | "reg"
  relationship,                                         // 0–100 family health
  divorced,
  burnout,
  npcs: [],
  npcArcs:       { deliveryGuy, janitor, secretary },
  bitcoin:       { holdings, totalInvested, lastPrice, ... },
  achievements: [],
  minigameBoost: { litBoostUntil, corpBoostUntil, regBoostUntil, gamesPlayed, gamesWon },
  pipStrikes,
  log: [],
  apiConfig,
}
```

---

## Key Systems

### Rank Progression

Five ranks gated by `billables` and total `reputation` (lit + corp + reg):

| Rank | Billables Required | Rep Required |
|---|---|---|
| Junior Associate | 0 | 0 |
| Midlevel Associate | 600 | 80 |
| Senior Associate | 1400 | 200 |
| Counsel (Partner Track) | 2400 | 380 |
| Partner | 3600 | 600 |

Reaching Midlevel unlocks the Junior arc; reaching Senior unlocks the Rival arc; reaching Partner unlocks Breakaway.

### Stats

Four core stats (all 0–100). Each decays in real-time at a per-minute rate modified by store upgrades and perks:

- **Hunger** — decays unless Mini-Fridge purchased
- **Caffeine** — decays unless Better Coffee Maker purchased
- **Sleep** — decays faster during work, reduced by Night Owl perk
- **Stress** — rises during work, reduced by standing desk, casual Fridays, golf clubs, corner office art

Low sleep and hunger penalize productivity. High stress triggers events and can cause burnout.

### Assignments

Offers are periodically generated (every ~8 real hours) and presented to the player. Accepting an offer adds a task to the queue. Tasks have:
- A specialization (`lit`, `corp`, `reg`)
- A progress bar driven by `tick()`
- A deadline (real-world time)
- A billable value and reputation reward

### Perks

Three perks unlock by meeting real-play thresholds:

| Perk | Requirement | Effect |
|---|---|---|
| Night Owl | 5 assignments completed while sleep < 30 | -45% sleep penalty on productivity |
| Master Biller | 500 lifetime billable hours | +12% billable hours on tasks |
| Golden Voice | 8 litigation assignments completed | +25% rep on lit tasks |

### Store

`store-api.js` exposes `window.storeApi`. Items fall into three categories:

- **Cosmetics** — visual changes, minor passive bonuses
- **Upgrades** — permanent stat modifiers (one-time purchase, persisted in `state.store.*` or `state.lawyer.outfit.*`)
- **Consumables** — immediate effect, repurchasable (e.g., energy drink, therapist session)

An optional remote API can be configured in-app (base URL + Bearer key). Falls back to the 17 built-in items if unconfigured or unreachable. API catalog is cached for 5 minutes.

### NPC Arcs

Three recurring NPCs evolve through narrative stages every two real weeks:
- **Delivery Guy** (`state.npcArcs.deliveryGuy`): stages 0–5, goes from DoorDash bags to food truck entrepreneur
- **Janitor** (`state.npcArcs.janitor`): stages 0–5, retires and is replaced by Tony
- **Secretary** (`state.npcArcs.secretary`): stages 0–5, culminating in a Christmas party incident

### Career Arcs

- **Midlevel Arc**: Manage junior associates. Each junior has their own task, deadline, and personality. Delegate tasks; juniors earn you billables passively.
- **Senior Arc**: Tug-of-war with a named rival. Accumulate score via work actions. If player score drops significantly, a Client Pitch-Off CYOA resolves the rivalry.
- **Partner Arc (Breakaway/Prestige)**: Soft-reset with a permanent multiplier. Each breakaway increases `state.breakaway.multiplier` and preserves achievements.

### Minigames

Three practice-area minigames trigger during assignment completion and award productivity boosts:
- **Litigation** — objection timing game
- **Corporate** — negotiation/decision game
- **Regulatory** — compliance puzzle

Boosts persist as timestamps in `state.minigameBoost.*Until`.

### Bitcoin

Optional side system. Fetches live BTC price from CoinGecko. Player can buy/sell. Holdings and price are persisted in `state.bitcoin`. High volatility raises stress.

### Achievements

25+ achievements tracked in `state.achievements[]` as `{ id, unlockedAt }`. Definitions are in `ACHIEVEMENT_DEFS` array in `renderer.js`. Achievements survive breakaways.

### Holidays

Real-calendar holidays trigger one-time events per year (tracked in `state.holidaysTriggered[]`):
- Easter (Anonymous Gregorian algorithm in `easterSunday()`)
- Labor Day (first Monday of September, `laborDay()`)
- Thanksgiving (fourth Thursday of November, `thanksgivingDay()`)
- Cinco de Mayo (May 5)
- Christmas Party (Thursday before December 25)

### Event Log

Up to 120 entries in `state.log[]`. `log(msg)` prepends a timestamped entry and calls `renderLog()`.

---

## Conventions

### DOM Access

Uses a single alias:
```js
const $ = (id) => document.getElementById(id);
```

All element IDs are defined in `index.html`. Never use querySelector except for class-based selections.

### Utility Functions

```js
clamp(v, a, b)            // clamp v to [a, b]
now()                     // Date.now()
isFriday(ts)              // true if ts is a Friday
pn(male, female)          // pronoun helper based on state.lawyer.gender
lawyerName()              // returns state.lawyer.name or "Associate"
isFemale()                // true if state.lawyer.gender === "female"
```

### Canvas

`canvas` (`#scene`) uses `ctx.getContext("2d")` and renders a pixel-art character. The `image-rendering: pixelated` CSS property is set for retro aesthetics.

### State Persistence

- Load: `JSON.parse(localStorage.getItem(SAVE_KEY))`
- Save: `localStorage.setItem(SAVE_KEY, JSON.stringify(state))`
- Save key: `"biglaw-sim-save"`

Always call `save()` after any state-modifying action.

### Adding New State Fields

When adding a new field to the game state, add it to **both** `defaultState()` (for new games) and to any migration/upgrade logic after `load()` returns (to patch existing saves). Pattern used throughout:

```js
if (!state.newField) state.newField = defaultValue;
```

### Adding Store Items

Add item objects to `BUILTIN_ITEMS` in `store-api.js`. One-time upgrades set a boolean flag via the `effect.target` dot-path; consumables use `effect.type === "consumable"` with an `effect.action` string handled in `renderer.js`'s purchase handler.

### Adding Achievements

1. Add a definition to `ACHIEVEMENT_DEFS` in `renderer.js`
2. The `checkAchievements()` function runs every tick and evaluates all `check()` functions automatically

### Adding Perks

1. Add a definition to `PERK_DEFS` with `id`, `name`, `desc`, `requirement`, `threshold`, and `progressFn`
2. Add initial tracking state to `defaultState()` under `perkProgress`
3. The perk check loop in `tick()` handles unlock automatically

---

## Deployment

### Electron (Desktop)

```bash
npm run dist
```

Outputs to `dist/`:
- Windows: NSIS installer
- macOS: DMG
- Linux: AppImage

Packaged files (from `package.json` build config): `main.js`, `renderer.js`, `store-api.js`, `index.html`, `style.css`.

### Cloudflare Pages (Web)

Configured via `wrangler.toml`. The root directory is served directly as a static site. Deploy by pushing to the connected branch or via `wrangler pages deploy`.

---

## What Does Not Exist

- No test suite or test runner
- No linter or formatter configuration
- No build step / bundler (plain JS files, no imports/exports between game files)
- No TypeScript
- No CSS preprocessor
- No CI/CD pipeline
- No backend (store API is optional external service)
- No subdirectories for source files

---

## Common Pitfalls

- **Script load order matters**: `store-api.js` must precede `renderer.js` in `index.html` because renderer reads `window.storeApi` at the top level.
- **State saves are manual**: Always call `save()` after modifying `state`. Forgetting this causes state rollback on reload.
- **Real-time decay uses wall-clock time**: `tick()` calculates elapsed milliseconds since `state.lastTick` and scales all decay/progress accordingly. Do not assume a fixed tick interval.
- **Existing saves must be forward-compatible**: If you add new state fields, patch them in after `load()` returns. Never change the shape of existing fields without migration.
- **Holiday events are per-calendar-year**: They use `state.holidaysTriggered` to deduplicate. Keys follow the pattern `"holiday_YYYY"`.
- **Bitcoin price is fetched from an external API (CoinGecko)**: This can fail or be rate-limited. The last known price is persisted in `state.bitcoin.lastPrice` as a fallback.
