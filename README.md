# Ultimate Tic Tac Toe

Web-based competitive Ultimate Tic Tac Toe with random matchmaking, fixed-delta ranked ladder, guest casual play, profiles, friends, and a playful TR/EN UI.

## Stack

- **apps/web** — Next.js 15 (App Router), Auth.js, next-intl
- **apps/realtime** — Socket.IO server-authoritative matchmaking & gameplay
- **packages/game-engine** — Pure UTTT rules engine
- **packages/bot** — Offline alpha-beta engine (Worker + persistent TT)
- **packages/contracts** — Shared Zod event schemas
- **packages/rating** — Fixed-delta rating (±40) + league tiers
- **packages/db** — Drizzle + PostgreSQL schema

## Game modes

- **Casual** — random online matchmaking (guests allowed)
- **Ranked** — Fixed-delta ladder starting at 300 (requires a signed-in account)
- **vs Bot** — offline single-player (`/play/bot`) with Easy / Medium / Hard; searches run in a Web Worker from central profiles in `packages/bot` (no backend required)
- **Same device** — pass-and-play on one phone or laptop (`/play/local`); scoreline persists across games, with undo
- **Room** — invite a friend with a 5-character code or shareable link (`/play/room` / `/play/room/ABC12`); the room stays open for rematches and seats swap each game.
- **Play request** — the friends list shows who is online and sends them a direct request instead of a code; accepting drops both players straight into a room.

## Quick start (memory mode)

No Docker required. Realtime runs in-memory; ranked persistence needs Postgres.

```bash
cp .env.example .env
npm install

# Terminal 1 — PowerShell
$env:MEMORY_ONLY='1'; npm run dev:realtime
# or: npm run dev:realtime:memory

# Terminal 2
npm run dev:web
```

Open http://localhost:3000 — open two browsers/incognito windows and queue **Casual**.

## Full stack (Postgres + Redis)

```bash
docker compose up -d
cp .env.example .env
npm install
npm run db:push
npm run dev:realtime
npm run dev:web
```

## Accounts

Sign-in is email + password, handled entirely by this app — there is no external
OAuth provider to configure. Passwords are bcrypt-hashed into `users.password_hash`,
and sessions are JWTs signed with `AUTH_SECRET`.

- Register at `/register`, sign in at `/login`.
- Accounts live in Postgres, so `docker compose up -d` and `npm run db:push` are
  required before anyone can register. Without a database the login form reports
  that it is offline; guest casual play still works.
- Set `AUTH_SECRET` in `.env` to a long random value
  (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).

## Game rules (standard)

