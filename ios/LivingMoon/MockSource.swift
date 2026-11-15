import Foundation

/// A local fake of the backend, ported from mobile/src/data/mockSource.ts. It is not the simulation:
/// it produces plausible colonists, routines, moves, social events and power results so the app can
/// be built and demoed without the Convex deployment.
@MainActor
final class MockSource: WorldSource {
    let isLive = false
    let worldId = "mock-world"

    private struct Faction { let id: String; let name: String }
    private static let factions = MockStory.factions.map { Faction(id: $0.id, name: $0.name) }
    private static let first = ["Mira", "Tomas", "Elian", "Asha", "Kenji", "Noor", "Ivo", "Lena", "Dax", "Yara", "Soren", "Priya", "Malik", "Juno", "Teo", "Ines", "Rafe", "Zhen", "Oksana", "Bram", "Calla", "Emeka", "Farah", "Goran", "Hana", "Idris", "Jaya", "Kofi", "Liang", "Marit", "Nico", "Oona", "Pavel", "Quinn", "Rosa", "Sami", "Talia", "Uri", "Vera", "Wren", "Xavi", "Yusuf", "Zora", "Anouk", "Bodhi", "Cyrus", "Dalia", "Esme", "Finn", "Greta"]
    private static let last = ["Okafor", "Vance", "Reyes", "Tanaka", "Novak", "Haddad", "Lindqvist", "Mbeki", "Sorensen", "Park", "Castillo", "Ivanova", "Rahman", "Duarte", "Fischer", "Adeyemi", "Kowalski", "Nakamura", "Silva", "Brandt", "Chowdhury", "Moreau", "Petrov", "Osei", "Alvarez", "Hale", "Ng", "Bianchi", "Koroma", "Stone"]
    private static let moods = ["content", "focused", "tired", "cheerful", "restless", "calm", "worried", "hopeful"]
    private static let talk = ["Water ration is down again.", "Did you hear about the depot?", "The council is hiding something.", "Long shift. I need a drink.", "Prices at the Exchange are up.", "Drill three is jammed again.", "The new arrivals seem decent.", "Save me a seat at the canteen.", "Earth feels so far away.", "I could sleep for a sol.", "They say a shuttle is coming.", "Careful who you trust here."]
    private static let counts: [String: Int] = ["hydroponicist": 14, "ice_miner": 10, "quarry_hand": 8, "fabricator": 10, "solar_tech": 6, "trader": 8, "quartermaster": 2, "councilor": 5, "security": 6, "medic": 6, "researcher": 6, "cook": 5, "dock_hand": 4, "hauler": 5, "resident": 5]
    private static let workVerb: [String: String] = ["hydroponicist": "Tending the grow racks", "ice_miner": "Drilling for ice", "quarry_hand": "Digging regolith", "fabricator": "Printing parts", "solar_tech": "Servicing the panels", "trader": "Running a stall", "quartermaster": "Counting the reserve", "councilor": "Hearing petitions", "security": "Patrolling", "medic": "Treating patients", "researcher": "Running experiments", "cook": "Cooking for the colony", "dock_hand": "Unloading cargo", "hauler": "Hauling crates", "resident": "Running errands"]

    private struct Agent {
        var lite: AgentLite
        var detail: AgentDetail
        var factionId: String?
        var values: [String: Double]
        var rumorKeys: Set<String> = []
    }

    private var rng = Mulberry32(seed: 20261115)
    private var tick = 12.0
    private var speed = 1.0
    private var version = 1.0
    private var nextId = 1
    private var timer: Timer?
    private var order: [Id] = []
    private var agents: [Id: Agent] = [:]
    private var events: [WorldEventPublic] = []
    private var effects: [ActiveEffect] = []
    private var damage: [LocationId: Double] = [:]
    private var stock: [String: Double] = ["food": 620, "water": 540, "parts": 210, "medicine": 90, "credits": 4000]
    private var prices: [String: Double] = ["food": 4, "water": 5, "parts": 9, "medicine": 14]
    private var commands: [String: InterventionResult] = [:]
    private var detailWatchers: [Id: [UUID: (AgentDetail?) -> Void]] = [:]

    // The story layer.
    private var personas: [Id: PersonaPublic] = [:]
    private var keyIds: [String: Id] = [:]
    private var storylines: [StorylinePublic] = []
    private var storylineIds: [String: Id] = [:]
    private var laterBeats: [String: [MockStory.Line]] = [:]
    private var scriptIndex = 0
    private var focusId: Id?
    private var warping = false
    private var thoughts: [Id: [ThoughtLine]] = [:]
    private var hooks: [Id: [StoryHook]] = [:]
    private var conversations: [Id: [AskTurn]] = [:]
    private var society: [Id: (orgs: [AgentDetail.Membership], family: AgentDetail.Family?, pets: [AgentDetail.Pet], obsession: String?, works: [AgentDetail.WorkRef], standing: String, education: String?)] = [:]
    private var storylineWatchers: [UUID: (agentId: Id?, onValue: ([StorylinePublic]) -> Void)] = [:]
    private var focusWatchers: [Id: [UUID: (FocusState?) -> Void]] = [:]
    private var conversationWatchers: [Id: [UUID: ([AskTurn]) -> Void]] = [:]
    private weak var sink: SourceSink?

    init() { seed() }

    // MARK: Helpers

    private func rand() -> Double { rng.next() }
    private func pick<T>(_ list: [T]) -> T { list[Int(rand() * Double(list.count))] }
    private func clamp(_ v: Double, _ lo: Double = 0, _ hi: Double = 100) -> Double { max(lo, min(hi, v)) }
    private func newId(_ prefix: String) -> Id {
        defer { nextId += 1 }
        return prefix + String(nextId)
    }
    private var all: [Agent] { order.compactMap { agents[$0] } }
    private func hour() -> Int { Clock.parts(tick).hour }

    private func touch(_ id: Id) { agents[id]?.lite.updatedAtVersion = version }

    @discardableResult
    private func emit(_ category: EventCategory, _ type: String, actor: Id? = nil, participants: [Id] = [], at location: LocationId? = nil, _ summary: String, salience: Double, cause: Id? = nil, visibility: String = "public", banner: Bool? = nil, storylineId: Id? = nil) -> WorldEventPublic {
        let event = WorldEventPublic(id: newId("e"), tick: tick, category: category, eventType: type, actorId: actor, participantIds: participants, locationId: location, summary: summary, salience: salience, causationEventId: cause, banner: banner ?? (salience >= 0.6), storylineId: storylineId, visibility: visibility)
        events.append(event)
        if events.count > 600 { events.removeFirst(events.count - 600) }
        for id in [actor].compactMap({ $0 }) + participants {
            guard agents[id] != nil else { continue }
            agents[id]!.detail.recentEvents = Array(([event] + agents[id]!.detail.recentEvents).prefix(14))
        }
        return event
    }

    private func relate(_ from: Id, _ to: Id, kind: String, affinity: Double) {
        guard from != to, let target = agents[to], agents[from] != nil, !agents[from]!.detail.relationships.contains(where: { $0.toAgentId == to }) else { return }
        agents[from]!.detail.relationships.append(RelationshipPublic(toAgentId: to, toAgentName: target.lite.name, toAgentAlive: target.lite.alive, kind: kind, affinity: affinity, trust: clamp(affinity + (rand() - 0.5) * 0.4, -1, 1), fear: kind == "rival" ? rand() * 0.4 : 0))
    }

