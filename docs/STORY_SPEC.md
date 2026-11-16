# Living World: story-first design (iteration 2)

This document replaces the "sim management" framing of iteration 1. It sits on top of
ARCHITECTURE.md (which still holds for the transport, the Tx, the tick loop and the god powers) and
on top of LIVING_WORLD_SPEC.md's principles: one canonical world, the LLM proposes and the rules
decide, agents only know what they perceive, the world never waits for a model.

**The client is the native SwiftUI app in ios/LivingMoon.** The Expo app in mobile/ is kept only as
the home of the Convex backend (mobile/convex) and the art pipeline (mobile/tools/art). All demos run
in the iOS app.

## 1. What the player should feel

Shackleton Colony is a place with a past, people with something to lose, and three or four stories
already in motion when the player arrives. The player is an unseen force who can follow any life,
hear what that person is thinking, ask them about themselves, and tip the world with god powers.
After five minutes a player should be able to tell a story: "I followed Ines, who is skimming water
for her sick brother. The quartermaster caught on. I whispered doubt into him, and now he is
blackmailing her instead of reporting her."

Rules that make it a story rather than a spreadsheet:

1. **Every key character wants something, fears something and hides something.** Their daily
   schedule is a consequence of those, not a fixed timetable.
2. **The same need, different answers.** Everyone needs water and food. A grower tends a private
   rack, a worker earns and buys, a charmer asks a friend, a schemer skims the depot, an
   opportunist scavenges the surface or trades on the black market. Strategy choice comes from
   personality, skills, relationships, secrets, and what worked or failed for them before.
3. **Relationships are the engine of drama.** Debts, favours, romances, rivalries, betrayals,
   loyalties and secrets known by others create obligations and leverage that drive choices.
4. **Storylines are tracked and escalate.** The world keeps a list of live storylines (seeded and
   emergent). Each has participants, tension and beats, and moves through brewing → rising →
   climax → resolved (or fizzles). The player can read them like chapters.
5. **The followed character is never boring.** Following someone buys them priority attention:
   LLM plans for every decision, an inner monologue, answers to the player's questions, a director
   that brings the story to them, and automatic fast-forward through sleep and routine work.
6. **Consequences are legible.** Every event cites its cause. The monologue says why. The chronicle
   groups events into storylines.

## 2. The setting and its history

Shackleton Colony sits on the rim of Shackleton crater at the lunar south pole: a ring of
pressurised domes joined by tubes, an ice-mining camp in the permanently shadowed crater floor, a
regolith quarry and a landing pad. It was founded 19 years ago by the Artemis-Meridian consortium as
a water-export outpost. Seven years ago the consortium went bankrupt on Earth; supply shuttles
became irregular and the colony was left to govern itself. The founding families (the Founders'
Compact) kept the old council, the ration ledgers and the reserve. The miners and fabricators who
keep the colony alive formed the Diggers' Union. The traders who keep shuttles coming formed the Free
Exchange League. Everyone remembers the Long Dark, the winter four years ago when a reactor fault and
a lost shuttle killed eleven people, and everyone blames someone for it.

The seed (convex/seed) owns the authored detail: the exact history, the key characters and the
storylines in motion at Sol 1. The client gets all of it through story:intro.

## 3. Characters

### 3.1 Persona (minds.persona)

Every colonist has a persona. Key characters (about 20) are hand-written; the other 80 are
generated with the same fields so nobody is filler.