- 9×9 nested boards; win 3 local boards in a row to win.
- Your cell sends the opponent to the corresponding local board.
- If that board is finished, they may play on any open board.
- Clock: **5 minutes + 2 seconds** per move.
- Guests: casual only. Ranked requires a signed-in account.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev:web` | Next.js on :3000 |
| `npm run dev:realtime` | Socket.IO on :3001 |
| `npm test` | Unit tests (engine, rating, matchmaking, bot) |
| `npm run arena:quick` | 50-position seat-swap Elo sample (fast budgets) |
| `npm run arena:full` | Stronger Elo arena with larger node budgets |
| `npm run arena:ship -w @uttt/bot` | Ladder Elo + per-move cost at the **shipped** profiles |
| `npm run calibrate:bot` | Alias for full arena + profile dump |
| `npm run db:push` | Push Drizzle schema to Postgres |

## Bot engine

Production path: iterative deepening alpha-beta in a Web Worker.

Key pieces in [`packages/bot`](packages/bot):

- Incremental 9-bit bitboards per local board plus meta-board masks; threat, win and draw detection are table lookups with no per-node allocation
- Threat counting for every (mine, theirs) occupancy pair is precomputed into a 512 KB table, so evaluation and move classification cost one indexed load instead of a line scan
- Dual-`uint32` Zobrist keys held as scalar halves, plus a typed-array transposition table and typed-array undo stack — `make`/`unmake` allocate nothing
- Worker-owned `BotSearchSession` (TT retained across turns of the same game)
- Principal Variation Search, depth × move-index LMR table (Hard), killer / history / counter-move ordering with per-iteration history aging
- Each move is classified once per node and the result is carried into the move loop, rather than recomputed for ordering and again for pruning decisions
- Iterative deepening with widening aspiration windows; an interrupted iteration still keeps a root move that overtook the previous principal variation at that depth
- Selective extensions on forced replies and meta-decisive moves, bounded by a per-path budget
- Tiered forcing search at the horizon: local wins and blocks near the top, meta-decisive moves only at the deepest plies
- Exact endgame solver with its own transposition table; proven results are stored side-to-move relative so they stay valid all game
- Shared node/time budget: solver uses a share of remaining nodes; if it fails, heuristic search continues on the rest

Evaluation scores won boards, local and meta threats and forks, plus UTTT-specific strategy: how dangerous the board you send the opponent into is, the cost of handing over a free move, and discounting boards whose meta lines are already dead.

Profiles live in [`packages/bot/src/difficulty.ts`](packages/bot/src/difficulty.ts). Each level is governed by a different dial, and the other caps are only guards:

| Level | Governed by | Depth cap | Node budget | Search extras | Notes |
|-------|-------------|-----------|-------------|---------------|-------|
| Easy | depth | 1 | 2,500 | forcing q=1 | Beginner: no meta-block shortcut, unsafe soft blunders, wide noisy root |
| Medium | depth | 3 | 40,000 | PVS + TT + extensions | Beatable but balanced; trusts meta-block shortcut; light soft-blunder variety |
| Hard | nodes + clock | 40 | 2,400,000 | PVS + LMR + extensions + endgame | Deterministic principal move; opening book uses center only |

Hard previously capped at depth 12 and finished in roughly 800 ms, leaving most of its 2 s allowance unused. The cap is now high enough to be inert, so the node budget and clock decide when to stop; a slow device returns its deepest completed iteration rather than stalling.

An immediate meta win is played without searching on every level, since it is provably optimal. The meta *block* is not: Medium trusts it (`trustTacticalShortcuts`) so it stays a fair defender; Easy leaves blocks to shallow noisy search and may gift the game (`allowUnsafeBlunders`); Hard searches the block as the first root move and sometimes finds better — taking the contested board outright, for instance, kills the opponent's meta line instead of merely delaying it. Host timeouts use `pickEmergencyMove` (no second UI-thread search).

### Benchmarks

`npm run bench` reports two rows. The `nps` row pins every position to the same node budget with the depth cap lifted, so total work is constant and wall time is directly comparable between revisions; the `profile` row shows what shipped Hard actually reaches. `npm run compare` is an A/B harness that plays two engine profiles head to head and reports a paired-bootstrap Elo.

On the fixed-work row, throughput went from ~1.04M to ~1.60M nodes/sec, almost entirely from replacing per-line threat scans with the precomputed threat table. Average completed depth at the same node budget went from 10.58 to 11.00.

### Measuring a change

Elo is the only trustworthy verdict on a search change, and `tools/compareEngines.ts` is the instrument. Snapshot the engine **before** editing it:

```bash
cd packages/bot
mkdir baseline && cp src/*.ts baseline/
rm baseline/*.test.ts baseline/{arena,arenaStats,bench,calibrate,compare}.ts
```

Then `npm run arena:baseline -w @uttt/bot -- 120000 50` plays the working tree against the snapshot at an equal node budget, so the result reflects search quality rather than raw speed. Hard is deterministic for a given position, so two identical engines score exactly 0.500 — any Elo it reports is attributable to the change.

Against the engine as it stood before the LMR table, aspiration windows and root-ordered meta blocks, the current search scores **+38 Elo (CI [7, 73])** at 120k nodes/move and **+79 Elo (CI [21, 142])** at 500k over 48 games. The gap widens with the budget, which is expected: better pruning compounds with depth, and Hard searches ~1.35M nodes per move.

### Elo arena

`npm run arena:quick` / `arena:full` load [`packages/bot/src/fixtures/arena-50.json`](packages/bot/src/fixtures/arena-50.json) when present (else generate 50 positions) × seat swap (= 100 games). These scale budgets down to stay fast, which means they do not measure the shipped bot.

`npm run arena:ship -w @uttt/bot` does, at the cost of running for several minutes; it writes [`ladder-baseline.json`](packages/bot/src/fixtures/ladder-baseline.json) with Elo, per-move cost, and **human-proxy** pairings (`random`, `greedy1`, `shallowNoGuard`). Latest run (20 games per pairing):

| Pairing | Score | Elo | 95% CI | W-D-L |
|---------|-------|-----|--------|-------|
| Hard over Medium | 0.976 | +645 | [645, 645] | 20-0-0 |
| Medium over Easy | 0.905 | +391 | [226, 645] | 18-1-1 |
| Easy over random | 0.929 | +446 | [280, 645] | 19-0-1 |
| Easy over greedy1 | 0.357 | −102 | [−226, 0] | 3-8-9 |
| Medium over greedy1 | 0.738 | +180 | [67, 311] | 11-8-1 |
| Easy over shallowNoGuard | 0.667 | +120 | [−17, 280] | 13-1-6 |

Human-facing read: Easy loses often to a 1-ply greedy proxy (beginner-friendly) while still beating pure random; Medium sits above that proxy without being a wall. Per move, Hard averages ~1.05M nodes / 1.4 s (2.0 s worst case) at depth ~11; Medium ~550 nodes / 1.3 ms at depth ~2.9; Easy ~36 nodes at depth 1. Millisecond figures are hardware-specific; node counts and Elo are not.

### Tactical regression suite

[`src/mates.test.ts`](packages/bot/src/mates.test.ts) replays forced meta wins that a 6k-node search misses, keeping only positions where fewer than half the legal moves win, so a degraded search cannot pass by luck. The budget is expressed in nodes with an effectively unlimited clock, making the suite deterministic across machines. Regenerate with `npm run gen:tactics -w @uttt/bot` followed by `npx tsx tools/pruneTactics.ts`.

## MVP features

- Random casual & ranked matchmaking
- Server-validated moves, reconnect, resign, timeout
- Socket-aware disconnect (stale tabs no longer forfeit live games)
- End reason shown on results (normal / resign / timeout / disconnect)
- Single-player vs bot (Easy / Medium / Hard)
- Same-device pass-and-play
- Private rooms (code + link invite, rematch, seat swap)
- Fixed-delta ratings (±40, capped upset/favorite swings), leagues, leaderboard
- Profiles & match history
- Friends (request / accept / online status / direct play request)
- TR / EN localization
- Playful responsive board UI

## Deferred (post-MVP)

AI post-game analysis, neural MCTS / ONNX “Master” tier, tournaments, clubs, spectating, cosmetics shop.

**Hard plays a memorizable opening.** It has no randomness (`candidateWindow: 0`, `candidateTemperature: 0`) and `openingPrincipal: true` restricts the book to a single line: center-center on move 1, `4/0` against a center opening, then center of the sent board. A player who repeats an opening sees the identical game every time. Strength-neutral fix if it ever matters: let Hard use the weighted book like Medium does (every book alternative is already a sound move) and leave the search deterministic, or add a tiny root window that only ever swaps between moves the search scores exactly equal.