    @discardableResult
    private func makeAgent(name: String, spriteId: String, occupation occId: String, home: LocationId, ageBand: String, traits: [String: Double]? = nil, values: [String: Double]? = nil, background: String? = nil, factionId: String? = nil, location: LocationId? = nil, persona: PersonaPublic? = nil) -> Id {
        let occ = occupation(occId)
        let traits = traits ?? Dictionary(uniqueKeysWithValues: TRAIT_KEYS.map { ($0, (rand() * 100).rounded() / 100) })
        let values = values ?? Dictionary(uniqueKeysWithValues: VALUE_KEYS.map { ($0, (rand() * 100).rounded() / 100) })
        let faction = Self.factions.first { $0.id == factionId }
        let id = newId("a")
        let needs = Needs(hunger: 20 + rand() * 30, thirst: 20 + rand() * 30, fatigue: 10 + rand() * 30, safety: rand() * 20, social: 20 + rand() * 40)
        let health = 70 + (rand() * 30).rounded(.down)
        let mood = pick(Self.moods)
        let lite = AgentLite(id: id, name: name, spriteId: spriteId, occupation: occ.id, factionId: faction?.id, alive: true, locationId: location ?? home, move: nil, activity: "idle", activityLabel: "Getting ready for the shift", busyUntilTick: tick + (rand() * 4).rounded(.down), interactingWithId: nil, speech: nil, mood: mood, health: health, needs: needs, updatedAtVersion: version)
        let wealth = values["wealth"] ?? 0, ambition = traits["ambition"] ?? 0, family = values["family"] ?? 0
        let second = wealth > 0.6 ? ("earn_wealth", "Save 300 credits for a private bunk") : ambition > 0.65 ? ("gain_influence", "Win a seat on the council") : family > 0.6 ? ("protect_person", "Keep the household supplied") : ("improve_relationship", "Make a real friend in the colony")
        let survive = GoalPublic(id: newId("g"), kind: "survive", description: "Keep fed, watered and rested", priority: 0.5, source: "needs", status: "active", createdAtTick: 0)
        let goals = [survive, GoalPublic(id: newId("g"), kind: second.0, description: second.1, priority: 0.35 + rand() * 0.3, source: "personality", status: "active", createdAtTick: 0)]
        let detail = AgentDetail(id: id, name: name, spriteId: spriteId, occupation: occ.id, alive: true, locationId: lite.locationId, activityLabel: lite.activityLabel, mood: mood, health: health, needs: needs, ageBand: ageBand, background: background ?? "Came up on one of the early shuttles and never left.", homeLocationId: home, workLocationId: occ.work, householdName: nil, factionName: faction?.name, traits: traits, inventory: ["food": 2 + (rand() * 6).rounded(.down), "water": 2 + (rand() * 6).rounded(.down), "credits": 10 + (rand() * 90).rounded(.down)], goals: goals, plan: PlanPublic(intent: "Get through the shift and keep the household supplied.", source: "routine", goalId: survive.id, steps: [PlanStep(label: "Work the shift", status: "running"), PlanStep(label: "Eat at the canteen", status: "pending"), PlanStep(label: "Rest at home", status: "pending")], cursor: 0), beliefs: [], relationships: [], recentEvents: [], lastThought: nil, death: nil)
        agents[id] = Agent(lite: lite, detail: detail, factionId: faction?.id, values: values)
        personas[id] = persona ?? MockStory.persona(occupation: occ.label) { Int(rand() * Double($0)) }
        order.append(id)
        return id
    }

    // MARK: Seed

    private func seed() {
        var counts = Self.counts
        for k in MockStory.keys {
            let id = makeAgent(name: k.name, spriteId: k.spriteId, occupation: k.occupation, home: k.home, ageBand: k.slug == "teo" ? "young" : "adult", background: k.background, factionId: k.factionId, location: k.post?.0, persona: k.persona)
            keyIds[k.slug] = id
            counts[k.occupation, default: 1] -= 1
            if let post = k.post { setActivity(id, "working", post.1, 60 - tick) }
        }
        var used = Set(MockStory.keys.map(\.name))
        for occ in OCCUPATIONS {
            for _ in 0..<(counts[occ.id] ?? 0) {
                var full = ""
                repeat { full = pick(Self.first) + " " + pick(Self.last) } while used.contains(full)
                used.insert(full)
                let faction: String? = ["councilor", "quartermaster", "security"].contains(occ.id) ? "compact" : occ.id == "trader" ? "league" : (["ice_miner", "hauler", "dock_hand", "quarry_hand", "fabricator"].contains(occ.id) && rand() > 0.3) ? "union" : rand() > 0.75 ? pick(Self.factions).id : nil
                makeAgent(name: full, spriteId: occ.archetype + "_" + String(Int(rand() * Double(SPRITE_VARIANTS))), occupation: occ.id, home: rand() > 0.5 ? .habitat_a : .habitat_b, ageBand: rand() < 0.15 ? "young" : rand() < 0.2 ? "elder" : "adult", factionId: faction)
            }
        }
        let seeded = Array(order.dropFirst(MockStory.keys.count))
        for i in stride(from: 0, to: seeded.count, by: 3) {
            let head = agents[seeded[i]]!
            let members = seeded[i..<min(i + 3, seeded.count)].filter { agents[$0]!.detail.homeLocationId == head.detail.homeLocationId }
            for m in members {
                agents[m]!.detail.householdName = String(head.lite.name.split(separator: " ").last ?? "") + " household"
                for other in members { relate(m, other, kind: "family", affinity: 0.6 + rand() * 0.4) }
            }
        }
        for id in seeded {
            for _ in 0..<4 {
                let other = pick(seeded)
                let kind = agents[other]!.lite.occupation == agents[id]!.lite.occupation ? "colleague" : rand() < 0.2 ? "rival" : rand() < 0.5 ? "friend" : "acquaintance"
                relate(id, other, kind: kind, affinity: kind == "rival" ? -0.2 - rand() * 0.6 : kind == "friend" ? 0.4 + rand() * 0.5 : rand() * 0.4)
            }
            agents[id]!.detail.relationships.sort { abs($0.affinity) > abs($1.affinity) }
            if rand() < 0.35 {
                let subject = agents[pick(seeded)]!.lite
                let text = pick(["{n} keeps a private stash of water.", "{n} is the best fixer in the colony.", "{n} wants the quartermaster job.", "{n} cannot keep a secret."]).replacingOccurrences(of: "{n}", with: subject.name)
                agents[id]!.detail.beliefs.append(BeliefPublic(id: newId("b"), text: text, subjectAgentId: subject.id, subjectAgentName: subject.name, confidence: 0.3 + rand() * 0.5, sourceType: pick(["observed", "told", "inference"]), learnedAtTick: 0))
            }
            agents[id]!.detail.beliefs.append(BeliefPublic(id: newId("b"), text: "The Supply Depot holds enough water for about ten sols.", confidence: 0.6, sourceType: "told", learnedAtTick: 0))
        }
        seedStory()
    }

