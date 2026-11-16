import CoreGraphics
import Foundation

// Swift mirror of mobile/shared/colony.ts, mobile/shared/types.ts and mobile/shared/mapLayout.ts.
// The Convex backend and the TypeScript contract stay the source of truth; change both together.
// Every number is a Double because the backend stores float64 and rejects Convex int64 arguments.

typealias Id = String

// MARK: - Time

enum Clock {
    static let tickMinutes = 10.0
    static let ticksPerHour = 6.0
    static let ticksPerDay = 144.0
    static let startHour = 6.0
    /// Real seconds per tick at 1x speed.
    static let secondsPerTick = 3.333
    static let speeds: [Double] = [0, 1, 4, 8]

    static func parts(_ tick: Double) -> (sol: Int, hour: Int, minute: Int) {
        let total = Int(tick) * 10 + 6 * 60
        return (total / 1440 + 1, (total % 1440) / 60, total % 60)
    }
    /// "Sol 3 · 15:30"
    static func stamp(_ tick: Double) -> String {
        let p = parts(tick)
        return "Sol \(p.sol) · " + time(tick)
    }
    static func time(_ tick: Double) -> String {
        let p = parts(tick)
        return String(format: "%02d:%02d", p.hour, p.minute)
    }
}

// MARK: - Places

enum LocationId: String, Codable, CaseIterable, Identifiable {
    case plaza, market, canteen, hydroponics, depot, workshop, medbay
    case habitat_a, habitat_b, ice_wells, quarry, solar_farm, observatory, landing_pad
    var id: String { rawValue }
}

struct LocationDef {
    let name: String
    let exposed: Bool
    let produces: String?
    let description: String
}

let LOCATIONS: [LocationId: LocationDef] = [
    .plaza: .init(name: "Commons Plaza", exposed: false, produces: nil, description: "Central dome with the council chamber and the public notice board."),
    .market: .init(name: "Exchange Concourse", exposed: false, produces: nil, description: "Trading stalls where food, water, parts and medicine change hands for credits."),
    .canteen: .init(name: "The Airlock Canteen", exposed: false, produces: nil, description: "Mess hall and bar. Where the colony eats, drinks and gossips."),
    .hydroponics: .init(name: "Hydroponics Bays", exposed: false, produces: "food", description: "Grow racks that turn water and light into food."),
    .depot: .init(name: "Supply Depot", exposed: false, produces: nil, description: "The colony reserve of food, water and parts, run by the quartermaster."),
    .workshop: .init(name: "Fabrication Works", exposed: false, produces: "parts", description: "Printers and forges that turn regolith into parts."),
    .medbay: .init(name: "Med Bay", exposed: false, produces: "medicine", description: "Clinic and pharmacy."),
    .habitat_a: .init(name: "Habitat Ring A", exposed: false, produces: nil, description: "Older family quarters near the farms."),
    .habitat_b: .init(name: "Habitat Ring B", exposed: false, produces: nil, description: "Newer bunk blocks near the works."),
    .ice_wells: .init(name: "Ice Wells", exposed: true, produces: "water", description: "Drill site in the permanently shadowed crater. The only source of water."),
    .quarry: .init(name: "Regolith Quarry", exposed: true, produces: nil, description: "Open-pit regolith dig that feeds the Fabrication Works."),
    .solar_farm: .init(name: "Solar Farm", exposed: true, produces: nil, description: "Panel field on the crater rim that powers the colony."),
    .observatory: .init(name: "Observatory Lab", exposed: false, produces: nil, description: "Research dome and telescope."),
    .landing_pad: .init(name: "Landing Pad", exposed: true, produces: nil, description: "Where shuttles land. New arrivals and off-world cargo come through here."),
]

extension LocationId {
    var def: LocationDef { LOCATIONS[self]! }
    var name: String { def.name }
}

struct Route { let a: LocationId; let b: LocationId; let ticks: Double }

