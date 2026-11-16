# Living World: architecture for iteration 1

A god-mode mobile game. The player is an unseen force over Shackleton Colony, a moon colony of
100 autonomous colonists. Each colonist has needs, traits, values, goals, beliefs and
relationships, and acts on their own. The player causes world events and watches the consequences.

The full design is in `LIVING_WORLD_SPEC.md` (written for a fantasy town, 50 agents and a Godot
client). This document records where iteration 1 differs and how the code is split.

## Decisions that override the spec

| Topic | Spec | Iteration 1 |
|---|---|---|
| Setting | Fantasy town | Sci-fi colony on the Moon (`shared/colony.ts`) |
| Population | 50 seeded, cap 60 | 100 seeded, cap 120 |
| Client | Godot | The Expo React Native app draws everything itself. No Godot. |
| Art | Top-down fantasy diorama | Top-down pixel art at a fairly high resolution |
| Resources | food, wood, coin, medicine | food, water, parts, medicine, credits |
| Needs | hunger, fatigue, safety, social | adds thirst, because water is the scarce thing here |
| Drought | Less rain | The ice wells run dry: water falls, then hydroponics yield |
| Storm | Storm or flood | Solar or meteor storm that hits exposed surface sites |
| Rumors | P1 `spread_rumor` action | A P0 god power: start a rumor about a chosen colonist |
| Notifications | Chronicle only | Banners in the wide view for high-salience events, plus the chronicle |
| Transport | HTTP actions for Godot | Convex queries and mutations, called by the Convex React client |

Everything else in the spec stands, in particular its principles: one canonical world on the
backend, the LLM proposes and rules decide, agents know only what they perceive, LLM calls are
sparse and budgeted, and the world never waits for a model.

A Godot client stays possible later: every function in `shared/api.ts` is a public Convex function,
reachable over Convex's HTTP API, and nothing in the backend depends on React Native.

## Layout

```
docs/ARCHITECTURE.md        this file
mobile/shared/              the contract, imported by backend and client
  colony.ts                 clock, resources, locations, routes, occupations, sprite ids, presets
  mapLayout.ts              pixel geometry of the map (rendering only)
  types.ts                  public data shapes: AgentLite, AgentDetail, WorldPublic, events, powers
  api.ts                    the Convex function contract (paths, args, returns)
  assets.ts                 the art manifest type
mobile/convex/              backend: schema, seed, simulation, powers, LLM cognition, queries
mobile/src/                 client: data sync, Skia world renderer, HUD and panels
mobile/assets/game/         pixel art and manifest.ts
mobile/tools/art/           scripts that generate or process the art
```

## Ownership and branches

Three owners build in parallel from the foundation branch `capy/living-world`. Each works on its
own branch, commits and pushes there, and opens no pull request. The parent thread merges the
three into `capy/living-world` and opens the one pull request.

| Owner | Branch | Owns |
|---|---|---|
| Backend | `capy/lw-backend` | `mobile/convex/**`, `mobile/shared/colony.ts`, `types.ts`, `api.ts`, backend tests |
| Client | `capy/lw-client` | `mobile/App.tsx`, `mobile/index.ts`, `mobile/src/**`, `mobile/app.json`, client deps |
| Art | `capy/lw-art` | `mobile/assets/game/**`, `mobile/tools/art/**`, `mobile/shared/mapLayout.ts`, `assets.ts` |

Rules that keep the merge trivial:

- Edit only what you own. If you need a change in a file you do not own, say so in your final
  report with the exact change; do not make it.
- The contract files may gain fields and entries. Do not rename or remove what is already there
  without saying so in your final report, because the other owners are coding against it.
- `package.json` and `package-lock.json` will conflict at merge and are regenerated then. List
  every dependency you added in your final report.
- Only the backend owner deploys to the Convex dev deployment.

## How the pieces talk

- The backend is authoritative. A scheduled mutation advances the world one 10-minute tick at a
  time while a client heartbeat is fresh. Agents are scheduled by next-due time, so a tick touches
  only the agents whose activity ended, not all 100.
- The client subscribes to `world:get` (the clock and colony-wide state), loads `agents:list` once,
  and pulls `sync:updates` for the agents and events that changed since its last version.
- Movement is sent as `{ from, to, departTick, arriveTick }`. The client animates along
  `findPath(from, to)` at frame rate using a locally extrapolated tick, so smooth motion needs no
  per-frame backend traffic.
- Where a colonist stands inside a location is cosmetic and chosen by the client from
  `LOCATION_LAYOUT[id].standAreas`.