    private func seedStory() {
        func key(_ slug: String) -> Id { keyIds[slug]! }
        let ties: [(String, String, String, Double)] = [
            ("ines", "teo", "family", 0.95), ("teo", "ines", "family", 0.9), ("ines", "dmitri", "rival", -0.35), ("dmitri", "ines", "acquaintance", 0.1),
            ("ines", "noor", "acquaintance", 0.2), ("noor", "ines", "acquaintance", 0.4), ("asha", "teo", "friend", 0.6), ("teo", "asha", "friend", 0.7),
            ("ines", "asha", "acquaintance", 0.3), ("dmitri", "marit", "colleague", 0.5), ("marit", "dmitri", "colleague", 0.3), ("kofi", "marit", "rival", -0.6),
            ("marit", "kofi", "rival", -0.5), ("kofi", "ines", "friend", 0.5), ("ines", "kofi", "friend", 0.45), ("noor", "dmitri", "rival", -0.2),
        ]
        for (a, b, kind, affinity) in ties {
            agents[key(a)]!.detail.relationships.removeAll { $0.toAgentId == key(b) }
            relate(key(a), key(b), kind: kind, affinity: affinity)
            let ties = agents[key(a)]!.detail.relationships
            agents[key(a)]!.detail.relationships = ties.filter { $0.toAgentId == key(b) } + ties.filter { $0.toAgentId != key(b) }
        }
        agents[key("ines")]!.detail.householdName = "Okafor household"
        agents[key("teo")]!.detail.householdName = "Okafor household"
        agents[key("ines")]!.detail.goals.insert(GoalPublic(id: newId("g"), kind: "protect_person", description: "Keep Teo breathing until the shuttle", priority: 0.95, source: "personality", status: "active", targetAgentId: key("teo"), targetAgentName: "Teo Okafor", createdAtTick: 0), at: 0)
        agents[key("dmitri")]!.detail.beliefs.insert(BeliefPublic(id: newId("b"), text: "Someone on the ice crew is skimming the reserve.", confidence: 0.7, sourceType: "inference", learnedAtTick: 0), at: 0)

        for line in MockStory.storylines {
            let id = newId("s")
            storylineIds[line.slug] = id
            laterBeats[line.slug] = line.later
            storylines.append(StorylinePublic(id: id, title: line.title, premise: line.premise, status: line.tension >= 0.45 ? "rising" : "brewing", tension: line.tension, participantIds: line.participants.map(key), beats: line.beats.enumerated().map { StoryBeat(tick: Double($0.offset * 4), text: $0.element) }, origin: "seed", createdTick: 0, lastBeatTick: Double((line.beats.count - 1) * 4)))
        }

        society[key("ines")] = ([.init(id: "union", name: "Diggers' Union", kind: "guild", role: "member")], nil, [], nil, [], "a steady hand on the ice crew", "self-taught in drill hydraulics")
        society[key("teo")] = ([.init(id: "choir", name: "The Rust Choir", kind: "troupe", role: "member")], nil, [.init(name: "Pip", species: "cave cricket")], nil, [.init(id: "w2", title: "Under the Blankets", kind: "poem", fame: 0.4)], "everyone's favourite little brother", "studying astronomy at the Observatory school")
        society[key("dmitri")] = ([.init(id: "compact", name: "Founders' Compact", kind: "party", role: "officer")], nil, [], "keeping the Long Dark ledger out of anyone's hands", [], "a respected, slightly feared official", nil)
        society[key("asha")] = ([], .init(partnerId: key("kofi"), partnerName: "Kofi Mbeki", parentIds: [], childIds: []), [.init(name: "Stitches", species: "cat")], nil, [], "the colony's conscience", "a trained trauma surgeon")
        society[key("noor")] = ([.init(id: "league", name: "Free Exchange League", kind: "company", role: "leader")], nil, [], nil, [], "rich, and resented for it", nil)
        society[key("kofi")] = ([.init(id: "union", name: "Diggers' Union", kind: "guild", role: "leader"), .init(id: "choir", name: "The Rust Choir", kind: "troupe", role: "founder")], .init(partnerId: key("asha"), partnerName: "Asha Tanaka", parentIds: [], childIds: []), [], "opening the council's books", [.init(id: "w1", title: "Locked Door Blues", kind: "song", fame: 0.8)], "a hero on the works floor, a menace in the council", nil)
        society[key("marit")] = ([.init(id: "compact", name: "Founders' Compact", kind: "party", role: "leader")], nil, [], nil, [], "the founder's daughter", "schooled on Earth in law")
    }

    // MARK: Publishing

    private func worldPublic() -> WorldPublic {
        let list = all
        var stockpiles: [String: [String: Double]] = ["depot": stock, "hydroponics": ["food": 120], "ice_wells": ["water": 80]]
        stockpiles["depot"]!["credits"] = nil
        return WorldPublic(id: worldId, name: "Shackleton Colony", tick: tick, speed: speed, status: speed == 0 ? "paused" : "running", version: version, population: Population(alive: Double(list.filter { $0.lite.alive }.count), dead: Double(list.filter { !$0.lite.alive }.count)), activeEffects: effects, stockpiles: stockpiles, damage: Dictionary(uniqueKeysWithValues: damage.map { ($0.key.rawValue, $0.value) }), prices: prices, focusWarp: warping)
    }

    private func publicDetail(_ a: Agent) -> AgentDetail {
        var d = a.detail
        d.alive = a.lite.alive
        d.locationId = a.lite.locationId
        d.activityLabel = a.lite.activityLabel
        d.mood = a.lite.mood
        d.health = a.lite.health.rounded()
        d.needs = a.lite.needs
        d.relationships = Array(d.relationships.prefix(8)).map { r in
            var r = r
            r.toAgentAlive = agents[r.toAgentId]?.lite.alive ?? false
            return r
        }
        d.beliefs = Array(d.beliefs.prefix(6))
        d.goals = d.goals.sorted { $0.priority > $1.priority }
        d.persona = personas[a.lite.id]
        d.storylineIds = storylines.filter { $0.participantIds.contains(a.lite.id) }.map(\.id)
        if let soc = society[a.lite.id] {
            d.organizations = soc.orgs
            d.family = soc.family
            d.pets = soc.pets
            d.obsession = soc.obsession
            d.works = soc.works
            d.standingLabel = soc.standing
            d.education = soc.education
        }
        return d
    }

    private func notify() {
        guard let sink else { return }
        sink.received(world: worldPublic())
        sink.received(agents: all.map(\.lite))
        sink.received(events: Array(events.suffix(400)))
        for (id, watchers) in detailWatchers {
            let d = agents[id].map(publicDetail)
            watchers.values.forEach { $0(d) }
        }
        let ranked = storylines.sorted { $0.tension > $1.tension }
        for w in storylineWatchers.values { w.onValue(w.agentId.map { id in ranked.filter { $0.participantIds.contains(id) } } ?? ranked) }
        for (id, watchers) in focusWatchers {
            let state = focusState(id)
            watchers.values.forEach { $0(state) }
        }
    }

    private func focusState(_ id: Id) -> FocusState? {
        guard agents[id] != nil else { return nil }
        return FocusState(agentId: id, thoughts: thoughts[id] ?? [], hooks: hooks[id] ?? [], storylines: storylines.filter { $0.participantIds.contains(id) }.sorted { $0.tension > $1.tension }, warping: warping && focusId == id)
    }

    // MARK: Story

    private func think(_ id: Id, _ text: String) {
        let line = ThoughtLine(id: newId("t"), tick: tick, text: text, mood: agents[id]?.lite.mood, source: "rules")
        thoughts[id] = Array(([line] + (thoughts[id] ?? [])).prefix(30))
    }

    /// A rule-based monologue line for whatever the followed colonist just decided.
    private func thinkAboutNow(_ id: Id) {
        guard let a = agents[id]?.lite, let persona = personas[id] else { return }
        if let last = thoughts[id]?.first, tick - last.tick < 2 { return }
        let partner = agents[a.interactingWithId ?? ""]?.lite.first
        think(id, MockStory.thought(activity: a.activity, label: a.activityLabel, persona: persona, needs: a.needs, partner: partner) { Int(self.rand() * Double($0)) })
    }

