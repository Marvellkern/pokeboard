# PokéBoard

A private, non-commercial fan-made property board game for 2–4 players (humans and/or bots), on one device or online with friends. Properties are Pokémon, every fee is settled by a short battle, and levels replace houses.

No analytics, no ads, no sign-up. Online play is optional and uses Firebase anonymous sign-in and a Realtime Database (see [Online play](#online-play)). The page has `noindex, nofollow`.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine + room/sync unit tests (Vitest)
npm run sim        # 1000 bot-only games → balance stats
npm run build      # type-check + static build into dist/
```

### Deploy to Vercel

The app is a static Vite build. Either:

- Import the repo in the Vercel dashboard. The **Vite** preset picks `npm run build` and the `dist` output folder automatically. Or:
- Run `npx vercel` from the project folder and accept the defaults.

For online play, also add the `VITE_FIREBASE_*` variables (see [Owner setup](#owner-setup-one-time)) under **Project → Settings → Environment Variables**, then redeploy. Without them the site still works for local play.

## Project layout

```
src/
  data/theme.ts      ALL names, sprite URLs, types, move names, tile names, card text, currency
  data/config.ts     ALL tunable gameplay numbers (+ UI timings, sim defaults)
  engine/            pure rules engine: no React, DOM, Math.random, Date or storage
    reducer.ts       createGame(setup, seed), reduce(state, action) → state
    board.ts         generateBoard(rng, 'shuffled' | 'classic'), save migration (withBoard)
    battle.ts        battle math (damage, Protect, turn cap)
    selectors.ts     fees, values, legal actions, who acts next
    rng.ts           seeded RNG (its state lives in GameState.rng)
    bot.ts           chooseAction(state) → Action
    __tests__/       Vitest suite
  sim/run.ts         headless simulator
  net/               ALL networking (Firebase): config, backend interface, rooms, sync
    __tests__/       room and sync tests against an in-memory backend
  ui/                React UI: Board (tiles + token lane), Stage (center of the board),
                     BattleOverlay, SetupScreen, cards, modals
    session.ts       what GameScreen needs, from local or online play
    online/          home screen, lobby, online game wrapper, online store
  store.ts           Zustand store + localStorage save after every action (local play)
```

Humans and bots are both just sources of `Action`s. The UI asks the engine for `legalActions(state)` and never decides legality itself. The same seed plus the same actions always gives the same game.

## Online play

Players on different devices share a room. The engine is unchanged: every action carries the seat that sends it (`by`), and the engine rejects actions from anyone but the player who is due to act. All networking is in `src/net/`. Firebase is loaded only when someone creates or joins a room, so local play never downloads it.

**How sync works.** A room stores the game as `{ version, stateJson }`. A device that acts reads the current state in a database transaction, checks the action is legal, runs the reducer and writes `version + 1`. If two devices act at once, only one transaction wins and the other is re-checked against the new state (and dropped if no longer legal). Devices ignore stale or repeated versions, and if a state fails to parse they keep the last good one and show "Sync problem, retrying". Incoming states are played in order so everyone sees the same animations. If more than 3 pile up, the screen jumps to the latest.

**Rooms.** Codes are 4 letters (no I or O) and rooms expire 24 hours after creation. `?room=ABCD` links join directly, and refreshing inside a room rejoins the same seat. In the lobby each player picks a name (max 12 characters), a starter and a color (no duplicates; claims go through a transaction) and marks Ready. The host picks rounds and board, adds or removes bots, opens seats, removes players, and starts once there are 2+ seats and every human is ready. If the host leaves the lobby, the next human becomes host. An empty room is abandoned.

**Bots and dropped players.** The host's device plays the bots. If the host is offline, the online human in the lowest seat does. A player who loses connection gets an "Offline" tag. After 20 seconds on their turn, the host can tap "Let a bot play for X"; after 60 seconds a bot takes over automatically. When the player comes back, they get their seat back on their own. "Leave game" turns the seat into a bot for the rest of the game. While a device is disconnected, a "Reconnecting…" overlay blocks input. At game over, the host's "Play again" takes everyone back to the lobby, un-readied, with the same seats.

### Owner setup (one time)

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com). You can turn Google Analytics **off**; the game doesn't use it.
2. **Build → Authentication → Get started → Sign-in method:** enable **Anonymous**.
3. **Build → Realtime Database → Create database.** Pick a location and start in **locked mode**.
4. In the database's **Rules** tab, paste the contents of [`database.rules.json`](database.rules.json) and **Publish**. Signed-in players can read and write a room only by its code; nobody can list all rooms.
5. **Project settings → Your apps → Add app → Web** (no hosting needed). Copy the config values.
6. Copy `.env.example` to `.env.local` and fill in `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_DATABASE_URL` and `VITE_FIREBASE_APP_ID` (the API key, project ID and database URL are required). `.env.local` is git-ignored. (The web API key isn't a secret; the database rules are what protect the data.)
7. Add the same five variables in Vercel and redeploy.
8. Optional: in **Authentication → Settings → Authorized domains**, add your Vercel domain.

If the variables are missing, Create room / Join room show "Online play isn't set up yet." and local play works as before.

### Develop against the emulator

No Firebase project needed. The emulator needs Java 21+ (for example the Microsoft OpenJDK build).

```bash
npm run emulators   # auth on :9099, database on :9000, using database.rules.json
npm run dev
```

`.env.local` for the emulator:

```
VITE_FIREBASE_API_KEY=any-non-empty-value
VITE_FIREBASE_PROJECT_ID=demo-pokeboard
VITE_FIREBASE_DATABASE_URL=http://127.0.0.1:9000/?ns=demo-pokeboard-default-rtdb
VITE_FIREBASE_EMULATOR=true
VITE_FIREBASE_TAB_IDENTITY=true
```

The database namespace must be `demo-pokeboard-default-rtdb`; the emulator applies the rules only to that one. `VITE_FIREBASE_TAB_IDENTITY` gives each browser tab its own anonymous player, so you can test several players in one browser. Leave it off in production, where one browser is one player.

### Manual test script

Run before each release, with two browsers or devices (or two tabs with `VITE_FIREBASE_TAB_IDENTITY`). All 7 steps were run against the emulator for this release and passed.

1. **Create and join.** A creates a room, B joins with the code (or the copied link). Both pick starters and colors; a taken one is greyed out for the other. The host adds 2 bots, both ready up, the host starts. *Passed: 2 humans + 2 bots.*
2. **Play.** Play 3+ full rounds. Only the player whose turn it is gets buttons; the other sees "Waiting for …". Get a human-vs-human battle: each side picks their own moves. *Passed, including a battle where both humans picked moves.*
3. **Refresh.** B refreshes mid-turn and comes back in the same seat and state. *Passed.*
4. **Drop a player.** Close B's tab on B's turn. A sees "Offline" within a few seconds, the host gets "Let a bot play for B" after 20 s, and a bot takes over at 60 s. Reopen B: control returns. *Passed: Offline at ~1 s, button at 21 s, takeover at ~60 s, control back within 1 s.*
5. **Drop the host.** Close A's tab. The bots keep playing, run by B's device. Reopen A: A is back as host. *Passed.*
6. **Play again.** Finish a game. The host taps Play again: everyone is back in the lobby, un-readied, same seats. Ready up and start a second game. *Passed.*
7. **No config.** Build without the `VITE_FIREBASE_*` variables. Local play works, Create/Join show "Online play isn't set up yet.", a `?room=` link shows the same message, and Firebase isn't downloaded. *Passed.*

Check the browser console for errors in every step. *None in this run.*

### Known limits

- **One player, one browser.** Your seat belongs to the anonymous sign-in in that browser. Opening the room on a new device (or after clearing site data, or in a private window) joins as a new player, not your old seat. A dropped player who can't come back is covered by the bot takeover.
- **Expired rooms aren't deleted.** Rooms stop working after 24 hours but stay in the database. They are tiny. To clear them, delete `rooms` (or old codes) in the Firebase console now and then, or add a scheduled Cloud Function if it ever matters.
- **Clients are trusted.** Every device runs the same engine and checks legality inside the transaction, but there is no server-side rule engine. A player who edits the code could write a bad state. Fine for friends; not built for strangers.
- **Hidden information isn't hidden.** The whole game state (including the card deck order and RNG) is visible to every device in the room.
- `npm audit` reports advisories in `firebase-tools` (dev-only, used for the emulator). They aren't shipped to the site.

## Change numbers: `src/data/config.ts`

Every gameplay number lives in `config.ts` with a comment: starting money, GO payout, fee-by-level table, legendary fee table, battle-loss surcharge, level cost ratio, caps, HP and damage formulas, type multipliers, Protect, move cap, grunt scaling, ambush and hideout fees, liquidation ratio, cards, and bot thresholds.

You can try changes in the simulator without editing anything. `SIM_OVERRIDES` takes JSON that is deep-merged into the config:

```bash
SIM_OVERRIDES='{"goPayout":125,"feeByLevel":{"5":2.8}}' npm run sim
npm run sim -- 1000 4 20 classic   # the balance targets are measured at round limit 20
npm run sim -- 500 3 20      # games, players, round limit
npm run sim -- 1000 4 30 classic   # board mode: shuffled (default) or classic
```

(In PowerShell: `$env:SIM_OVERRIDES='{"goPayout":125}'; npm run sim`.)

## Reskin: `src/data/theme.ts`

Creature names and dex IDs, evolution lines, tile names, types (names, colors, type-move names, type chart), starters, grunts, card text, the currency symbol, the game title, and themed UI words ("Pokémon", "Rocket Hideout", "Escape Rope", …) all live in this file. Swap it to reskin the game. Images come from `renderImage()` (3D-style renders; there are no back views, so battle mirrors the attacker). Type colors, player colors and special-tile colors are in this file too. If an image fails to load, it falls back to a type-colored circle with the name.

## Shuffled boards

Every new game (unless **Board: Classic** is picked on the setup screen) builds a fresh board from the seed:

- **Fixed:** the 28-tile skeleton (corners, cards, Pokémon Center, Rocket Ambush), which tiles are creature and legendary slots, and the price ladder. Prices belong to the slot (by tile index in `config.ts`), not to the creature.
- **Shuffled:** which **8 of the 11 board types** get a pair and on which slot (A ₽100 … H ₽400), which 2 lines represent each type (from `POKEMON_POOLS`), and which 4 legendaries appear (always 4 different types, from `LEGENDARY_POOL`; a legendary can appear without a pair of its type). The type list lives only in `BOARD_TYPES` in `theme.ts`. Classic mode keeps the original 8 types.
- **Types:** Fire, Water, Grass, Electric, Ground, Fighting, Dark, Psychic, Ghost, Fairy, Poison (plus Normal for starters and grunts). Ghost beats Psychic and loses to Dark. Fairy beats Fighting and Dark and loses to Poison. Poison beats Grass and Fairy and loses to Ground and Psychic. A test enforces that no two types beat each other both ways.

The board is stored in `GameState.board` and saved with the game. Every rule and UI reader goes through it. The "own both of a pair" rule means both tiles of the same pair slot. Saves from before this feature have no board and load with the classic one. `classic` mode is today's fixed board, tile for tile. It uses no randomness, so classic games (and the classic sim) are identical to before.

To add or remove creatures, edit the pools in `theme.ts`. Each pool on the board needs at least 2 full 3-stage lines, and the legendary pool needs at least 4 types.

## Balls

Every catch is a ball throw. Before rolling (or before the hideout choice), the **Shop** sells Poké (₽50), Great (₽100) and Ultra (₽200) Balls. You can carry 3 in total, and every player starts with 2 Poké Balls. On a wild Pokémon you choose **one** throw: a carried ball (used up either way), or a **Master Ball** bought on the spot for the tile's price, which always catches. A miss ends that landing. Catch chance = `min(95%, cost × 1.4 / tile price)`, halved for legendaries. All of these numbers are in `config.ts` under `balls`, and names and colors are in `theme.ts` (`BALLS`). Net worth and liquidation still use the tile price. Two cards give a Great or Ultra Ball (or ₽50 / ₽100 with a full bag). The reducer rolls each throw and records `lastThrow` (caught, shakes 0-3), and the UI only plays it back. Saves from before balls load with empty bags.

**Sim (1,000 games, 4 bots, round limit 20, classic / shuffled):**

| Metric | Baseline (direct buy) | Balls, power 1.2× (brief start) | **Balls, power 1.4× (final)** | Target |
|---|---|---|---|---|
| Owned tiles per player at R10 | 3.25 / 3.24 | 3.23 / 3.22 | **3.15 / 3.18** | ≥ 85% of baseline (2.76): met |
| Creature tiles unowned at end | 23.1 / 24.1% | 20.2 / 21.3% | **20.2 / 20.5%** | ≤ 15%: missed |
| Catches with a non-Master ball | n/a | 20.5 / 20.8% | **34.5 / 34.7%** | 30-70%: met |
| ≥ 1 bankruptcy | 14.5 / 14.3% | 10.8 / 12.5% | **12.0 / 13.7%** | not worse than baseline: slightly worse in classic |
| Attacker win rate | 67.0 / 63.3% | 67.2 / 63.7% | **66.4 / 63.8%** | (unchanged) |
| Throw success: Poké / Great / Ultra | n/a | 32 / 50 / 78% | **41 / 57 / 81%** | |
| Spent per catch, % of tile price | 100% | 98% | **93%** | |
| Balls left unused per player | n/a | 1.75 | **1.76** | |

Tuning followed the brief's order. Power 1.3 → 1.5 moved the non-Master share from 22% to 37%. 1.4 is the lowest value that meets 30%+. Raising starting balls to 3 and the carry limit to 4 didn't lower unowned tiles (about 19%). The "≤ 15% unowned" target was already missed at baseline (23%): balls improve it but can't reach it, because bots skip tiles they can't afford.

## Balance: fee and economy update

Measured with `npm run sim -- 1000 4 20 classic` and `... shuffled` (1,000 games, 4 bots, round limit 20). Each step was applied on its own and measured, cumulative from the row above. Values are classic / shuffled.

| Step | ≥1 bankruptcy (≥80%) | Median 1st bankruptcy (R9-14) | Ended early (≥25%) | Fees beat GO per lap (by R8) | Attacker wins (40-55%) | Attacker wins R1-5 (≤60%) | Bankrupt before R5 (≤5%) | Seat P1 / P4 (20-30%) |
|---|---|---|---|---|---|---|---|---|
| Baseline | 0.0 / 0.0% | n/a | 0 / 0% | never | 76.8 / 76.0% | 69.5 / 67.4% | 0 / 0% | 31.3, 21.6 / 28.3, 18.9 |
| A: fee table + legendary doubling | 5.4 / 3.4% | R18 / R18 | 0 / 0% | never | 76.5 / 75.5% | 69.4 / 67.4% | 0 / 0% | 30.5, 21.5 / 28.7, 18.9 |
| B: GO ₽150 | 3.5 / 3.6% | R18 / R18.5 | 0 / 0% | never | 76.4 / 75.8% | 69.7 / 67.3% | 0 / 0% | 30.6, 20.7 / 28.5, 18.8 |
| C: starter cap 2, ₽150/level | 6.8 / 7.9% | R18 / R18 | 0.2 / 0% | never | 62.2 / 60.6% | 37.6 / 33.6% | 0 / 0% | 33.8, 19.4 / 32.0, 18.9 |
| D: surcharge 0.25 + new bot rule | 7.8 / 7.0% | R18 / R17 | 0.1 / 0.2% | never | 92.1 / 91.9% | 92.1 / 90.1% | 0 / 0% | 35.1, 17.5 / 33.7, 18.5 |
| **Final** | **14.5 / 13.7%** | **R17 / R18** | **0.5 / 0.2%** | **R20 / R18** | **67.0 / 65.3%** | **43.3 / 38.9%** | **0 / 0%** | **33.2, 17.6 / 32.1, 16.7** |

**Final config vs before:**

| Value | Before | Final |
|---|---|---|
| `feeByLevel` (was `feeMultiplier` 0.2 × level) | 0.2 / 0.4 / 0.6 / 0.8 / 1.0 | 0.2 / 0.5 / **1.2 / 2.1 / 3.0** (top of the allowed range) |
| `legendary.feeByCount` (was ₽50 each) | 50 / 100 / 150 / 200 | 50 / 100 / 200 / 400 |
| `goPayout` | 200 | **100** (bottom of the allowed range) |
| `starter.maxLevel` / `levelCost` | 3 / 100 | 2 / 150 |
| `battleLossSurcharge` (new) | (none) | **0**: rule built and tested, but switched off (see below) |
| `liquidationRatio` | 0.5 | 0.4 |
| `startingMoney` | 1500 | 1500 (₽1,200 was tried and made things worse, so it was walked back) |
| `bot.winChance` (new, replaces `bot.payIfLevelsBelow`) | (none) | Measured bot-vs-bot win chance by matchup and level gap |

**Met:** attacker wins in rounds 1-5 (≤ 60%) and no bankruptcies before round 5 (guard rail).

**Not met, with every allowed move used:** bankruptcies (14% vs 80%), early finishes (under 1% vs 25%), first bankruptcy (round 17-18 vs 9-14), fees overtaking GO (round 18-20 vs 8), attacker wins overall (65-67% vs 40-55%), seat balance (P1 about 32%, P4 about 17%).

**Why the levers barely move:** the steep fee curve only applies at levels 3-5, which need the full pair. With no trading and 4 players buying wherever they land, pairs rarely complete. By round 15 the average game has about **1 of 8 pairs** completed and **under 1 tile above level 2**, and bots sit near the ₽500 leveling reserve. So almost every fee is still a level 1-2 fee (about ₽110), whatever the level 3-5 multipliers are. Lowering GO or starting money also lowers leveling, which lowers fees, so those levers partly cancel out.

**About the surcharge:** at 0.25 or 0.5 it moved no target. Battles here are close to deterministic: an even neutral fight is about a 2% win for the attacker, and one level up makes it 58%. So the new bot rule simply pays whenever it would lose and battles only sure wins. That pushes "attacker win rate" to 92% without moving any money. Per the brief it is set to 0. The rule, the engine selector and its tests stay, so it can be switched back on.

**Attacker win rate is now a choice metric.** With bots that only battle when it's worth it, the overall rate mostly measures which battles they pick, not whether battles are fair. 40-55% overall isn't reachable without bots that take bad gambles.

Levers outside this brief's allowed moves (owner's call): faster pair completion (trading, or a cheaper way to buy the partner tile), a lower level-up cost ratio or bot leveling reserve, or making the set rule cap level 3 instead of 2.

## Rule decisions not spelled out in the brief

1. **Fighter choice everywhere.** Ambush and hideout-guard battles also let you pick any of your Pokémon (starter included), same as fee battles.
2. **Hideout, 3rd loss.** Losing to the guard for the 3rd time automatically pays ₽50 and frees you to roll that same turn. Losses 1 and 2 end your turn.
3. **Rare Candy auto-targets** your highest-fee Pokémon that can still level (respecting the set rule and max level). If none can, it goes to your starter. If that's maxed too, you get +₽50. There's no picker.
4. **Escape Rope** stays in the deck rotation (the deck is always 12 cards). Ropes stack. Bots use a rope before anything else.
5. **Liquidation** releases tile Pokémon only. Starters can't be released. Release value is 50% of (price + levels × level cost).
6. **Valuing levels.** Net worth and release value count every level at its level cost, even levels gained free from Rare Candy. Starter levels count toward net worth.
7. **When you can level up:** before rolling, while in the hideout, while deciding to buy, and before ending your turn. Not during a fee or ambush decision, a battle, a card, or debt.
8. **Damage rounding:** `round((base × typeMult + random 0–2) × 1.5 if charged by Protect × 0.5 if the target is protecting)`, minimum 1.
9. **Protect** lasts until the user's own next action and only softens one hit. Protect counts toward the 12-move cap.
10. **The fee is locked** when the battle starts.
11. **Money moves when the result is confirmed.** Battle results wait for "Continue", which is an engine phase, so a refresh mid-battle or on the result screen restores exactly. Bot-vs-bot battles resolve instantly and show a 2-second banner (tap to skip).
12. **Birthday:** the other players pay one at a time. Anyone short goes through liquidation and bankruptcy as normal.
13. **Bankruptcy:** remaining cash goes to the creditor (lost if the creditor is the bank). By then the player has no tiles left.
14. **Round-limit winner:** highest net worth, with ties going to the lower seat. Final ranking lists survivors by net worth, then bankrupt players, last-eliminated first.
15. **Moving onto GO:** passing GO with "Bike shortcut" pays ₽200. "Fly" pays ₽200 once.
16. **Bots** use the same battle-or-pay rule for ambushes as for fee battles. They level starters (fee 0) only when no tile Pokémon can level. A buy that completes a type pair ignores the ₽300 reserve.
17. **Grunt Pokémon** is drawn randomly when each grunt battle starts.
18. **Pass-and-play banner** appears when the turn passes to a human and 2+ humans are still playing (also after resuming a saved game).
19. **Small boards:** tile names hide below a 640px board, prices below 520px (sprite + level pips only). Tap any tile for full details.
20. **Determinism:** bots never consume game randomness. Their 15% Protect roll is derived from the RNG state without advancing it.

## UI decisions (redesign)

1. **The stage is the action bar.** Each game state shows a headline, a card, and buttons built from the engine's legal actions. Bot turns show the same view read-only with "… is thinking…".
2. **"Battle!" opens a fighter picker** (a modal listing your creatures with type matchups for both sides). The stage card shows the engine's best-matchup hint ("Your Croconaw (Water) is strong against Fire"). The hint comes from the bot's `bestFighter` and `typeMultiplier` selectors.
3. **No "Give up and pay" button in battle.** The engine has no forfeit action during a battle, and this update doesn't touch the engine. Paying is offered before the battle starts (stage and picker).
4. **Phones (board under 640px wide):** tiles show render, level chip and owner badge only. The stage keeps the round, dice and headline. The stage card moves below the board, and the buttons sit in a bar fixed to the bottom of the screen. Board tiles stay about 41px at 380px wide (smaller than 44px), and tapping one opens its details.
5. **Outlined headline:** the stage headline is 3.5% of the board width. When that drops under 28px (boards under 800px), it switches to plain white text with a hard shadow.
6. **Readable text on the gradient:** white text on the page background sits on a translucent ink backing.
7. **Old saves:** player colors from before the redesign map to the new palette when displayed. The save format is unchanged.
8. **Battle result wording:** "You won!" / "You lost!" when exactly one human is in the battle, otherwise the winner's name. Money lines say "No fee paid" / "Paid ₽X to …" for a lone human attacker, and name the attacker otherwise.
9. **Seat labels** (`P1`, `B2`) appear on owner badges, tokens and player cards, so color is never the only signal.
10. **Battle background** follows the defender's type (`BATTLE_GRADIENTS` in `theme.ts`). Grunt battles use `GRUNT_BATTLE_GRADIENT`. A Normal gradient is included for completeness even though no tile defender is Normal. A white spotlight disc (110% of the render) sits behind each fighter and stays still while the render lunges.
11. **Type chart** can be opened any time: from the side panel, and from the battle header (it opens on top of the battle). Every cell comes from the engine's `typeMultiplier`, so it always matches what battles do. It shows a full grid on tablet and up, and a per-type "strong / weak" list on phones.

## Not in the MVP

Trading, auctions, mortgages, doubles, battle XP, status effects, per-Pokémon stats or unique moves, chat, spectators, sound.