let ROUTES: [Route] = [
    .init(a: .plaza, b: .observatory, ticks: 1), .init(a: .plaza, b: .canteen, ticks: 1), .init(a: .plaza, b: .market, ticks: 1),
    .init(a: .plaza, b: .depot, ticks: 1), .init(a: .observatory, b: .solar_farm, ticks: 1), .init(a: .observatory, b: .landing_pad, ticks: 1),
    .init(a: .market, b: .landing_pad, ticks: 1), .init(a: .canteen, b: .solar_farm, ticks: 1), .init(a: .canteen, b: .hydroponics, ticks: 1),
    .init(a: .market, b: .workshop, ticks: 1), .init(a: .depot, b: .hydroponics, ticks: 1), .init(a: .depot, b: .workshop, ticks: 1),
    .init(a: .depot, b: .medbay, ticks: 1), .init(a: .medbay, b: .habitat_a, ticks: 1), .init(a: .medbay, b: .habitat_b, ticks: 1),
    .init(a: .hydroponics, b: .habitat_a, ticks: 1), .init(a: .workshop, b: .habitat_b, ticks: 1), .init(a: .habitat_a, b: .ice_wells, ticks: 1),
    .init(a: .habitat_b, b: .quarry, ticks: 1), .init(a: .ice_wells, b: .quarry, ticks: 2),
]

/// Shortest path by travel ticks. Ties resolve by LocationId order, like the TypeScript version.
func findPath(_ from: LocationId, _ to: LocationId) -> (nodes: [LocationId], ticks: Double)? {
    if from == to { return ([from], 0) }
    var dist: [LocationId: Double] = [from: 0]
    var prev: [LocationId: LocationId] = [:]
    var done: Set<LocationId> = []
    while true {
        guard let current = LocationId.allCases.filter({ dist[$0] != nil && !done.contains($0) }).min(by: { dist[$0]! < dist[$1]! }) else { return nil }
        if current == to { break }
        done.insert(current)
        for route in ROUTES where route.a == current || route.b == current {
            let next = route.a == current ? route.b : route.a
            let candidate = dist[current]! + route.ticks
            if candidate < dist[next, default: .infinity] {
                dist[next] = candidate
                prev[next] = current
            }
        }
    }
    var nodes = [to]
    while nodes[0] != from { nodes.insert(prev[nodes[0]]!, at: 0) }
    return (nodes, dist[to]!)
}

// MARK: - Map geometry (world pixels; the data is generated into ArtLayout.swift)

func routeKey(_ a: LocationId, _ b: LocationId) -> String {
    a.rawValue < b.rawValue ? "\(a.rawValue)|\(b.rawValue)" : "\(b.rawValue)|\(a.rawValue)"
}

extension MapLayout {
    static func location(at p: CGPoint) -> LocationId? {
        LocationId.allCases.first { locations[$0]!.footprint.contains(p) }
    }

    /// The painted tube or track between two adjacent locations, door to door, in travel order.
    static func leg(_ from: LocationId, _ to: LocationId) -> [CGPoint] {
        let mid = routeWaypoints[routeKey(from, to)] ?? []
        let ordered = from.rawValue < to.rawValue ? mid : mid.reversed()
        return [locations[from]!.entry] + ordered + [locations[to]!.entry]
    }
}

// MARK: - People

let SPRITE_ARCHETYPES = ["farmer", "miner", "engineer", "medic", "scientist", "merchant", "guard", "official", "worker", "civilian"]
let SPRITE_VARIANTS = 6

struct OccupationDef: Identifiable { let id: String; let label: String; let work: LocationId; let archetype: String }

let OCCUPATIONS: [OccupationDef] = [
    .init(id: "hydroponicist", label: "Hydroponicist", work: .hydroponics, archetype: "farmer"),
    .init(id: "ice_miner", label: "Ice Miner", work: .ice_wells, archetype: "miner"),
    .init(id: "quarry_hand", label: "Quarry Hand", work: .quarry, archetype: "miner"),
    .init(id: "fabricator", label: "Fabricator", work: .workshop, archetype: "engineer"),
    .init(id: "solar_tech", label: "Solar Technician", work: .solar_farm, archetype: "engineer"),
    .init(id: "trader", label: "Trader", work: .market, archetype: "merchant"),
    .init(id: "quartermaster", label: "Quartermaster", work: .depot, archetype: "official"),
    .init(id: "councilor", label: "Councilor", work: .plaza, archetype: "official"),
    .init(id: "security", label: "Security Officer", work: .plaza, archetype: "guard"),
    .init(id: "medic", label: "Medic", work: .medbay, archetype: "medic"),
    .init(id: "researcher", label: "Researcher", work: .observatory, archetype: "scientist"),
    .init(id: "cook", label: "Canteen Cook", work: .canteen, archetype: "worker"),
    .init(id: "dock_hand", label: "Dock Hand", work: .landing_pad, archetype: "worker"),
    .init(id: "hauler", label: "Hauler", work: .depot, archetype: "worker"),
    .init(id: "resident", label: "Resident", work: .plaza, archetype: "civilian"),
]
func occupation(_ id: String) -> OccupationDef { OCCUPATIONS.first { $0.id == id } ?? OCCUPATIONS.last! }