    private func offerHook(to id: Id, about other: Id, _ reason: String) {
        guard let o = agents[other]?.lite, o.alive else { return }
        let storyline = storylines.first { $0.participantIds.contains(other) && $0.participantIds.contains(id) } ?? storylines.first { $0.participantIds.contains(other) }
        let hook = StoryHook(agentId: other, name: o.name, reason: reason, storylineId: storyline?.id)
        hooks[id] = Array(([hook] + (hooks[id] ?? []).filter { $0.agentId != other }).prefix(3))
    }

    /// Records a beat of a storyline: an event, a line in the storyline and a rise in tension.
    @discardableResult
    private func storyBeat(_ slug: String, _ summary: String, actor: Id?, participants: [Id], at location: LocationId?, tension: Double, beat: String? = nil) -> WorldEventPublic {
        let sid = storylineIds[slug]
        let i = storylines.firstIndex { $0.id == sid }
        let level = min(1, (i.map { storylines[$0].tension } ?? 0) + tension)
        let event = emit(.social, "story_beat", actor: actor, participants: participants, at: location, summary, salience: 0.45 + level * 0.4, banner: level >= 0.6, storylineId: sid)
        if let i {
            storylines[i].tension = level
            storylines[i].status = level >= 0.75 ? "climax" : level >= 0.45 ? "rising" : "brewing"
            storylines[i].beats = Array((storylines[i].beats + [StoryBeat(tick: tick, text: beat ?? summary, eventId: event.id)]).suffix(12))
            storylines[i].lastBeatTick = tick
        }
        return event
    }

    /// The world moves its storylines on its own: the next authored beat of a random live one.
    private func advanceSomeStoryline() {
        let open = laterBeats.filter { !$0.value.isEmpty }.keys.sorted()
        guard !open.isEmpty else { return }
        let slug = pick(open)
        guard let line = laterBeats[slug]?.removeFirst() else { return }
        let ids = line.participants.compactMap { keyIds[$0] }
        storyBeat(slug, line.text, actor: ids.first, participants: Array(ids.dropFirst()), at: ids.first.flatMap { agents[$0]?.lite.locationId }, tension: line.tension)
        if let focus = focusId, let actor = ids.first, focus != actor, !ids.contains(focus) {
            offerHook(to: focus, about: actor, line.text.replacingOccurrences(of: ".", with: ""))
        }
    }

    /// The starter's authored first hour, one beat per decision.
    private func runScript(_ id: Id) {
        let beat = MockStory.script[scriptIndex]
        scriptIndex += 1
        let me = agents[id]!.lite
        switch beat {
        case let .walk(to, why, thought):
            walk(id, to: to, why: why)
            think(id, thought)
        case let .meet(slug, speech, reply, summary, storyline, tension, thought, hook):
            guard let other = keyIds[slug], agents[other]?.lite.alive == true else { return decide(id) }
            setActivity(id, "talking", "Talking with " + agents[other]!.lite.name, 3)
            setActivity(other, "talking", "Talking with " + me.name, 3)
            agents[id]!.lite.interactingWithId = other
            agents[other]!.lite.interactingWithId = id
            agents[id]!.lite.speech = speech
            agents[other]!.lite.speech = reply
            storyBeat(storyline, summary, actor: id, participants: [other], at: me.locationId, tension: tension)
            think(id, thought)
            if let hook { offerHook(to: id, about: other, hook) }
        case let .act(activity, label, summary, storyline, tension, thought):
            setActivity(id, activity, label, 4)
            storyBeat(storyline, summary, actor: id, participants: [], at: me.locationId, tension: tension)
            think(id, thought)
        }
    }

    private func answer(_ id: Id, _ question: String) -> String {
        let a = agents[id]!
        let persona = personas[id]!
        let q = question.lowercased()
        let key = MockStory.keys.first { keyIds[$0.slug] == id }
        let ties = a.detail.relationships
        func lower(_ s: String) -> String { s.prefix(1).lowercased() + s.dropFirst() }
        if let named = ties.first(where: { q.contains($0.toAgentName.split(separator: " ")[0].lowercased()) }) {
            let first = named.toAgentName.split(separator: " ")[0]
            if !named.toAgentAlive { return "\(first)? Gone. I still set out two cups some mornings." }
            if named.affinity > 0.5 { return "\(first) is the reason I get up. Don't tell them I said that." }
            if named.affinity < -0.2 { return "\(first)? I'd rather not. Let's say I count my rations twice when they're around." }
            return "\(first)? We get along. Up here that's not nothing, but it's not trust either."
        }
        if q.contains("long dark") || q.contains("winter") { return key?.longDark ?? "Everyone lost someone. I lost a bunk-mate and most of my faith in the council." }
        if q.contains("afraid") || q.contains("fear") || q.contains("scare") { return "Honestly? " + persona.fear + ". I don't say it out loud much." }
        if q.contains("want") || q.contains("hope") || q.contains("dream") { return "I want to " + lower(persona.want) + ". Everything else is noise." }
        if q.contains("secret") || q.contains("hiding") || q.contains("lie") { return "Everyone up here hides something. " + persona.flaw + ", if you want my worst. That's all you're getting." }
        if q.contains("trust") || q.contains("friend") || q.contains("love") {
            guard let best = ties.filter({ $0.toAgentAlive }).max(by: { $0.trust < $1.trust }) else { return "Trust is a luxury good. I can't afford it this week." }
            return best.toAgentName + ". If I had to hand someone my last litre, it'd be them."
        }
        if q.contains("hate") || q.contains("enemy") || q.contains("blame") {
            guard let worst = ties.min(by: { $0.affinity < $1.affinity }), worst.affinity < 0 else { return "Hate takes energy. I need mine for the shift." }
            return worst.toAgentName + ". Ask me again after I've had a drink."
        }
        if q.contains("why") || q.contains("doing") || q.contains("where") { return a.lite.activityLabel + ". " + (a.detail.plan?.intent ?? persona.arc.note) }
        return [persona.arc.note + " That's what keeps me up.", "You ask a lot of questions for someone I can't see. Fine. " + persona.arc.note, "Short answer: I want to " + lower(persona.want) + ". Long answer needs a drink."][Int(rand() * 3)]
    }

    // MARK: Behaviour

    private func setActivity(_ id: Id, _ activity: String, _ label: String, _ duration: Double) {
        agents[id]!.lite.activity = activity
        agents[id]!.lite.activityLabel = label
        agents[id]!.lite.busyUntilTick = tick + max(1, duration.rounded())
        agents[id]!.lite.move = nil
        agents[id]!.lite.interactingWithId = nil
        agents[id]!.lite.speech = nil
        touch(id)
    }

    private func walk(_ id: Id, to: LocationId, why: String) {
        let from = agents[id]!.lite.locationId
        let ticks = max(1, findPath(from, to)?.ticks ?? 2)
        agents[id]!.lite.move = Move(from: from, to: to, departTick: tick, arriveTick: tick + ticks)
        agents[id]!.lite.locationId = to
        agents[id]!.lite.activity = "walking"
        agents[id]!.lite.activityLabel = "Walking to " + to.name + " " + why
        agents[id]!.lite.busyUntilTick = tick + ticks
        agents[id]!.lite.interactingWithId = nil
        agents[id]!.lite.speech = nil
        touch(id)
    }

    private var drought: ActiveEffect? { effects.first { $0.type == "drought" } }
    private func stormAt(_ loc: LocationId) -> Bool {
        effects.contains { $0.type == "storm" && ($0.locationIds.isEmpty ? loc.def.exposed : $0.locationIds.contains(loc)) }
    }