- epithet: a short tag shown in the UI, e.g. "the quartermaster who keeps two ledgers".
- want: the conscious goal; need: what they actually need (the arc's lesson).
- fear, flaw: what pushes them to bad choices.
- secret (optional): a true fact about them that others can discover through confide, eavesdrop,
  investigate or blackmail. Its kind maps to a belief kind so discovery is mechanical.
- voice: how they talk (for the LLM's speech, monologue and answers).
- strategies: their preferred ways to meet needs, in order, from: work, grow, trade, charm, borrow,
  beg, scavenge, smuggle, steal, scheme. The planner weights options by these, and success or
  failure shifts them (someone caught stealing becomes more cautious or more desperate).
- arc: { stage: setup | rising | crisis | climax | resolution, note }. The director advances it.

### 3.2 Actions (STEP_SPECS in engine/core.ts)

Iteration 1 had 20 steps. Iteration 2 adds the social and scheming verbs that make emergent stories
possible. Every step is resolved by rules against real state and writes events, beliefs and
relationship changes:

grow, scavenge, beg, borrow, repay, barter, bribe, blackmail, lie, confide, court, comfort, threaten,
sabotage, smuggle, rally, strike, reconcile, eavesdrop, hide, confess.

Debts (borrow/repay), favours (bribe), leverage (blackmail), romance (court), alliances (rally),
and secrets (confide, eavesdrop, confess) live in relationships (obligation, affinity, trust, fear)
and beliefs (kinds such as secret_*, debt, affair, sabotage), so they are persistent and visible in
the inspector.

## 4. Storylines and the director (convex/storyteller)

- storylines table: seeded at Sol 1 (3–5 in motion) and created at runtime when the director spots
  a pattern (a grudge that escalates, a debt that goes unpaid, a romance across factions, a crime
  investigation, a council power struggle, a crisis caused by a god power).
- The director runs once per tick (storyteller/director.ts directorTick, called by the engine after the agents step). It
  attaches new events to storylines, updates tension, records beats, advances arcs, and nudges the
  story: it can queue LLM thinking for participants, put an encounter in someone's path
  (interrupt with a go/talk step), or surface a choice. It never writes outcomes directly.
- Beats with high tension become banners in the wide view. The chronicle can show a storyline as a
  chapter list.

## 5. Following a character

- **Inner monologue.** While followed, the character produces a thought on every new decision and
  every notable thing they perceive (LLM in the focus lane; rule-based fallback). Shown as a feed.
- **Ask them.** The player can type a question ("Why do you hate Dmitri?"). The character answers in
  voice from their persona, memories, beliefs and relationships. Answers never change their state.
- **Plant a thought.** From the Mind tab the player can type a thought into the character's head
  (focus:plant, 3 to 200 characters). The LLM reads it into the whisper machinery (preset, a
  suspicion or admiration of a named person, strength), with a keyword fallback, and it lands as a
  whisper: an intervention event, a private belief, a goal and a plan interrupt. The idea appears in
  the monologue as their own thought ('planted'), and their reaction follows within a tick or two.
  It counts against the powers' rate limit and advances the tutorial's use_power step.
- **Every decision is thought through.** The focus lane gets a reserved LLM budget so the followed
  character plans with the LLM at each decision point, choosing from the full action set.
- **No dead air.** When the followed character is in a routine stretch (sleep, a long shift, waiting)
  and nothing is happening around them, the world fast-forwards automatically (world.focusWarp).
  The director also ensures something story-relevant happens to the followed character at least
  about once per in-game hour of following: a visitor, a rumor reaching them, a choice.
- **Follow the thread.** When the followed character interacts with someone who is part of a live
  storyline, the app offers to switch to that person ("Follow Dmitri: he just found the ledger").

## 6. Introduction and tutorial

On a new world, after onboarding, the app shows the story introduction (story:intro): the setting,
the history, what is at stake, the key characters as cards, and the storylines in motion. Then it
starts the player following the starter character, whose first in-game hour is authored to show
every verb: watch them, read their thoughts, ask them a question, see them interact, switch to
another character, use a god power and watch the consequence, open the chronicle. Tutorial steps
come from story:intro and advance on player actions.

## 7. LLM budget

LLM calls go where the player is looking: the followed character (plans, monologue, answers)
first, then storyline participants at high tension, then crises, then everyone else. The budget is
configurable per world (world.config.llm) and the world keeps working on rules when it runs out.

## 8. Society: the world grows its own institutions and culture

Inspired by Dwarf Fortress: the colony's institutions, families, knowledge and culture are
simulated, so stories come from them rather than from a script. **None of it is shown as a stat
screen.** The player meets it through people: a monologue line, a banner ("Rosa founded the Rust
Choir"), a storyline, a line in the inspector in words ("a respected elder", "obsessed with finding
the drill saboteur"), and an Almanac view that reads like the colony's history book.

- **Organizations** (organizations table): companies, guilds, cults, gangs, militias, parties,
  schools, troupes and breakaways (defectors who claim territory and declare their own rules).
  Agents found, join, leave, recruit, preach, pay dues, meet, raid, protect, make deals, hold rituals
  and expel. Organizations have creeds, treasuries, hidden reputation, leaders and rivals, and they
  split, merge, go to war (raids, sabotage) and collapse.
- **Social status** (minds.society.status, hidden): prestige from job, wealth, fame, rank, deeds and
  scandal. It changes who listens to whom, who gets hired, married or followed, and who is envied.
- **Families**: partners (court, propose), children born into households who grow up (ageBand
  'child', then young adults choosing careers), inherit traits and grudges; pets with names and
  bonds (and grief when they die).
- **Education and jobs**: study (Observatory school, a teacher, self-taught), teach, mastery of
  skills, apply for jobs, promotions, firing, unemployment, careers that change identity.
- **Building and invention**: structures from a catalogue (shared/society.ts STRUCTURES) built
  from resources, and a long tree of discoveries (DISCOVERIES, 50+) made by experimenting, each
  with prerequisites and a real effect on the world (new structures, better yields, new medicine,
  new art forms, new risks).
- **Arts and culture**: murals, songs, poems, sculptures, plays, holos and stories with quality and
  fame; striving artists, famous artists, rivalries between them, works inspired by real events,
  performances that shift moods and beliefs.
- **Obsessions**: occasionally someone becomes obsessed with a goal (a person, a discovery, a
  grudge, a masterpiece, a lost relic of the Long Dark). It overrides routine and drives extreme
  choices until fulfilled or broken.
- **Random events**: a scheduler of sudden happenings independent of the player (a quake, a
  shuttle with a stranger, a disease outbreak, a strange signal from the crater, a reactor scare, a
  festival, a pet escaping, a lucky ice strike), tuned to keep the story fresh without chaos.
- **Belief and status change through experience**: what people live through (being helped,
  betrayed, saved, humiliated, inspired by a work of art) shifts their beliefs, values, status and
  relationships over time.