- God powers go through `interventions:apply`, which validates, is idempotent on `commandId`,
  writes the immediate effect and its event in one transaction, and lets later ticks propagate the
  consequences.
- LLM planning runs in Convex actions from a bounded, prioritised job queue. Output is
  schema-validated and committed through a mutation, or dropped in favour of rule-based plans.

## Backend engine: who owns what (continuation)

The backend is built on `mobile/convex/engine/core.ts`, which holds the primitives every writer
shares: the `Tx` (one mutation, one world version), `emitEvent`, `learnBelief`,
`adjustRelationship`, `setPlan`, `interrupt`, `killAgent`, `enqueueCognition`, and
`STEP_SPECS`, the table of legal plan steps. Read it before writing backend code.

| Owner | Branch | Owns |
|---|---|---|
| Simulation | `capy/lw-sim-engine` | `convex/sim.ts`, `convex/world.ts`, `convex/engine/**` (may add to `core.ts`), `convex/lib/constants.ts` |
| Powers and read API | `capy/lw-sim-powers` | `convex/interventions.ts`, `convex/sync.ts`, `convex/chronicle.ts`, `convex/powers/**` |
| LLM cognition | `capy/lw-sim-llm` | `convex/cognition.ts`, `convex/cognition/**` |
| Art | `capy/lw-art` | `mobile/assets/game/**`, `mobile/tools/art/**`, `shared/mapLayout.ts`, the import in `src/art/index.ts` |

All four start from `capy/lw-sim` and are merged back into it. Backend tests run in memory with
`npm test` (vitest and convex-test, see `convex/core.test.ts`), so nobody but the integrator
deploys to the shared Convex dev deployment.

How the three backend parts meet:

- The simulation executes every step in `STEP_SPECS` and decides whether it succeeds. Powers and
  the LLM never write outcomes; they change conditions (an effect, a belief, a goal, a plan) and the
  tick engine plays them out.
- Standing conditions live in `world.activeEffects` (`drought`, `storm`), `world.damage` and
  `world.stockpiles`. The powers write them; the simulation reads them every tick and ends them.
  `world.causes[type]` holds the event id of a standing condition so later events can name it as
  their cause.
- A rumor or whisper is a belief planted with `learnBelief`. It spreads when the simulation runs a
  `talk` step whose topic is that belief's key. Goals planted by a whisper carry
  `source: 'divine'` and a `drive` equal to the preset key.
- The simulation asks for LLM reasoning with `enqueueCognition` and carries on with rule-based
  plans. The cognition layer answers by calling `setPlan` (source `llm`) through a mutation, only
  if the mind's `stateVersion` has not moved since the job was queued.

## Avatars and multiplayer

A player can put a colonist modelled on themself into the world, and friends can join that world
with their own.

- **Import.** The iOS client digests material on the device and sends only the digest:
  Gmail through OAuth (senders' domains, subject lines and labels, never bodies or addresses; the
  token never leaves the phone), the answer the player's own assistant (ChatGPT, Claude, Gemini)
  gives to a fixed "what do you know about me" prompt, and free text. `avatar:addSource` scrubs
  email addresses, phone numbers and links again before storing (`personaSources`, at most 6).
- **Build.** `avatar:synthesize` asks the LLM for an `AvatarProfile` (job, traits, values,
  backstory, interests, speech style, habits, goals). Keyword rules in `convex/avatar/profile.ts`
  build the same shape with no model and patch any field the model gets wrong. The player can edit
  the result (`avatar:saveProfile`, checked strictly).
- **Spawn.** `avatar:spawn` runs the create_character arrival, then marks the agent with
  `ownerSessionId`/`ownerName` and the mind with `persona`. Other players' living avatars in
  the world become friends, and the first LLM plan is queued in the focus lane.
- **Act like the player.** For an avatar, the plan and speech prompts add who the player is, how
  they talk, what they tend to do and their latest directive, and mark other players' avatars in
  the people list. Avatars get a third of the normal LLM cooldown.
- **Directives.** `avatar:direct` turns "go make friends with the medics" into the avatar's top
  goal (source `owner`), an immediate keyword plan (`convex/avatar/directive.ts`) and a
  focus-lane LLM request that replaces it when it arrives.
- **Multiplayer.** The host's `multiplayer:invite` gives the world a 6-character code; a friend's
  `multiplayer:join` moves their session into that world (keeping `homeWorldId` to go back to
  with `multiplayer:leave`), and the client restarts its subscriptions with
  `session:bootstrap`. Up to 8 players per world. kill and whisper refuse another player's avatar.