    private func decide(_ id: Id) {
        if id == keyIds[MockStory.starter], scriptIndex < MockStory.script.count, !stormAt(agents[id]!.lite.locationId) { return runScript(id) }
        choose(id)
        if id == focusId { thinkAboutNow(id) }
    }

    private func choose(_ id: Id) {
        guard let a = agents[id] else { return }
        let h = hour()
        if stormAt(a.lite.locationId) && a.lite.activity != "fleeing" {
            agents[id]!.lite.mood = "afraid"
            agents[id]!.lite.needs.safety = clamp(a.lite.needs.safety + 40)
            walk(id, to: .plaza, why: "to shelter from the storm")
            agents[id]!.lite.activity = "fleeing"
            agents[id]!.lite.activityLabel = "Fleeing the storm for the Commons Plaza"
            return
        }
        let night = h >= 22 || h < 6
        let target: LocationId
        let act: () -> Void
        if night || a.lite.needs.fatigue > 85 {
            target = a.detail.homeLocationId
            act = { self.setActivity(id, "sleeping", "Sleeping in their bunk", night ? Double((30 - h) % 24) * Clock.ticksPerHour + (self.rand() * 4).rounded(.down) : 18) }
        } else if a.lite.needs.thirst > 62 {
            target = .canteen
            act = {
                let dry = (self.stock["water"] ?? 0) <= 0
                if !dry { self.stock["water"]! -= 1 }
                self.agents[id]!.lite.needs.thirst = self.clamp(self.agents[id]!.lite.needs.thirst - (dry ? 5 : 55))
                self.setActivity(id, "drinking", dry ? "Looking for water at the canteen. The taps are dry." : "Drinking at the canteen", 2)
            }
        } else if a.lite.needs.hunger > 62 || h == 12 {
            target = .canteen
            act = {
                if (self.stock["food"] ?? 0) > 0 { self.stock["food"]! -= 1 }
                self.agents[id]!.lite.needs.hunger = self.clamp(self.agents[id]!.lite.needs.hunger - 50)
                self.setActivity(id, "eating", "Eating at the canteen", 3)
            }
        } else if (h >= 7 && h < 12) || (h >= 13 && h < 18) {
            let work = a.detail.workLocationId ?? .plaza
            target = work
            act = {
                self.setActivity(id, "working", (Self.workVerb[a.lite.occupation] ?? "Working") + " at " + work.name, 5 + self.rand() * 6)
                self.agents[id]!.detail.inventory["credits", default: 0] += 3
                if let produces = work.def.produces { self.stock[produces, default: 0] += produces == "water" && self.drought != nil ? 0.3 : 2 }
                if let d = self.damage[work] {
                    let left = max(0, d - 0.04)
                    if left <= 0.02 {
                        self.damage[work] = nil
                        self.emit(.action, "repair", actor: id, at: work, a.lite.name + " and the crew finished repairs at " + work.name + ".", salience: 0.45)
                    } else {
                        self.damage[work] = left
                    }
                }
            }
        } else {
            target = pick([.plaza, .canteen, .market, a.detail.homeLocationId])
            act = { self.socialise(id) }
        }
        if a.lite.locationId != target {
            walk(id, to: target, why: target == a.detail.homeLocationId ? "to rest" : target == .canteen ? "for a meal" : target == a.detail.workLocationId ? "for the shift" : "to see who is around")
        } else {
            act()
        }
    }

    private func socialise(_ id: Id) {
        let a = agents[id]!
        let here = all.filter { $0.lite.alive && $0.lite.id != id && $0.lite.locationId == a.lite.locationId && $0.lite.move == nil && $0.lite.activity != "sleeping" && $0.lite.activity != "talking" }
        let roll = rand()
        if here.isEmpty || roll < 0.15 {
            let home = a.lite.locationId == a.detail.homeLocationId
            return setActivity(id, home ? "resting" : "idle", home ? "Resting at home" : "Watching the crowd at " + a.lite.locationId.name, 3 + rand() * 4)
        }
        let b = pick(here).lite
        let scarce = (stock["water"] ?? 0) < 150 || (stock["food"] ?? 0) < 150
        if a.lite.locationId == .market && roll < 0.45 {
            let res = pick(["food", "water", "parts", "medicine"])
            let qty = 1 + (rand() * 3).rounded(.down)
            let cost = qty * (prices[res] ?? 1)
            setActivity(id, "trading", "Buying \(Int(qty)) \(res) from \(b.name)", 2)
            setActivity(b.id, "trading", "Selling \(Int(qty)) \(res) to \(a.lite.name)", 2)
            agents[id]!.lite.interactingWithId = b.id
            agents[b.id]!.lite.interactingWithId = id
            agents[id]!.detail.inventory[res, default: 0] += qty
            agents[id]!.detail.inventory["credits"] = max(0, (agents[id]!.detail.inventory["credits"] ?? 0) - cost)
            agents[b.id]!.detail.inventory["credits", default: 0] += cost
            emit(.economy, "trade", actor: id, participants: [b.id], at: a.lite.locationId, "\(a.lite.name) bought \(Int(qty)) \(res) from \(b.name) for \(Int(cost)) credits.", salience: 0.22, visibility: "local")
            return
        }
        if scarce && (a.detail.traits["caution"] ?? 1) < 0.35 && roll > 0.9 {
            let res = (stock["water"] ?? 0) < (stock["food"] ?? 0) ? "water" : "food"
            let cause = events.last { $0.eventType == "price_change" || $0.eventType == "drought" }
            setActivity(id, "stealing", "Slipping \(res) out of the Supply Depot", 2)
            stock[res] = max(0, (stock[res] ?? 0) - 6)
            agents[id]!.detail.inventory[res, default: 0] += 6
            let theft = emit(.social, "theft", actor: id, participants: [b.id], at: .depot, "\(a.lite.name) stole 6 \(res) from the Supply Depot. \(b.name) saw it happen.", salience: 0.78, cause: cause?.id)
            agents[b.id]!.detail.beliefs.insert(BeliefPublic(id: newId("b"), text: "\(a.lite.name) stole \(res) from the Supply Depot.", subjectAgentId: id, subjectAgentName: a.lite.name, confidence: 0.9, sourceType: "observed", learnedAtTick: tick), at: 0)
            agents[b.id]!.detail.lastThought = ThoughtPublic(tick: tick, trigger: "witnessed a theft", intent: "Decide whether to report \(a.lite.name) to security.", source: "rules")
            emit(.social, "suspicion", actor: b.id, participants: [id], at: a.lite.locationId, "\(b.name) now distrusts \(a.lite.name).", salience: 0.4, cause: theft.id, visibility: "local")
            touch(b.id)
            return
        }
        if roll > 0.8 && (a.detail.inventory["food"] ?? 0) > 3 && (a.detail.traits["empathy"] ?? 0) > 0.5 {
            setActivity(id, "giving", "Sharing rations with \(b.name)", 2)
            agents[id]!.lite.interactingWithId = b.id
            agents[id]!.detail.inventory["food", default: 0] -= 2
            agents[b.id]!.detail.inventory["food", default: 0] += 2
            emit(.social, "gift", actor: id, participants: [b.id], at: a.lite.locationId, "\(a.lite.name) gave 2 food to \(b.name).", salience: 0.35, visibility: "local")
            return
        }
        if id == focusId, personas[b.id]?.key == true || storylines.contains(where: { $0.participantIds.contains(b.id) }) {
            offerHook(to: id, about: b.id, "\(a.lite.first) just talked with \(personas[b.id]?.epithet ?? b.name)")
        }
        setActivity(id, "talking", "Talking with \(b.name)", 2 + rand() * 2)
        setActivity(b.id, "talking", "Talking with \(a.lite.name)", agents[id]!.lite.busyUntilTick - tick)
        agents[id]!.lite.interactingWithId = b.id
        agents[b.id]!.lite.interactingWithId = id
        agents[id]!.lite.speech = pick(Self.talk)
        agents[id]!.lite.needs.social = clamp(a.lite.needs.social - 30)
        agents[b.id]!.lite.needs.social = clamp(agents[b.id]!.lite.needs.social - 30)
        let bBeliefs = agents[b.id]!.detail.beliefs
        if let rumor = a.detail.beliefs.first(where: { bel in bel.sourceType == "rumor" && !bBeliefs.contains { $0.text == bel.text } }), rand() < 0.7 {
            var heard = rumor
            heard.id = newId("b")
            heard.confidence = max(0.2, rumor.confidence - 0.15)
            heard.sourceAgentName = a.lite.name
            heard.learnedAtTick = tick
            agents[b.id]!.detail.beliefs.insert(heard, at: 0)
            agents[id]!.lite.speech = "They say " + rumor.text.prefix(1).lowercased() + rumor.text.dropFirst()
            let origin = events.last { $0.eventType == "rumor_started" && $0.summary.contains(rumor.subjectAgentName ?? "~") }
            emit(.social, "rumor_spread", actor: id, participants: [b.id] + [rumor.subjectAgentId].compactMap { $0 }, at: a.lite.locationId, "\(a.lite.name) told \(b.name): \"\(rumor.text)\"", salience: 0.5, cause: origin?.id, visibility: "local")
            if let i = agents[b.id]!.detail.relationships.firstIndex(where: { $0.toAgentId == rumor.subjectAgentId }) {
                agents[b.id]!.detail.relationships[i].affinity = clamp(agents[b.id]!.detail.relationships[i].affinity - 0.2, -1, 1)
            }
        } else if rand() < 0.25 {
            emit(.social, "conversation", actor: id, participants: [b.id], at: a.lite.locationId, "\(a.lite.name) and \(b.name) talked at \(a.lite.locationId.name).", salience: 0.15, visibility: "local")
        }
    }