let TRAIT_KEYS = ["ambition", "empathy", "caution", "curiosity", "sociability", "stubbornness"]
let VALUE_KEYS = ["wealth", "family", "status", "harmony", "freedom"]

enum Resource: String, Codable, CaseIterable, Identifiable {
    case food, water, parts, medicine, credits
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

struct IdeaPreset: Identifiable { let key: String; let label: String; let text: String; let needsSubject: Bool; var id: String { key } }

let RUMOR_PRESETS: [IdeaPreset] = [
    .init(key: "hoarding", label: "Hoarding supplies", text: "{name} is secretly hoarding food and water.", needsSubject: true),
    .init(key: "thief", label: "Thief", text: "{name} has been stealing from the Supply Depot.", needsSubject: true),
    .init(key: "saboteur", label: "Saboteur", text: "{name} sabotaged the ice drills.", needsSubject: true),
    .init(key: "corrupt", label: "Corrupt", text: "{name} takes bribes and skims credits.", needsSubject: true),
    .init(key: "hero", label: "Quiet hero", text: "{name} has been giving their own rations to hungry families.", needsSubject: true),
    .init(key: "custom", label: "Write your own", text: "", needsSubject: true),
]

let WHISPER_PRESETS: [IdeaPreset] = [
    .init(key: "suspect_hoarding", label: "Suspect hoarding", text: "You suspect {name} is hiding supplies.", needsSubject: true),
    .init(key: "distrust", label: "Distrust someone", text: "{name} cannot be trusted.", needsSubject: true),
    .init(key: "befriend", label: "Seek a friend", text: "You should get closer to {name}.", needsSubject: true),
    .init(key: "seek_power", label: "Seek power", text: "You deserve a seat on the council.", needsSubject: false),
    .init(key: "get_rich", label: "Get rich", text: "You should be the richest person in the colony.", needsSubject: false),
    .init(key: "share", label: "Share what you have", text: "Those with plenty should give to those without.", needsSubject: false),
    .init(key: "custom", label: "Write your own", text: "", needsSubject: false),
]

// MARK: - Public data shapes

struct Needs: Codable, Hashable { var hunger, thirst, fatigue, safety, social: Double }

struct Move: Codable, Hashable { var from: LocationId; var to: LocationId; var departTick: Double; var arriveTick: Double }

struct AgentLite: Codable, Identifiable, Hashable {
    var id: Id
    var name: String
    var spriteId: String
    var occupation: String
    var factionId: String?
    var alive: Bool
    var locationId: LocationId
    var move: Move?
    var activity: String
    var activityLabel: String
    var busyUntilTick: Double
    var interactingWithId: Id?
    var speech: String?
    var mood: String
    var health: Double
    var needs: Needs
    var updatedAtVersion: Double