    private func stepTick() {
        tick += 1
        version += 1
        for effect in effects.filter({ tick >= $0.endTick }) {
            effects.removeAll { $0.id == effect.id }
            emit(.environment, effect.type + "_ended", at: effect.locationIds.first, effect.type == "drought" ? "The ice wells are flowing again." : "The storm has passed.", salience: 0.55)
        }
        let dry = drought
        if let dry { stock["water"] = max(0, (stock["water"] ?? 0) - 2.2 * dry.severity) }
        if Int(tick) % 6 == 0 {
            let waterPrice = max(3, (5 + (540 - (stock["water"] ?? 0)) / 45).rounded())
            let foodPrice = max(3, (4 + (620 - (stock["food"] ?? 0)) / 70).rounded())
            if waterPrice != prices["water"] || foodPrice != prices["food"] {
                let rose = waterPrice > prices["water"]! || foodPrice > prices["food"]!
                let big = abs(waterPrice - prices["water"]!) + abs(foodPrice - prices["food"]!) >= 2
                prices["water"] = waterPrice
                prices["food"] = foodPrice
                if big {
                    emit(.economy, "price_change", at: .market, "Prices at the Exchange \(rose ? "rose" : "fell"): water \(Int(waterPrice)) cr, food \(Int(foodPrice)) cr.", salience: rose ? 0.62 : 0.4, cause: dry != nil ? events.last { $0.eventType == "drought" }?.id : nil)
                }
            }
        }
        for id in order {
            guard var a = agents[id]?.lite, a.alive else { continue }
            let asleep = a.activity == "sleeping"
            a.needs.hunger = clamp(a.needs.hunger + 0.45)
            a.needs.thirst = clamp(a.needs.thirst + (dry != nil ? 0.9 : 0.6))
            a.needs.fatigue = clamp(a.needs.fatigue + (asleep ? -2.2 : 0.4))
            a.needs.social = clamp(a.needs.social + 0.25)
            a.needs.safety = clamp(a.needs.safety - 0.5)
            if a.needs.thirst > 95 || a.needs.hunger > 95 { a.health = clamp(a.health - 0.6) }
            agents[id]!.lite = a
            if Int(tick) % 12 == 0 { touch(id) }
            if tick >= a.busyUntilTick { decide(id) }
        }
        if Int(tick) % 9 == 0 { advanceSomeStoryline() }
        let routine = focusId.flatMap { agents[$0]?.lite.activity }.map { $0 == "sleeping" || $0 == "resting" || $0 == "working" } ?? false
        if routine != warping {
            warping = routine
            schedule()
        }
    }

    private func schedule() {
        timer?.invalidate()
        timer = nil
        guard speed > 0 else { return }
        timer = Timer.scheduledTimer(withTimeInterval: Clock.secondsPerTick / speed / (warping ? 6 : 1), repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.stepTick()
                self?.notify()
            }
        }
    }

    // MARK: Powers

    private func applyNow(_ iv: Intervention) -> InterventionResult {
        version += 1
        func fail(_ m: String) -> InterventionResult { InterventionResult(ok: false, message: m) }
        func living(_ id: Id) -> Agent? { agents[id].flatMap { $0.lite.alive ? $0 : nil } }
        switch iv {
        case let .drought(severity, days):
            guard severity > 0, severity <= 1, days >= 1, days <= 10 else { return fail("Severity must be 0..1 and duration 1..10 sols.") }
            effects.append(ActiveEffect(id: newId("fx"), type: "drought", locationIds: [], severity: severity, startTick: tick, endTick: tick + days * Clock.ticksPerDay, label: "Drought \(Int(severity * 100))%"))
            emit(.intervention, "drought", at: .ice_wells, "The ice wells are running dry. Water output has fallen by \(Int(severity * 100))% for \(Int(days)) sols.", salience: 0.95)
            let miners = all.filter { $0.lite.alive && $0.lite.occupation == "ice_miner" }.map(\.lite.id)
            for m in miners {
                agents[m]!.lite.mood = "worried"
                agents[m]!.detail.lastThought = ThoughtPublic(tick: tick, trigger: "the drills came up dry", intent: "Find out why the wells failed and protect the household water.", source: "rules")
                touch(m)
            }
            return InterventionResult(ok: true, affectedAgentIds: miners)
        case let .storm(severity, picked):
            let ids = picked.isEmpty ? LocationId.allCases.filter { $0.def.exposed } : picked
            effects.append(ActiveEffect(id: newId("fx"), type: "storm", locationIds: ids, severity: severity, startTick: tick, endTick: tick + 6 + (severity * 12).rounded(), label: "Storm"))
            let e = emit(.intervention, "storm", at: ids.first, "A meteor storm is hitting " + ids.map(\.name).joined(separator: ", ") + ".", salience: 0.95)
            for id in ids {
                damage[id] = min(1, (damage[id] ?? 0) + 0.3 + severity * 0.6)
                emit(.environment, "damage", at: id, id.name + " was damaged by the storm.", salience: 0.6, cause: e.id, banner: false)
            }
            var hit: [Id] = []
            for a in all where a.lite.alive && ids.contains(a.lite.locationId) {
                hit.append(a.lite.id)
                agents[a.lite.id]!.lite.health = clamp(a.lite.health - severity * 25 * rand())
                agents[a.lite.id]!.lite.busyUntilTick = tick
                decide(a.lite.id)
            }
            return InterventionResult(ok: true, affectedAgentIds: hit)
        case let .grant(agentId, resource, amount):
            guard let a = living(agentId) else { return fail("That colonist is no longer alive.") }
            guard amount > 0, amount <= 500 else { return fail("Amount must be between 1 and 500.") }
            agents[agentId]!.detail.inventory[resource.rawValue, default: 0] += amount
            agents[agentId]!.lite.mood = "astonished"
            agents[agentId]!.detail.lastThought = ThoughtPublic(tick: tick, trigger: "found \(Int(amount)) \(resource.rawValue) in their locker", intent: "Work out where it came from, and what to do with it.", source: "rules")
            touch(agentId)
            emit(.intervention, "grant", actor: agentId, at: a.lite.locationId, "\(a.lite.name) found \(Int(amount)) \(resource.rawValue) that nobody can account for.", salience: 0.7)
            return InterventionResult(ok: true, affectedAgentIds: [agentId])
        case let .kill(agentId, cause):
            guard let a = living(agentId) else { return fail("That colonist is already dead.") }
            agents[agentId]!.lite.alive = false
            agents[agentId]!.lite.health = 0
            agents[agentId]!.lite.move = nil
            agents[agentId]!.lite.activity = "dead"
            agents[agentId]!.lite.activityLabel = "Dead: " + cause
            agents[agentId]!.lite.speech = nil
            agents[agentId]!.lite.interactingWithId = nil
            agents[agentId]!.detail.death = Death(tick: tick, cause: cause)
            agents[agentId]!.detail.plan = nil
            touch(agentId)
            let e = emit(.intervention, "death", actor: agentId, at: a.lite.locationId, "\(a.lite.name) died at \(a.lite.locationId.name) (\(cause)).", salience: 1)
            let mourners = all.filter { $0.lite.alive && $0.detail.relationships.contains { $0.toAgentId == agentId && $0.affinity > 0.3 } }.prefix(6).map(\.lite.id)
            for m in mourners {
                agents[m]!.lite.mood = "grieving"
                setActivity(m, "mourning", "Mourning " + a.lite.name, 6 + rand() * 6)
                agents[m]!.detail.lastThought = ThoughtPublic(tick: tick, trigger: a.lite.name + " died", intent: "Grieve, then find out what really happened.", source: "rules")
                emit(.social, "grief", actor: m, participants: [agentId], at: agents[m]!.lite.locationId, "\(agents[m]!.lite.name) is mourning \(a.lite.name).", salience: 0.5, cause: e.id, visibility: "local")
            }
            return InterventionResult(ok: true, affectedAgentIds: [agentId] + mourners)
        case let .whisper(agentId, _, text, strength, aboutId):
            guard let a = living(agentId) else { return fail("That colonist is no longer alive.") }
            guard text.trimmingCharacters(in: .whitespaces).count >= 3 else { return fail("The whisper needs some words.") }
            let about = aboutId.flatMap { agents[$0]?.lite }
            agents[agentId]!.detail.beliefs.insert(BeliefPublic(id: newId("b"), text: text, subjectAgentId: about?.id, subjectAgentName: about?.name, confidence: min(1, 0.3 + strength * 0.6), sourceType: "divine", learnedAtTick: tick), at: 0)
            agents[agentId]!.detail.lastThought = ThoughtPublic(tick: tick, trigger: "a thought arrived from nowhere", intent: "Act on the idea: \"\(text)\"", source: "llm")
            agents[agentId]!.detail.goals.insert(GoalPublic(id: newId("g"), kind: about != nil ? "investigate" : "custom", description: text, priority: 0.5 + strength * 0.45, source: "divine", status: "active", targetAgentId: about?.id, targetAgentName: about?.name, createdAtTick: tick), at: 0)
            agents[agentId]!.lite.mood = "unsettled"
            touch(agentId)
            emit(.intervention, "whisper", actor: agentId, participants: [about?.id].compactMap { $0 }, at: a.lite.locationId, "A voice whispered to \(a.lite.name): \"\(text)\"", salience: 0.6, visibility: "private", banner: false)
            return InterventionResult(ok: true, affectedAgentIds: [agentId])
        case let .rumor(aboutId, presetKey, text, seed):
            guard let subject = agents[aboutId]?.lite else { return fail("That colonist no longer exists.") }
            guard text.trimmingCharacters(in: .whitespaces).count >= 3 else { return fail("The rumor needs some words.") }
            let where_ = seed ?? .canteen
            let pool = all.filter { $0.lite.alive && $0.lite.id != aboutId && $0.lite.locationId == where_ }
            let hearers = (pool.count >= 3 ? pool : all.filter { $0.lite.alive && $0.lite.id != aboutId }).shuffled().prefix(3).map(\.lite.id)
            for h in hearers {
                agents[h]!.detail.beliefs.insert(BeliefPublic(id: newId("b"), text: text, subjectAgentId: aboutId, subjectAgentName: subject.name, confidence: 0.55, sourceType: "rumor", learnedAtTick: tick), at: 0)
                agents[h]!.rumorKeys.insert(presetKey)
                touch(h)
            }
            emit(.intervention, "rumor_started", participants: [aboutId] + hearers, at: where_, "A rumor is going round \(where_.name) about \(subject.name): \"\(text)\"", salience: 0.72)
            return InterventionResult(ok: true, affectedAgentIds: hearers)
        case let .createCharacter(p):
            let name = p.name.trimmingCharacters(in: .whitespaces)
            guard name.count >= 2, name.count <= 40 else { return fail("The name must be 2 to 40 characters.") }
            guard agents.count < 120 else { return fail("The colony is full (120 colonists).") }
            let id = makeAgent(name: name, spriteId: p.spriteId, occupation: p.occupation, home: p.home, ageBand: p.ageBand, traits: p.traits, values: p.values, background: p.backstory, location: .landing_pad)
            agents[id]!.detail.inventory["credits"] = p.credits
            agents[id]!.detail.inventory["food"] = p.food
            if !p.goal.isEmpty {
                agents[id]!.detail.goals.insert(GoalPublic(id: newId("g"), kind: "custom", description: p.goal, priority: 0.8, source: "divine", status: "active", createdAtTick: tick), at: 0)
            }
            walk(id, to: p.home, why: "to find their bunk")
            emit(.intervention, "arrival", actor: id, at: .landing_pad, "\(name) stepped off a shuttle at the Landing Pad, a new \(occupation(p.occupation).label.lowercased()).", salience: 0.8)
            return InterventionResult(ok: true, affectedAgentIds: [id], createdAgentId: id)
        }
    }

    // MARK: WorldSource

    func start(deviceId: String, sink: SourceSink) async throws {
        self.sink = sink
        schedule()
        notify()
    }
    func heartbeat() async {}
    func setFocus(_ agentId: Id?) async {
        focusId = agentId
        warping = false
        if let agentId, thoughts[agentId] == nil, let a = agents[agentId] {
            think(agentId, personas[agentId].map { "\(a.lite.activityLabel). And underneath it, always: \($0.fear.prefix(1).lowercased() + $0.fear.dropFirst())." } ?? a.lite.activityLabel)
        }
        schedule()
        notify()
    }
    func setSpeed(_ next: Double) async throws {
        speed = next
        version += 1
        schedule()
        notify()
    }
    func skipToNotable(agentId: Id?) async throws -> (advancedTicks: Double, eventId: Id?) {
        let startCount = events.count
        var advanced = 0.0
        var found: WorldEventPublic?
        while advanced < 36 && found == nil {
            stepTick()
            advanced += 1
            found = events.suffix(from: min(startCount, events.count)).first { e in
                e.salience >= 0.6 || (agentId != nil && e.salience >= 0.3 && (e.actorId == agentId || e.participantIds.contains(agentId!)))
            }
        }
        notify()
        schedule()
        return (advanced, found?.id)
    }
    func watchDetail(_ agentId: Id, _ onDetail: @escaping (AgentDetail?) -> Void) -> () -> Void {
        let key = UUID()
        detailWatchers[agentId, default: [:]][key] = onDetail
        onDetail(agents[agentId].map(publicDetail))
        return { [weak self] in self?.detailWatchers[agentId]?[key] = nil }
    }
    func chain(_ eventId: Id) async throws -> [WorldEventPublic] {
        let byId = Dictionary(events.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var chain: [WorldEventPublic] = []
        var cursor = byId[eventId]
        while let c = cursor {
            chain.insert(c, at: 0)
            cursor = c.causationEventId.flatMap { byId[$0] }
        }
        return chain + events.filter { $0.causationEventId == eventId }
    }
    func apply(_ intervention: Intervention, commandId: String) async throws -> InterventionResult {
        if let prior = commands[commandId] { return prior }
        try await Task.sleep(for: .milliseconds(250))
        let result = applyNow(intervention)
        commands[commandId] = result
        notify()
        return result
    }
    func intro() async -> StoryIntro? {
        let story = MockStory.intro
        let cards = MockStory.keys.compactMap { k in keyIds[k.slug].map { KeyCharacterCard(agentId: $0, name: k.name, spriteId: k.spriteId, epithet: k.persona.epithet, hook: k.hook, factionId: k.factionId) } }
        return StoryIntro(title: story.title, setting: story.setting, history: story.history, tensions: story.tensions, keyCharacters: cards, starterAgentId: keyIds[MockStory.starter]!, tutorial: MockStory.tutorial(keyIds))
    }

    func watchStorylines(agentId: Id?, _ onValue: @escaping ([StorylinePublic]) -> Void) -> () -> Void {
        let key = UUID()
        storylineWatchers[key] = (agentId, onValue)
        let ranked = storylines.sorted { $0.tension > $1.tension }
        onValue(agentId.map { id in ranked.filter { $0.participantIds.contains(id) } } ?? ranked)
        return { [weak self] in self?.storylineWatchers[key] = nil }
    }

    func watchFocus(_ agentId: Id, _ onValue: @escaping (FocusState?) -> Void) -> () -> Void {
        let key = UUID()
        focusWatchers[agentId, default: [:]][key] = onValue
        onValue(focusState(agentId))
        return { [weak self] in self?.focusWatchers[agentId]?[key] = nil }
    }

    func watchConversation(_ agentId: Id, _ onValue: @escaping ([AskTurn]) -> Void) -> () -> Void {
        let key = UUID()
        conversationWatchers[agentId, default: [:]][key] = onValue
        onValue(conversations[agentId] ?? [])
        return { [weak self] in self?.conversationWatchers[agentId]?[key] = nil }
    }

    func ask(_ agentId: Id, question: String) async throws -> AskResult {
        guard let a = agents[agentId] else { return .refused(code: "not_found", message: "Nobody by that name lives here.") }
        guard a.lite.alive else { return .refused(code: "dead", message: "\(a.lite.first) can no longer answer.") }
        try await Task.sleep(for: .milliseconds(900))
        let turn = AskTurn(id: newId("q"), tick: tick, question: question, answer: answer(agentId, question))
        conversations[agentId, default: []].append(turn)
        conversationWatchers[agentId]?.values.forEach { $0(conversations[agentId] ?? []) }
        return .answered(turn)
    }

    func society() async -> SocietyOverview? {
        func key(_ slug: String) -> Id { keyIds[slug]! }
        func members(_ faction: String) -> [Id] { all.filter { $0.factionId == faction }.map(\.lite.id) }
        let choir = [key("kofi"), key("teo")] + members("union").suffix(4)
        return SocietyOverview(
            organizations: [
                OrganizationPublic(id: "compact", name: "Founders' Compact", kind: "party", creed: "The colony survives because someone is allowed to say no.", leaderId: key("marit"), memberIds: members("compact"), foundedTick: -2_700, status: "active", rivalIds: ["union"]),
                OrganizationPublic(id: "union", name: "Diggers' Union", kind: "guild", creed: "Those who dig the ice decide who drinks it.", leaderId: key("kofi"), memberIds: members("union"), foundedTick: -1_000, status: "active", rivalIds: ["compact"]),
                OrganizationPublic(id: "league", name: "Free Exchange League", kind: "company", creed: "A shuttle comes for whoever can pay it.", leaderId: key("noor"), memberIds: members("league"), foundedTick: -950, status: "active", rivalIds: []),
                OrganizationPublic(id: "choir", name: "The Rust Choir", kind: "troupe", creed: "Sing the names of the eleven until the council says them too.", leaderId: key("kofi"), memberIds: choir, foundedTick: -400, status: "active", rivalIds: []),
            ],
            discoveries: [
                DiscoveryPublic(key: "regolith_bricks", name: "Sintered regolith bricks", effect: "Domes can be extended without parts from Earth.", tick: -2_000, discovererIds: [key("kofi")]),
                DiscoveryPublic(key: "cold_trap", name: "Cold-trap ice harvesting", effect: "The ice wells yield a third more in the dark season.", tick: -600, discovererIds: [key("ines")]),
                DiscoveryPublic(key: "algae_paste", name: "Spirulina paste", effect: "Hydroponics can feed twice the people, if nobody minds the taste.", tick: -150, discovererIds: [key("asha")]),
            ],
            structures: [
                StructurePublic(id: "st1", key: "memorial", name: "The Long Dark Memorial", locationId: .plaza, builderIds: [key("kofi"), key("teo")], progress: 1, builtTick: -300),
                StructurePublic(id: "st2", key: "still", name: "A water still behind the Exchange", locationId: .market, builderIds: [key("noor")], progress: 0.6, builtTick: nil),
            ],
            works: [
                WorkPublic(id: "w1", title: "Locked Door Blues", kind: "song", creatorId: key("kofi"), creatorName: "Kofi Mbeki", fame: 0.8, createdTick: -500, about: "The reserve the council kept locked while eleven people froze."),
                WorkPublic(id: "w2", title: "Under the Blankets", kind: "poem", creatorId: key("teo"), creatorName: "Teo Okafor", fame: 0.4, createdTick: -90, about: "A child's game that was really about heat."),
            ],
            notables: [
                Notable(agentId: key("kofi"), name: "Kofi Mbeki", known: "the man who wrote Locked Door Blues"),
                Notable(agentId: key("marit"), name: "Marit Lindqvist", known: "the founder's daughter who runs the council"),
                Notable(agentId: key("asha"), name: "Asha Tanaka", known: "the medic who stayed when the shuttles stopped"),
            ])
    }

    func checkoutURL() async throws -> URL {
        throw SourceError.unsupported("Checkout needs the live backend. Switch the data source in the menu.")
    }
    func stop() {
        timer?.invalidate()
        timer = nil
        detailWatchers = [:]
        storylineWatchers = [:]
        focusWatchers = [:]
        conversationWatchers = [:]
    }
}

enum SourceError: LocalizedError {
    case unsupported(String)
    var errorDescription: String? {
        switch self { case let .unsupported(m): m }
    }
}

/// mulberry32, the same generator the TypeScript mock uses.
struct Mulberry32 {
    private var state: UInt32
    init(seed: UInt32) { state = seed }
    mutating func next() -> Double {
        state = state &+ 0x6D2B_79F5
        var t = state
        t = (t ^ (t >> 15)) &* (t | 1)
        t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
        return Double(t ^ (t >> 14)) / 4_294_967_296
    }
}