    var first: String { String(name.split(separator: " ").first ?? "") }
}

struct GoalPublic: Codable, Identifiable, Hashable {
    var id: Id
    var kind: String
    var description: String
    var priority: Double
    var source: String
    var status: String
    var targetAgentId: Id?
    var targetAgentName: String?
    var createdAtTick: Double
}

struct BeliefPublic: Codable, Identifiable, Hashable {
    var id: Id
    var text: String
    var subjectAgentId: Id?
    var subjectAgentName: String?
    var confidence: Double
    var sourceType: String
    var sourceAgentName: String?
    var learnedAtTick: Double
    var divine: Bool { sourceType == "divine" }
}

struct RelationshipPublic: Codable, Hashable {
    var toAgentId: Id
    var toAgentName: String
    var toAgentAlive: Bool
    var kind: String
    var affinity: Double
    var trust: Double
    var fear: Double
}

struct PlanStep: Codable, Hashable { var label: String; var status: String }
struct PlanPublic: Codable, Hashable { var intent: String; var source: String; var goalId: Id?; var steps: [PlanStep]; var cursor: Double }
struct ThoughtPublic: Codable, Hashable { var tick: Double; var trigger: String; var intent: String; var source: String }
struct Death: Codable, Hashable { var tick: Double; var cause: String }

enum EventCategory: String, Codable { case environment, economy, social, politics, health, action, intervention }

struct WorldEventPublic: Codable, Identifiable, Hashable {
    var id: Id
    var tick: Double
    var category: EventCategory
    var eventType: String
    var actorId: Id?
    var participantIds: [Id]
    var locationId: LocationId?
    var summary: String
    var salience: Double
    var causationEventId: Id?
    var banner: Bool
    /// Storyline this event is a beat of, if any.
    var storylineId: Id?
    var visibility: String
}

struct AgentDetail: Codable, Identifiable, Hashable {
    var id: Id
    var name: String
    var spriteId: String
    var occupation: String
    var alive: Bool
    var locationId: LocationId
    var activityLabel: String
    var mood: String
    var health: Double
    var needs: Needs
    var ageBand: String
    var background: String
    var homeLocationId: LocationId
    var workLocationId: LocationId?
    var householdName: String?
    var factionName: String?
    var traits: [String: Double]
    var inventory: [String: Double]
    var goals: [GoalPublic]
    var plan: PlanPublic?
    var beliefs: [BeliefPublic]
    var relationships: [RelationshipPublic]
    var recentEvents: [WorldEventPublic]
    var lastThought: ThoughtPublic?
    var death: Death?
    /// Who they are in a line, what they want and fear, their arc. Never their secret.
    var persona: PersonaPublic?
    /// Live storylines this colonist is part of.
    var storylineIds: [Id]?

    // The society layer, all in words.
    var organizations: [Membership]?
    var family: Family?
    var pets: [Pet]?
    /// A goal that has taken over their life.
    var obsession: String?
    /// Notable works, newest first.
    var works: [WorkRef]?
    /// How the colony sees them, e.g. "a respected elder".
    var standingLabel: String?
    var education: String?

    struct Membership: Codable, Hashable { var id: Id; var name: String; var kind: String; var role: String }
    struct Family: Codable, Hashable { var partnerId: Id?; var partnerName: String?; var parentIds: [Id]; var childIds: [Id] }
    struct Pet: Codable, Hashable { var name: String; var species: String }
    struct WorkRef: Codable, Hashable, Identifiable { var id: Id; var title: String; var kind: String; var fame: Double }
}

struct ActiveEffect: Codable, Identifiable, Hashable {
    var id: Id
    var type: String
    var locationIds: [LocationId]
    var severity: Double
    var startTick: Double
    var endTick: Double
    var label: String
}

struct Population: Codable, Hashable { var alive: Double; var dead: Double }

struct WorldPublic: Codable, Hashable {
    var id: Id
    var name: String
    var tick: Double
    var speed: Double
    var status: String
    var version: Double
    var population: Population
    var activeEffects: [ActiveEffect]
    var stockpiles: [String: [String: Double]]
    var damage: [String: Double]
    var prices: [String: Double]
    /// True while the tick loop fast-forwards through the followed colonist's routine.
    var focusWarp: Bool?

    var running: Bool { status == "running" && speed > 0 }
}

// MARK: - Society (the almanac)

struct OrganizationPublic: Codable, Identifiable, Hashable {
    var id: Id
    var name: String
    /// company, guild, cult, gang, militia, party, school, troupe or breakaway.
    var kind: String
    var creed: String
    var leaderId: Id?
    var memberIds: [Id]
    var foundedTick: Double
    var status: String
    var territory: [LocationId]?
    var rules: [String]?
    var rivalIds: [Id]
}

struct DiscoveryPublic: Codable, Identifiable, Hashable {
    var key: String
    var name: String
    var effect: String
    var tick: Double
    var discovererIds: [Id]
    var eventId: Id?
    var id: String { key }
}

struct StructurePublic: Codable, Identifiable, Hashable {
    var id: Id
    var key: String
    var name: String
    var locationId: LocationId
    var builderIds: [Id]
    var progress: Double
    var builtTick: Double?
}

struct WorkPublic: Codable, Identifiable, Hashable {
    var id: Id
    var title: String
    var kind: String
    var creatorId: Id
    var creatorName: String
    var fame: Double
    var createdTick: Double
    var about: String
}

struct Notable: Codable, Hashable, Identifiable {
    var agentId: Id
    var name: String
    /// What they are known for, e.g. "the painter of the Long Dark mural".
    var known: String
    var id: Id { agentId }

    private enum CodingKeys: String, CodingKey { case agentId, name, known = "for" }
}

struct SocietyOverview: Codable, Hashable {
    var organizations: [OrganizationPublic]
    var discoveries: [DiscoveryPublic]
    var structures: [StructurePublic]
    var works: [WorkPublic]
    var notables: [Notable]
}

// MARK: - Story

struct PersonaPublic: Codable, Hashable {
    struct Arc: Codable, Hashable {
        /// setup, rising, crisis, climax or resolution.
        var stage: String
        var note: String
    }

    /// Short tag shown under the name, e.g. "the quartermaster who keeps two ledgers".
    var epithet: String
    var want: String
    var fear: String
    var flaw: String
    /// How they talk.
    var voice: String
    var arc: Arc
    /// True for the authored key characters.
    var key: Bool
}

struct StoryBeat: Codable, Hashable { var tick: Double; var text: String; var eventId: Id? }

struct StorylinePublic: Codable, Identifiable, Hashable {
    var id: Id
    var title: String
    /// One or two sentences: what is at stake.
    var premise: String
    /// brewing, rising, climax, resolved or fizzled.
    var status: String
    var tension: Double
    var participantIds: [Id]
    /// Newest last, capped.
    var beats: [StoryBeat]
    /// seed, emergent or player.
    var origin: String
    var createdTick: Double
    var lastBeatTick: Double

    var live: Bool { status != "resolved" && status != "fizzled" }
}

struct KeyCharacterCard: Codable, Identifiable, Hashable {
    var agentId: Id
    var name: String
    var spriteId: String
    var epithet: String
    /// Why the player should care, one sentence.
    var hook: String
    var factionId: String?
    var id: Id { agentId }
}

/// The player actions a tutorial card can wait for.
enum TutorialAction: String, Codable {
    case tap, follow_starter, read_thoughts, ask_question, switch_character, use_power, open_chronicle, open_storylines
}

struct TutorialStep: Codable, Identifiable, Hashable {
    var id: String
    var title: String
    var body: String
    /// Kept as text so a newer backend's action never breaks decoding; unknown ones advance on tap.
    var advanceOn: String
    var agentId: Id?

    var action: TutorialAction { TutorialAction(rawValue: advanceOn) ?? .tap }
}

struct HistoryEntry: Codable, Hashable { var era: String; var text: String }

struct StoryIntro: Codable, Hashable {
    var title: String
    var setting: [String]
    var history: [HistoryEntry]
    var tensions: [String]
    var keyCharacters: [KeyCharacterCard]
    var starterAgentId: Id
    var tutorial: [TutorialStep]
}

/// One line of a colonist's inner monologue.
struct ThoughtLine: Codable, Identifiable, Hashable {
    var id: Id
    var tick: Double
    var text: String
    var mood: String?
    var source: String
}

/// A reason to switch the camera to someone else.
struct StoryHook: Codable, Hashable, Identifiable {
    var agentId: Id
    var name: String
    var reason: String
    var storylineId: Id?
    var id: String { agentId + reason }
}

struct FocusState: Codable, Hashable {
    var agentId: Id
    /// Newest first.
    var thoughts: [ThoughtLine]
    var hooks: [StoryHook]
    var storylines: [StorylinePublic]
    var warping: Bool
}

struct AskTurn: Codable, Identifiable, Hashable { var id: Id; var tick: Double; var question: String; var answer: String }

enum AskResult: Decodable {
    case answered(AskTurn)
    case refused(code: String, message: String)

    private enum Keys: String, CodingKey { case ok, turn, code, message }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        if try c.decode(Bool.self, forKey: .ok) {
            self = .answered(try c.decode(AskTurn.self, forKey: .turn))
        } else {
            self = .refused(code: try c.decodeIfPresent(String.self, forKey: .code) ?? "unavailable", message: try c.decodeIfPresent(String.self, forKey: .message) ?? "They don't answer.")
        }
    }
}

// MARK: - God powers

struct NewCharacter {
    var name: String
    var spriteId: String
    var ageBand: String
    var occupation: String
    var home: LocationId
    var traits: [String: Double]
    var values: [String: Double]
    var backstory: String
    var credits: Double
    var food: Double
    var goal: String
}

enum Intervention {
    case drought(severity: Double, durationDays: Double)
    case storm(severity: Double, locationIds: [LocationId])
    case grant(agentId: Id, resource: Resource, amount: Double)
    case kill(agentId: Id, cause: String)
    case whisper(agentId: Id, presetKey: String, text: String, strength: Double, aboutAgentId: Id?)
    case rumor(aboutAgentId: Id, presetKey: String, text: String, seedLocationId: LocationId?)
    case createCharacter(NewCharacter)
}

struct InterventionResult {
    var ok: Bool
    var message: String?
    var affectedAgentIds: [Id] = []
    var createdAgentId: Id?
}

// MARK: - Timeskip (convex/timeskip.ts)

/// How far the player can skip ahead. Raw values match TimeskipSpan in mobile/shared/types.ts.
enum TimeskipSpan: String, Codable, CaseIterable, Identifiable {
    case week, month, half_year, year, five_years, decade
    var id: String { rawValue }

    var title: String {
        switch self {
        case .week: "One week"
        case .month: "One month"
        case .half_year: "Six months"
        case .year: "One year"
        case .five_years: "Five years"
        case .decade: "Ten years"
        }
    }

    var hint: String {
        switch self {
        case .week: "A few quarrels, a secret or two, nothing settled."
        case .month: "Romances start, debts come due, someone changes jobs."
        case .half_year: "Weddings, a death, a new organization rises."
        case .year: "Children are born, leaders are tested, feuds harden."
        case .five_years: "A generation turns. Some faces will be gone."
        case .decade: "Children grow up. The colony you know becomes a memory."
        }
    }

    var symbol: String {
        switch self {
        case .week: "calendar"
        case .month: "moonphase.waxing.crescent"
        case .half_year: "moonphase.full.moon"
        case .year: "sun.max"
        case .five_years: "hourglass"
        case .decade: "infinity"
        }
    }
}

struct TimeskipBeat: Codable, Hashable {
    var tick: Double
    var period: String
    var text: String
    var agentIds: [Id]
    var kind: String
    var eventId: Id?
}

struct TimeskipPerson: Codable, Hashable, Identifiable {
    var agentId: Id
    var name: String
    var spriteId: String
    var alive: Bool
    var text: String
    /// followed, key, risen, fallen, newcomer, born or gone.
    var role: String
    var id: Id { agentId }
}

struct TimeskipSummary: Codable, Hashable {
    var title: String
    var narrative: [String]
    var beats: [TimeskipBeat]
    var followed: TimeskipPerson?
    var people: [TimeskipPerson]
    var newPeople: [TimeskipPerson]
    var tensions: [String]
    var storylineIds: [Id]
    var source: String
}

struct TimeskipPublic: Codable, Hashable, Identifiable {
    var id: Id
    var span: String
    /// running, summarizing, done or failed.
    var status: String
    var startTick: Double
    var endTick: Double
    var tick: Double
    var chapter: Double
    var chapters: Double
    var progress: Double
    var progressLabel: String
    var latestBeat: String?
    var summary: TimeskipSummary?
    var error: String?
}

struct TimeskipStartResult: Codable {
    var ok: Bool
    var timeskipId: Id?
    var code: String?
    var message: String?
}
